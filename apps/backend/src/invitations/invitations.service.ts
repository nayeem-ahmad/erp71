import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { UserRole, ROLE_DEFAULT_PERMISSIONS } from '@erp71/shared-types';
import * as crypto from 'crypto';

const CAN_INVITE_ROLES: string[] = [UserRole.OWNER, UserRole.MANAGER];

const INVITABLE_ROLES: UserRole[] = [UserRole.MANAGER, UserRole.CASHIER, UserRole.ACCOUNTANT];

@Injectable()
export class InvitationsService {
    constructor(
        private db: DatabaseService,
        private email: EmailService,
    ) {}

    async getInfo(rawToken: string): Promise<{ tenantName: string; email: string; role: string; expiresAt: Date }> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const invitation = await this.db.userInvitation.findUnique({
            where: { token_hash: tokenHash },
            include: { tenant: true },
        });

        if (!invitation || invitation.accepted_at || invitation.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired invitation');
        }

        return {
            tenantName: invitation.tenant.name,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expires_at,
        };
    }

    private assertCanManageTeam(callerRole: string): void {
        if (!CAN_INVITE_ROLES.includes(callerRole)) {
            throw new ForbiddenException('Only OWNER or MANAGER can manage team invitations');
        }
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
                invitedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { created_at: 'desc' },
        });

        return invitations.map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
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
        newRole: UserRole,
    ): Promise<{ user_id: string; role: UserRole }> {
        this.assertCanManageTeam(callerRole);

        if (targetUserId === callerUserId) {
            throw new BadRequestException('You cannot change your own role');
        }

        if (!INVITABLE_ROLES.includes(newRole)) {
            throw new BadRequestException('Invalid role assignment');
        }

        const [tenant, membership] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId }, select: { owner_id: true } }),
            this.db.tenantUser.findUnique({
                where: { tenant_id_user_id: { tenant_id: tenantId, user_id: targetUserId } },
            }),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!membership) throw new NotFoundException('Team member not found');

        if (tenant.owner_id === targetUserId) {
            throw new ForbiddenException('Cannot change the workspace owner\'s role');
        }

        if (callerRole === UserRole.MANAGER && membership.role === UserRole.OWNER) {
            throw new ForbiddenException('Managers cannot modify owner accounts');
        }

        if (membership.role === newRole) {
            return { user_id: targetUserId, role: newRole };
        }

        await this.db.$transaction(async (tx) => {
            await tx.tenantUser.update({
                where: { tenant_id_user_id: { tenant_id: tenantId, user_id: targetUserId } },
                data: { role: newRole },
            });

            const storeAccess = await tx.userStoreAccess.findMany({
                where: { user_id: targetUserId, tenant_id: tenantId },
                select: { store_id: true },
            });

            for (const { store_id } of storeAccess) {
                await tx.userStorePermission.deleteMany({
                    where: { user_id: targetUserId, store_id, tenant_id: tenantId },
                });

                const permissions = ROLE_DEFAULT_PERMISSIONS[newRole] ?? [];
                if (permissions.length > 0) {
                    await tx.userStorePermission.createMany({
                        data: permissions.map((permission) => ({
                            user_id: targetUserId,
                            store_id,
                            tenant_id: tenantId,
                            permission,
                            granted_by: callerUserId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }
        });

        return { user_id: targetUserId, role: newRole };
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
        role: UserRole,
    ): Promise<void> {
        this.assertCanManageTeam(callerRole);

        if (!INVITABLE_ROLES.includes(role)) {
            throw new BadRequestException('Invalid role for invitation');
        }

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

        // Invalidate pending invitations for same email+tenant
        await this.db.userInvitation.deleteMany({
            where: { tenant_id: tenantId, email: inviteeEmail, accepted_at: null },
        });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await this.db.userInvitation.create({
            data: { tenant_id: tenantId, email: inviteeEmail, role, token_hash: tokenHash, invited_by: invitedByUserId, expires_at: expiresAt },
        });

        await this.email.sendInvitation(inviteeEmail, tenant.name, inviter.name ?? inviter.email, rawToken);
    }

    async accept(rawToken: string, acceptingUserId: string): Promise<void> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const invitation = await this.db.userInvitation.findUnique({ where: { token_hash: tokenHash } });

        if (!invitation || invitation.accepted_at || invitation.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired invitation');
        }

        const user = await this.db.user.findUnique({ where: { id: acceptingUserId } });
        if (!user) throw new NotFoundException('User not found');

        if (user.email !== invitation.email) {
            throw new BadRequestException('This invitation was sent to a different email address');
        }

        await this.db.$transaction(async (tx) => {
            await tx.tenantUser.create({
                data: { tenant_id: invitation.tenant_id, user_id: acceptingUserId, role: invitation.role },
            });

            const store = await tx.store.findFirst({ where: { tenant_id: invitation.tenant_id } });
            if (store) {
                await tx.userStoreAccess.create({
                    data: { user_id: acceptingUserId, store_id: store.id, tenant_id: invitation.tenant_id, access_level: 'STORE_ONLY' },
                });

                const permissions = ROLE_DEFAULT_PERMISSIONS[invitation.role] ?? [];
                if (permissions.length > 0) {
                    await tx.userStorePermission.createMany({
                        data: permissions.map((permission) => ({
                            user_id: acceptingUserId,
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
        });
    }
}
