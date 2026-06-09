import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuditContext {
    userId?: string;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface AuditQueryOptions {
    tenantId?: string;
    userId?: string;
    entity?: string;
    entityId?: string;
    action?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
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
                payload: payload as any ?? undefined,
            },
        });
    }

    async query(options: AuditQueryOptions) {
        const limit = Math.min(options.limit ?? 50, 200);
        const offset = options.offset ?? 0;

        const where: Record<string, any> = {};
        if (options.tenantId) where.tenant_id = options.tenantId;
        if (options.userId) where.user_id = options.userId;
        if (options.entity) where.entity = options.entity;
        if (options.entityId) where.entity_id = options.entityId;
        if (options.action) where.action = options.action;
        if (options.fromDate || options.toDate) {
            where.created_at = {};
            if (options.fromDate) where.created_at.gte = options.fromDate;
            if (options.toDate) where.created_at.lte = options.toDate;
        }

        const [rows, total] = await Promise.all([
            this.db.auditLog.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    tenant_id: true,
                    user_id: true,
                    action: true,
                    entity: true,
                    entity_id: true,
                    payload: true,
                    ip_address: true,
                    user_agent: true,
                    created_at: true,
                    user: { select: { id: true, email: true, name: true } },
                },
            }),
            this.db.auditLog.count({ where }),
        ]);

        return { rows, total, limit, offset };
    }
}
