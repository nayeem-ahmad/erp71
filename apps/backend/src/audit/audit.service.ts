import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { createdAtRange } from '../common/created-range.util';

export interface AuditContext {
    userId?: string;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface AuditQueryOptions {
    tenantId?: string;
    /**
     * Restrict to platform-scoped rows — the ones a platform admin wrote, which
     * carry no tenant. Takes precedence over `tenantId`, since the two are
     * mutually exclusive by construction.
     */
    platformOnly?: boolean;
    userId?: string;
    entity?: string;
    entityId?: string;
    action?: string;
    from?: string;
    to?: string;
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

    /**
     * Record an account-level event once per tenant the user belongs to.
     *
     * Sign-in, sign-out and password events are not tenant scoped, but the
     * reader (`GET /audit-logs`) filters strictly on `tenant_id` — a row
     * written without one is invisible to every tenant admin. Fanning out
     * across memberships is what makes "who signed in, and from where"
     * answerable by the people who need it. A user in two tenants produces two
     * rows; each tenant only ever sees its own.
     *
     * Users with no membership still get a single unscoped row so the platform
     * view keeps a complete record.
     */
    async logForUserTenants(
        action: string,
        entity: string,
        ctx: AuditContext & { userId: string },
        entityId?: string,
        payload?: Record<string, unknown>,
    ): Promise<void> {
        const memberships = await this.db.tenantUser.findMany({
            where: { user_id: ctx.userId, tenant: { deleted_at: null } },
            select: { tenant_id: true },
        });

        if (!memberships.length) {
            await this.log(action, entity, ctx, entityId, payload);
            return;
        }

        await Promise.all(
            memberships.map((membership) =>
                this.log(action, entity, { ...ctx, tenantId: membership.tenant_id }, entityId, payload),
            ),
        );
    }

    async query(options: AuditQueryOptions) {
        const limit = Math.min(options.limit ?? 50, 200);
        const offset = options.offset ?? 0;

        const where: Record<string, any> = {};
        if (options.platformOnly) where.tenant_id = null;
        else if (options.tenantId) where.tenant_id = options.tenantId;
        if (options.userId) where.user_id = options.userId;
        if (options.entity) where.entity = options.entity;
        if (options.entityId) where.entity_id = options.entityId;
        if (options.action) where.action = options.action;
        const created = createdAtRange(options.from, options.to);
        if (created) {
            where.created_at = created;
        } else if (options.fromDate || options.toDate) {
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
