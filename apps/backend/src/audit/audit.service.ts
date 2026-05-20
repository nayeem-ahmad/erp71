import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuditContext {
    userId?: string;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
}

@Injectable()
export class AuditService {
    constructor(private db: DatabaseService) {}

    async log(
        action: string,
        entity: string,
        ctx: AuditContext,
        entityId?: string,
        payload?: Record<string, unknown>,
    ): Promise<void> {
        await this.db.auditLog.create({
            data: {
                action,
                entity,
                entity_id: entityId,
                user_id: ctx.userId ?? null,
                tenant_id: ctx.tenantId ?? null,
                ip_address: ctx.ipAddress ?? null,
                user_agent: ctx.userAgent ?? null,
                payload: payload ?? undefined,
            },
        });
    }
}
