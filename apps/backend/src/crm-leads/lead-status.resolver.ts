import { BadRequestException, Injectable } from '@nestjs/common';
import { OPEN_STATUS_LIFECYCLES } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { LeadStatus } from './crm-leads.dto';

/**
 * A lead's stage (`status_id`, what the tenant sees) and the lifecycle written
 * beside it (`status`, what every open/won/lost rule reads). `id` is null only
 * for a tenant whose stages have not been seeded yet; the boot sync fills it in.
 */
export type ResolvedStage = { id: string | null; lifecycle: LeadStatus };

/** What a write names: a stage id (current clients) or a bare lifecycle code (older ones). */
export type StageInput = { status_id?: string | null; status?: LeadStatus | string | null };

type StageRow = { id: string; name: string; lifecycle: string; is_active: boolean };

const OPEN_LIFECYCLES = new Set<string>(OPEN_STATUS_LIFECYCLES);

/**
 * The one place a lead's stage is turned into the pair of columns stored for it.
 *
 * Every write path goes through here so `status_id` and `status` can never be
 * written apart. The boot sync repairs any lead whose two columns disagree, but
 * only as a backstop.
 */
@Injectable()
export class LeadStatusResolver {
    constructor(private readonly db: DatabaseService) {}

    async forCreate(tenantId: string, input: StageInput): Promise<ResolvedStage> {
        if (input.status_id) return this.byId(tenantId, input.status_id);
        return this.seeded(tenantId, (input.status as LeadStatus) || LeadStatus.NEW);
    }

    /**
     * The stage an update moves a lead to, or undefined when it stays put.
     *
     * A bare `status` equal to the lead's current lifecycle is "no change", not
     * "move to the seeded stage". An old mobile build shows a lead on
     * "Negotiation" as Qualified, and re-sending QUALIFIED must not quietly pull
     * the lead off the tenant's own stage.
     */
    async forUpdate(
        tenantId: string,
        existing: { status: string; status_id: string | null },
        input: StageInput,
    ): Promise<ResolvedStage | undefined> {
        if (input.status_id) {
            // Re-saving a form whose lead sits on a since-hidden stage is not a move.
            if (input.status_id === existing.status_id) return undefined;
            return this.byId(tenantId, input.status_id);
        }
        if (!input.status || input.status === existing.status) return undefined;
        return this.seeded(tenantId, input.status as LeadStatus);
    }

    /**
     * Bulk "set status": a stage id, or a seeded code from an older client. Only
     * open stages — closing a lead needs a lost reason or a customer record, which
     * a bulk action cannot supply.
     */
    async forBulk(tenantId: string, value: string): Promise<ResolvedStage> {
        const trimmed = (value ?? '').trim();
        const row =
            (trimmed && (await this.find(tenantId, { id: trimmed }))) ||
            (trimmed && (await this.find(tenantId, { code: trimmed.toUpperCase() }))) ||
            null;
        if (!row) throw new BadRequestException('Invalid status.');
        this.assertActive(row);
        if (!OPEN_LIFECYCLES.has(row.lifecycle)) {
            throw new BadRequestException(
                `Bulk status change to "${row.name}" is not supported — close those leads individually.`,
            );
        }
        return { id: row.id, lifecycle: row.lifecycle as LeadStatus };
    }

    /** The tenant's seeded stage for a lifecycle code. */
    async seeded(tenantId: string, code: LeadStatus): Promise<ResolvedStage> {
        if (!Object.values(LeadStatus).includes(code)) {
            throw new BadRequestException(`Unknown lead status: "${code}".`);
        }
        const row = await this.find(tenantId, { code });
        return { id: row?.id ?? null, lifecycle: code };
    }

    private async byId(tenantId: string, id: string): Promise<ResolvedStage> {
        const row = await this.find(tenantId, { id });
        if (!row) throw new BadRequestException('Lead status not found.');
        this.assertActive(row);
        return { id: row.id, lifecycle: row.lifecycle as LeadStatus };
    }

    private assertActive(row: StageRow) {
        if (!row.is_active) {
            throw new BadRequestException(`Lead status "${row.name}" is hidden.`);
        }
    }

    private find(tenantId: string, where: { id?: string; code?: string }): Promise<StageRow | null> {
        return this.db.leadStatusOption.findFirst({
            where: { tenant_id: tenantId, ...where },
            select: { id: true, name: true, lifecycle: true, is_active: true },
        }) as Promise<StageRow | null>;
    }
}
