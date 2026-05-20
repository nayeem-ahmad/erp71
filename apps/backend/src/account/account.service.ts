import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(private db: DatabaseService) {}

    async requestDataDeletion(userId: string): Promise<void> {
        // Log the deletion request for compliance tracking
        await this.db.auditLog.create({
            data: {
                user_id: userId,
                action: 'DATA_DELETION_REQUEST',
                entity: 'User',
                entity_id: userId,
                payload: { requested_at: new Date().toISOString() },
            },
        });
        // In production: notify admin, queue deletion workflow, respond to user by email
        this.logger.log(`[GDPR] Data deletion requested by user ${userId}`);
    }

    async exportUserData(userId: string): Promise<Record<string, unknown>> {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                created_at: true,
                email_verified_at: true,
                tenantMembers: {
                    select: {
                        role: true,
                        tenant: { select: { id: true, name: true, created_at: true } },
                    },
                },
                auditLogs: {
                    select: { action: true, entity: true, entity_id: true, created_at: true },
                    orderBy: { created_at: 'desc' },
                    take: 500,
                },
            },
        });

        return {
            exported_at: new Date().toISOString(),
            user: {
                id: user?.id,
                email: user?.email,
                name: user?.name,
                created_at: user?.created_at,
                email_verified_at: user?.email_verified_at,
            },
            tenant_memberships: user?.tenantMembers ?? [],
            audit_log_sample: user?.auditLogs ?? [],
        };
    }
}
