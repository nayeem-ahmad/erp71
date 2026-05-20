import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '@retail-saas/shared-types';
import { ROLE_DEFAULT_PERMISSIONS } from '@retail-saas/shared-types';
import * as crypto from 'crypto';

@Injectable()
export class InvitationsService {
    constructor(
        private db: DatabaseService,
        private email: EmailService,
    ) {}

    async invite(tenantId: string, invitedByUserId: string, inviteeEmail: string, role: UserRole): Promise<void> {
        const [tenant, inviter] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId } }),
            this.db.user.findUnique({ where: { id: invitedByUserId } }),
        ]);

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!inviter) throw new NotFoundException('Inviter not found');

        // Check if user is already a member
        const existingMember = await this.db.user.findUnique({
            where: { email: inviteeEmail },
            include: { tenantMembers: { where: { tenant_id: tenantId } } },
        });

        if (existingMember?.tenantMembers?.length) {
            throw new ConflictException('User is already a member of this tenant');
        }

        // Invalidate any pending invitations for same email+tenant
        await this.db.userInvitation.deleteMany({
            where: { tenant_id: tenantId, email: inviteeEmail, accepted_at: null },
        });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await this.db.userInvitation.create({
            data: {
                tenant_id: tenantId,
                email: inviteeEmail,
                role,
                token_hash: tokenHash,
                invited_by: invitedByUserId,
                expires_at: expiresAt,
            },
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
                data: {
                    tenant_id: invitation.tenant_id,
                    user_id: acceptingUserId,
                    role: invitation.role,
                },
            });

            // Provision store access for the first store in the tenant
            const store = await tx.store.findFirst({ where: { tenant_id: invitation.tenant_id } });
            if (store) {
                await tx.userStoreAccess.create({
                    data: {
                        user_id: acceptingUserId,
                        store_id: store.id,
                        tenant_id: invitation.tenant_id,
                        access_level: 'STORE_ONLY',
                    },
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

            await tx.userInvitation.update({
                where: { id: invitation.id },
                data: { accepted_at: new Date() },
            });
        });
    }
}
