import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { UserRole, normalizeMobileToE164, DEFAULT_MOBILE_COUNTRY_CODE, resolveBaseUserRole } from '@erp71/shared-types';
import { syncMemberPermissionsFromRole } from '../team/role-sync.util';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

type ValidInvitation = Awaited<ReturnType<InvitationsService['loadValidInvitation']>>;

const CAN_INVITE_ROLES: string[] = [UserRole.OWNER, UserRole.MANAGER];

@Injectable()
export class InvitationsService {
    constructor(
        private db: DatabaseService,
        private email: EmailService,
        private planEntitlements: PlanEntitlementsService,
    ) {}

    async getInfo(
        rawToken: string,
    ): Promise<{ tenantName: string; email: string; roleName: string; expiresAt: Date; hasAccount: boolean }> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const invitation = await this.db.userInvitation.findUnique({
            where: { token_hash: tokenHash },
            include: { tenant: true, tenantRole: { select: { name: true } } },
        });

        if (!invitation || invitation.accepted_at || invitation.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired invitation');
        }

        // Lets the accept page decide between an inline sign-in (existing account)
        // and an inline create-account form (new invitee). Just a boolean for an
        // email the caller already possesses via the invite link — no PII leak.
        const existingUser = await this.db.user.findUnique({
            where: { email: invitation.email },
            select: { id: true },
        });

        return {
            tenantName: invitation.tenant.name,
            email: invitation.email,
            roleName: invitation.tenantRole.name,
            expiresAt: invitation.expires_at,
            hasAccount: Boolean(existingUser),
        };
    }

    private assertCanManageTeam(callerRole: string): void {
        if (!CAN_INVITE_ROLES.includes(callerRole)) {
            throw new ForbiddenException('Only OWNER or MANAGER can manage team invitations');
        }
    }

    private async getTenantRole(tenantId: string, tenantRoleId: string) {
        const role = await this.db.tenantRole.findFirst({
            where: { id: tenantRoleId, tenant_id: tenantId },
            select: { id: true, name: true },
        });
        if (!role) throw new NotFoundException('Role not found.');
        return role;
    }

    async listMembers(tenantId: string, callerRole: string) {
        this.assertCanManageTeam(callerRole);

        const [tenant, members] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId }, select: { owner_id: true } }),
            this.db.tenantUser.findMany({
                where: { tenant_id: tenantId },
                include: {
                    user: {
                        select: { id: true, email: true, name: true, created_at: true },
                    },
                },
                orderBy: [{ role: 'asc' }, { user: { email: 'asc' } }],
            }),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');

        return members.map((member) => ({
            id: member.id,
            user_id: member.user_id,
            email: member.user.email,
            name: member.user.name,
            role: member.role,
            is_owner: tenant.owner_id === member.user_id,
            joined_at: member.user.created_at,
        }));
    }

    async listPending(tenantId: string, callerRole: string) {
        this.assertCanManageTeam(callerRole);

        const invitations = await this.db.userInvitation.findMany({
            where: {
                tenant_id: tenantId,
                accepted_at: null,
                expires_at: { gt: new Date() },
            },
            include: {
                tenantRole: { select: { id: true, name: true } },
                invitedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { created_at: 'desc' },
        });

        return invitations.map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            roleName: invitation.tenantRole.name,
            tenantRoleId: invitation.tenant_role_id,
            expires_at: invitation.expires_at,
            created_at: invitation.created_at,
            invited_by: {
                id: invitation.invitedBy.id,
                name: invitation.invitedBy.name ?? invitation.invitedBy.email,
            },
        }));
    }

    async updateMemberRole(
        tenantId: string,
        callerUserId: string,
        callerRole: string,
        targetUserId: string,
        tenantRoleId: string,
    ): Promise<{ user_id: string; tenantRoleId: string }> {
        this.assertCanManageTeam(callerRole);

        if (targetUserId === callerUserId) {
            throw new BadRequestException('You cannot change your own role');
        }

        const [tenant, membership] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId }, select: { owner_id: true } }),
            this.db.tenantUser.findUnique({
                where: { tenant_id_user_id: { tenant_id: tenantId, user_id: targetUserId } },
            }),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!membership) throw new NotFoundException('Team member not found');

        if (tenant.owner_id === targetUserId || membership.role === UserRole.OWNER) {
            throw new ForbiddenException('Cannot change the workspace owner\'s role');
        }

        const role = await this.getTenantRole(tenantId, tenantRoleId);

        if (membership.tenant_role_id === tenantRoleId) {
            return { user_id: targetUserId, tenantRoleId };
        }

        await this.db.$transaction(async (tx) => {
            await tx.tenantUser.update({
                where: { tenant_id_user_id: { tenant_id: tenantId, user_id: targetUserId } },
                // Update the coarse role enum in lockstep so the session's displayed role
                // and the OWNER/MANAGER authorization gates match the new TenantRole.
                data: { tenant_role_id: tenantRoleId, role: resolveBaseUserRole(role.name) },
            });

            await syncMemberPermissionsFromRole(tx, {
                tenantId,
                userIds: [targetUserId],
                tenantRoleId,
                grantedBy: callerUserId,
            });
        });

        return { user_id: targetUserId, tenantRoleId };
    }

    async cancelInvitation(tenantId: string, callerRole: string, invitationId: string): Promise<void> {
        this.assertCanManageTeam(callerRole);

        const invitation = await this.db.userInvitation.findFirst({
            where: {
                id: invitationId,
                tenant_id: tenantId,
                accepted_at: null,
            },
        });

        if (!invitation) {
            throw new NotFoundException('Invitation not found');
        }

        await this.db.userInvitation.delete({ where: { id: invitationId } });
    }

    async invite(
        tenantId: string,
        invitedByUserId: string,
        callerRole: string,
        inviteeEmail: string,
        tenantRoleId: string,
    ): Promise<void> {
        this.assertCanManageTeam(callerRole);

        await this.getTenantRole(tenantId, tenantRoleId);

        const [tenant, inviter] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId } }),
            this.db.user.findUnique({ where: { id: invitedByUserId } }),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!inviter) throw new NotFoundException('Inviter not found');

        // Check if user is already a member
        const existingUser = await this.db.user.findUnique({
            where: { email: inviteeEmail },
            include: { tenantMembers: { where: { tenant_id: tenantId } } },
        });

        if (existingUser?.tenantMembers?.length) {
            throw new ConflictException('User is already a member of this tenant');
        }

        await this.planEntitlements.assertUserQuota(tenantId);

        // Invalidate pending invitations for same email+tenant
        await this.db.userInvitation.deleteMany({
            where: { tenant_id: tenantId, email: inviteeEmail, accepted_at: null },
        });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await this.db.userInvitation.create({
            data: {
                tenant_id: tenantId,
                email: inviteeEmail,
                tenant_role_id: tenantRoleId,
                token_hash: tokenHash,
                invited_by: invitedByUserId,
                expires_at: expiresAt,
            },
        });

        await this.email.sendInvitation(inviteeEmail, tenant.name, inviter.name ?? inviter.email, rawToken);
    }

    // Validates a raw invitation token and returns the invitation with the role
    // permissions needed to provision membership. Shared by accept + acceptWithSignup.
    private async loadValidInvitation(rawToken: string) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const invitation = await this.db.userInvitation.findUnique({
            where: { token_hash: tokenHash },
            include: {
                tenantRole: {
                    select: { name: true, permissions: { select: { permission: true } } },
                },
            },
        });

        if (!invitation || invitation.accepted_at || invitation.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired invitation');
        }

        return invitation;
    }

    // Grants tenant membership, store access, and role permissions to a user, then
    // marks the invitation accepted. Runs inside a caller-supplied transaction so the
    // user creation (signup path) and membership grant commit atomically.
    private async grantMembershipTx(
        tx: Prisma.TransactionClient,
        invitation: ValidInvitation,
        userId: string,
    ): Promise<void> {
        await tx.tenantUser.create({
            data: {
                tenant_id: invitation.tenant_id,
                user_id: userId,
                // Keep the coarse role enum in lockstep with the assigned TenantRole —
                // it drives role display and the OWNER/MANAGER authorization gates.
                role: resolveBaseUserRole(invitation.tenantRole.name),
                tenant_role_id: invitation.tenant_role_id,
            },
        });

        const store = await tx.store.findFirst({ where: { tenant_id: invitation.tenant_id } });
        if (store) {
            await tx.userStoreAccess.create({
                data: {
                    user_id: userId,
                    store_id: store.id,
                    tenant_id: invitation.tenant_id,
                    access_level: 'STORE_ONLY',
                },
            });

            const permissions = invitation.tenantRole.permissions.map((p) => p.permission);
            if (permissions.length > 0) {
                await tx.userStorePermission.createMany({
                    data: permissions.map((permission) => ({
                        user_id: userId,
                        store_id: store.id,
                        tenant_id: invitation.tenant_id,
                        permission,
                        granted_by: invitation.invited_by,
                    })),
                    skipDuplicates: true,
                });
            }
        }

        await tx.userInvitation.update({ where: { id: invitation.id }, data: { accepted_at: new Date() } });
    }

    async accept(rawToken: string, acceptingUserId: string): Promise<void> {
        const invitation = await this.loadValidInvitation(rawToken);

        const user = await this.db.user.findUnique({ where: { id: acceptingUserId } });
        if (!user) throw new NotFoundException('User not found');

        if (user.email !== invitation.email) {
            throw new BadRequestException('This invitation was sent to a different email address');
        }

        await this.db.$transaction((tx) => this.grantMembershipTx(tx, invitation, acceptingUserId));
    }

    // Public accept path for an invitee who has no account yet: creates their user
    // (email taken from the invitation, never client input) and joins them to the
    // inviting tenant in one atomic step. The email is marked verified because
    // possession of the invite token proves ownership of that mailbox.
    async acceptWithSignup(
        rawToken: string,
        name: string,
        mobile: string,
        password: string,
        mobileCountryCode?: string,
    ): Promise<void> {
        const invitation = await this.loadValidInvitation(rawToken);

        const existingUser = await this.db.user.findUnique({ where: { email: invitation.email } });
        if (existingUser) {
            throw new ConflictException('An account already exists for this email. Please sign in to accept.');
        }

        const countryCode = mobileCountryCode?.trim() || DEFAULT_MOBILE_COUNTRY_CODE;
        const normalizedMobile = normalizeMobileToE164(countryCode, mobile);
        if (!normalizedMobile) {
            throw new BadRequestException('Please enter a valid mobile number including country code.');
        }

        const mobileTaken = await this.db.user.findFirst({ where: { mobile: normalizedMobile } });
        if (mobileTaken) {
            throw new ConflictException('Mobile number already in use');
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await this.db.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email: invitation.email,
                    passwordHash,
                    name,
                    mobile: normalizedMobile,
                    mobile_country_code: countryCode,
                    email_verified_at: new Date(),
                },
            });

            await this.grantMembershipTx(tx, invitation, user.id);
        });
    }
}