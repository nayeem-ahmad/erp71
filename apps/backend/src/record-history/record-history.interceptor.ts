import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DatabaseService } from '../database/database.service';
import { extractRequestMeta } from '../audit/audit-route.util';
import { RecordHistoryService } from './record-history.service';
import type { RecordSnapshot } from './record-history.snapshots';
import { TRACK_HISTORY_KEY, type TrackHistorySpec } from './track-history.metadata';

/**
 * Writes a `RecordHistory` row for a route marked `@TrackHistory`: the record
 * as it was before the handler ran, as it is after, and what moved.
 *
 * Method-scoped (the decorator attaches it), so it runs inside the controller's
 * `TenantInterceptor` and `request.tenantId` is already set when the "before"
 * snapshot is taken.
 *
 * Three rules it keeps:
 *  - A history failure never fails the request. Reading the "before" snapshot
 *    is the only step on the request's path, and an error there just means no
 *    row; the "after" half runs once the response is on its way.
 *  - Nothing is written unless the handler succeeded. A refused edit changed
 *    nothing, so there is nothing to record.
 *  - A snapshot is only stored under the tenant that owns the record. Ids come
 *    from the URL, so the record is re-checked against `request.tenantId`
 *    rather than trusted.
 */
@Injectable()
export class RecordHistoryInterceptor implements NestInterceptor {
    private readonly logger = new Logger(RecordHistoryInterceptor.name);

    constructor(
        private readonly history: RecordHistoryService,
        private readonly reflector: Reflector,
        private readonly db: DatabaseService,
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        if (context.getType() !== 'http') return next.handle();
        const spec = this.reflector.get<TrackHistorySpec | undefined>(TRACK_HISTORY_KEY, context.getHandler());
        if (!spec) return next.handle();

        const request = context.switchToHttp().getRequest();
        if (!request?.tenantId) return next.handle();

        let enabled = false;
        try {
            enabled = await this.history.isEnabled(spec.entity);
        } catch (error) {
            this.warn('settings', error);
        }
        if (!enabled) return next.handle();

        const before = new Map<string, RecordSnapshot | null>();
        if (spec.action !== 'CREATE') {
            try {
                const id = spec.resolveId
                    ? await spec.resolveId(this.db, request)
                    : request.params?.[spec.idParam ?? 'id'];
                if (id) before.set(id, await this.history.snapshot(spec.entity, id));
            } catch (error) {
                this.warn('before snapshot', error);
            }
        }

        return next.handle().pipe(
            tap((result) => {
                void this.record(spec, request, result, before).catch((error) => this.warn('write', error));
            }),
        );
    }

    private async record(
        spec: TrackHistorySpec,
        request: any,
        result: unknown,
        before: Map<string, RecordSnapshot | null>,
    ): Promise<void> {
        const ids = spec.action === 'CREATE' ? createdIds(spec, result) : [...before.keys()];
        const meta = extractRequestMeta(request);

        for (const id of ids) {
            const prior = before.get(id) ?? null;
            const after = await this.history.snapshot(spec.entity, id);
            const owner = prior?.tenantId ?? after?.tenantId;
            if (!owner || owner !== request.tenantId) continue;

            await this.history.write({
                tenantId: owner,
                entityType: spec.entity,
                entityId: id,
                action: spec.action,
                before: prior,
                after,
                userId: request.user?.userId ?? null,
                ipAddress: meta.ipAddress ?? null,
                userAgent: meta.userAgent ?? null,
            });
        }
    }

    private warn(step: string, error: unknown): void {
        this.logger.warn(`Record history ${step} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function createdIds(spec: TrackHistorySpec, result: unknown): string[] {
    if (spec.resultIds) {
        try {
            return spec.resultIds(result).filter((id) => typeof id === 'string' && id.length > 0);
        } catch {
            return [];
        }
    }
    const id = result && typeof result === 'object' ? (result as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id.length ? [id] : [];
}
