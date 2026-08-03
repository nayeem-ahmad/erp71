import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { FALLBACK_SOURCE_CODE } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import {
    CreateLeadTaxonomyDto,
    LeadTaxonomyKind,
    UpdateLeadTaxonomyDto,
} from './lead-taxonomy.dto';
import { normalizeName, slugifyCode } from './lead-taxonomy.util';

export type TaxonomyOption = {
    id: string;
    code: string;
    name: string;
    score_weight?: number;
    icon?: string | null;
    sort_order: number;
    is_system: boolean;
    is_active: boolean;
};

/**
 * Where rows of a given list are consumed. `usage()` counts against it and
 * `remove()` reassigns through it, which is the only structural difference
 * between the three lists.
 */
type Consumer = {
    /** Prisma delegate name on DatabaseService. */
    table: 'lead' | 'leadConversation';
    /** FK column on that table pointing back at the list. */
    fk: 'source_id' | 'category_id' | 'channel_id';
    /** Human noun used in "in use by N …" messages. */
    noun: string;
};

const CONSUMERS: Record<LeadTaxonomyKind, Consumer> = {
    [LeadTaxonomyKind.SOURCE]: { table: 'lead', fk: 'source_id', noun: 'lead' },
    [LeadTaxonomyKind.CATEGORY]: { table: 'lead', fk: 'category_id', noun: 'lead' },
    [LeadTaxonomyKind.CHANNEL]: {
        table: 'leadConversation',
        fk: 'channel_id',
        noun: 'conversation',
    },
};

const LABELS: Record<LeadTaxonomyKind, string> = {
    [LeadTaxonomyKind.SOURCE]: 'Lead source',
    [LeadTaxonomyKind.CATEGORY]: 'Lead category',
    [LeadTaxonomyKind.CHANNEL]: 'Conversation channel',
};

@Injectable()
export class CrmLeadTaxonomyService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The three lists are structurally identical apart from `score_weight`
     * (sources) and `icon` (channels), so the Prisma delegate is selected once
     * here rather than branching in every method. `as any` is confined to this
     * one place: the delegates have different generated types that no shared
     * interface unifies.
     */
    private model(kind: LeadTaxonomyKind) {
        if (kind === LeadTaxonomyKind.SOURCE) return this.db.leadSourceOption as any;
        if (kind === LeadTaxonomyKind.CATEGORY) return this.db.leadCategoryOption as any;
        return this.db.conversationChannel as any;
    }

    /** The table + column that reference this list. */
    private consumer(kind: LeadTaxonomyKind): Consumer {
        return CONSUMERS[kind];
    }

    private label(kind: LeadTaxonomyKind) {
        return LABELS[kind];
    }

    async list(
        tenantId: string,
        kind: LeadTaxonomyKind,
        includeInactive = false,
    ): Promise<TaxonomyOption[]> {
        return this.model(kind).findMany({
            where: {
                tenant_id: tenantId,
                ...(includeInactive ? {} : { is_active: true }),
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
    }

    /**
     * Usage counts per row, for the CRM Setup screen. Returned as a map so the
     * list + usage pair costs two queries rather than one per row.
     */
    async usage(tenantId: string, kind: LeadTaxonomyKind): Promise<Record<string, number>> {
        const { table, fk } = this.consumer(kind);
        const grouped = await (this.db[table] as any).groupBy({
            by: [fk],
            where: { tenant_id: tenantId, [fk]: { not: null } } as any,
            _count: { _all: true },
        });
        const out: Record<string, number> = {};
        for (const row of grouped as any[]) {
            const id = row[fk];
            if (id) out[id] = row._count._all;
        }
        return out;
    }

    private async assertNameFree(
        tenantId: string,
        kind: LeadTaxonomyKind,
        name: string,
        exceptId?: string,
    ) {
        // Case-insensitive check in the app layer. The DB's
        // @@unique([tenant_id, name]) is exact-match, so it backstops identical
        // names but not "Meta Ads" vs "meta ads". Two admins racing on
        // differently-cased names can still both succeed; the cost is a
        // duplicate row a tenant can merge, not corruption.
        const rows = await this.model(kind).findMany({
            where: { tenant_id: tenantId, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true, name: true },
        });
        const target = normalizeName(name);
        if (rows.some((r: { name: string }) => normalizeName(r.name) === target)) {
            throw new ConflictException(`${this.label(kind)} "${name}" already exists.`);
        }
    }

    /** Codes are generated once and never follow renames, so they must be unique per tenant. */
    private async allocateCode(tenantId: string, kind: LeadTaxonomyKind, name: string) {
        const base = slugifyCode(name);
        const existing = await this.model(kind).findMany({
            where: { tenant_id: tenantId, code: { startsWith: base } },
            select: { code: true },
        });
        const taken = new Set(existing.map((r: { code: string }) => r.code));
        if (!taken.has(base)) return base;
        for (let i = 2; i < 1000; i++) {
            const candidate = `${base}_${i}`;
            if (!taken.has(candidate)) return candidate;
        }
        throw new BadRequestException(`Could not allocate a code for "${name}".`);
    }

    async create(tenantId: string, kind: LeadTaxonomyKind, dto: CreateLeadTaxonomyDto) {
        await this.assertNameFree(tenantId, kind, dto.name);
        const code = await this.allocateCode(tenantId, kind, dto.name);

        const max = await this.model(kind).aggregate({
            where: { tenant_id: tenantId },
            _max: { sort_order: true },
        });

        return this.model(kind).create({
            data: {
                tenant_id: tenantId,
                code,
                name: dto.name,
                sort_order: dto.sort_order ?? (max._max.sort_order ?? 0) + 1,
                is_system: false,
                is_active: true,
                ...(kind === LeadTaxonomyKind.SOURCE
                    ? { score_weight: dto.score_weight ?? 5 }
                    : {}),
                ...(kind === LeadTaxonomyKind.CHANNEL ? { icon: dto.icon || null } : {}),
            },
        });
    }

    private async findOwned(tenantId: string, kind: LeadTaxonomyKind, id: string) {
        const row = await this.model(kind).findFirst({ where: { id, tenant_id: tenantId } });
        if (!row) throw new NotFoundException(`${this.label(kind)} not found.`);
        return row;
    }

    async update(
        tenantId: string,
        kind: LeadTaxonomyKind,
        id: string,
        dto: UpdateLeadTaxonomyDto,
    ) {
        const row = await this.findOwned(tenantId, kind, id);

        if (dto.name && dto.name !== row.name) {
            await this.assertNameFree(tenantId, kind, dto.name, id);
        }

        // The fallback row is what lead creation, CSV import and the backfill all
        // fall back to. It can be renamed, but it must always be selectable.
        if (
            dto.is_active === false &&
            kind === LeadTaxonomyKind.SOURCE &&
            row.code === FALLBACK_SOURCE_CODE
        ) {
            throw new BadRequestException(
                'The fallback lead source cannot be deactivated — it is used whenever no other source applies.',
            );
        }

        if (dto.is_active === false && row.is_active) {
            await this.assertNotLastActiveChannel(tenantId, kind, id);
        }

        return this.model(kind).update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
                ...(kind === LeadTaxonomyKind.SOURCE && dto.score_weight !== undefined
                    ? { score_weight: dto.score_weight }
                    : {}),
                ...(kind === LeadTaxonomyKind.CHANNEL && dto.icon !== undefined
                    ? { icon: dto.icon || null }
                    : {}),
            },
        });
    }

    /**
     * Channels have no protected fallback the way sources do — any of them can be
     * retired. What cannot happen is the last one going, because then the
     * log-conversation form has nothing to offer and conversations stop being
     * loggable at all. Sources and categories are unaffected: a lead can be
     * created without either.
     */
    private async assertNotLastActiveChannel(
        tenantId: string,
        kind: LeadTaxonomyKind,
        id: string,
    ) {
        if (kind !== LeadTaxonomyKind.CHANNEL) return;
        const remaining = await this.model(kind).count({
            where: { tenant_id: tenantId, is_active: true, id: { not: id } },
        });
        if (remaining === 0) {
            throw new BadRequestException(
                'At least one conversation channel must stay active — otherwise conversations cannot be logged.',
            );
        }
    }

    /**
     * Remove a row, moving whatever uses it — leads, or conversations for the
     * channel list — onto `reassignTo` first.
     *
     * Seeded (`is_system`) rows deactivate rather than delete: the idempotent
     * `sync-lead-taxonomy` re-creates missing defaults on every container start,
     * so a hard delete would silently come back.
     */
    async remove(
        tenantId: string,
        kind: LeadTaxonomyKind,
        id: string,
        reassignTo?: string,
    ) {
        const row = await this.findOwned(tenantId, kind, id);
        const { table, fk, noun } = this.consumer(kind);
        const consumerModel = this.db[table] as any;

        if (kind === LeadTaxonomyKind.SOURCE && row.code === FALLBACK_SOURCE_CODE) {
            throw new BadRequestException(
                'The fallback lead source cannot be deleted — it is used whenever no other source applies.',
            );
        }

        // Only when the row is still active — removing an already-hidden channel
        // does not change how many are selectable, so it must not be blocked.
        if (row.is_active) {
            await this.assertNotLastActiveChannel(tenantId, kind, id);
        }

        const inUse = await consumerModel.count({
            where: { tenant_id: tenantId, [fk]: id } as any,
        });

        if (inUse > 0) {
            if (!reassignTo) {
                throw new ConflictException({
                    message:
                        `${this.label(kind)} "${row.name}" is used by ${inUse} ${noun}(s). ` +
                        'Choose a replacement to move them to.',
                    inUse,
                    requiresReassign: true,
                });
            }
            if (reassignTo === id) {
                throw new BadRequestException(`Cannot reassign ${noun}s to the row being removed.`);
            }
            const target = await this.findOwned(tenantId, kind, reassignTo);
            await consumerModel.updateMany({
                where: { tenant_id: tenantId, [fk]: id } as any,
                // `LeadConversation.type` mirrors the channel's code and is what every
                // filter and groupBy reads, so it has to move with the FK or the
                // reassigned rows keep reporting under a channel that no longer exists.
                data: {
                    [fk]: target.id,
                    ...(kind === LeadTaxonomyKind.CHANNEL ? { type: target.code } : {}),
                } as any,
            });
        }

        if (row.is_system) {
            return this.model(kind).update({ where: { id }, data: { is_active: false } });
        }

        await this.model(kind).delete({ where: { id } });
        return { success: true, reassigned: inUse };
    }

    /**
     * Resolve a client-supplied id for a write to a lead, verifying tenant
     * ownership. Returns the row so callers can dual-write the legacy enum
     * column and read `score_weight` without a second query.
     */
    async resolveForWrite(tenantId: string, kind: LeadTaxonomyKind, id: string) {
        const row = await this.model(kind).findFirst({ where: { id, tenant_id: tenantId } });
        if (!row) throw new BadRequestException(`${this.label(kind)} not found.`);
        if (!row.is_active) {
            throw new BadRequestException(`${this.label(kind)} "${row.name}" is deactivated.`);
        }
        return row;
    }

    /**
     * Resolve a value that may be either a row id or a `code`.
     *
     * The lead API accepts both so existing clients that still send the old enum
     * strings ("WALK_IN") keep working alongside the id-based settings UI. Name
     * is matched too, so a CSV column holding the display label resolves rather
     * than silently falling back.
     */
    async resolveByIdOrCode(tenantId: string, kind: LeadTaxonomyKind, value: string) {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const byId = await this.model(kind).findFirst({
            where: { id: trimmed, tenant_id: tenantId },
        });
        if (byId) return byId;

        const rows = await this.model(kind).findMany({ where: { tenant_id: tenantId } });
        const upper = trimmed.toUpperCase();
        const byCode = rows.find((r: { code: string }) => r.code.toUpperCase() === upper);
        if (byCode) return byCode;

        const normalized = normalizeName(trimmed);
        return rows.find((r: { name: string }) => normalizeName(r.name) === normalized) ?? null;
    }

    /** The tenant's fallback source row, used when a lead names no source. */
    async fallbackSource(tenantId: string) {
        return this.db.leadSourceOption.findFirst({
            where: { tenant_id: tenantId, code: FALLBACK_SOURCE_CODE },
        });
    }
}
