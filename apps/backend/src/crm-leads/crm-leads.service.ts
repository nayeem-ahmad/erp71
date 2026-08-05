import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import {
    BulkLeadActionDto,
    CreateLeadDto,
    isClosedStatus,
    LeadBulkAction,
    LeadPriority,
    LeadStatus,
    UpdateLeadDto,
} from './crm-leads.dto';
import { paginate } from '../common/pagination.dto';
import { computeLeadScore, DEFAULT_SOURCE_WEIGHT } from './lead-scoring.util';
import { runImport, ImportResult } from '../common/import.util';
import { resolveOrderBy, SortableMap } from '../common/sort.util';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadTaxonomyKind } from '../crm-lead-taxonomy/lead-taxonomy.dto';
import {
    buildTaxonomyIndex,
    coerceLegacyCategory,
    coerceLegacySource,
    resolveImportRef,
} from '../crm-lead-taxonomy/lead-taxonomy.util';

const taxonomySelect = { select: { id: true, code: true, name: true } } as const;

const leadIncludes = {
    assignee: { select: { id: true, name: true, email: true } },
    nextStepAssignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
    convertedCustomer: { select: { id: true, name: true, phone: true } },
    sourceOption: { select: { id: true, code: true, name: true, score_weight: true } },
    categoryOption: taxonomySelect,
} as const;

// `category`/`source` sort through the relation so the list orders by the label
// the tenant actually sees, and so these keep working once the enum columns go.
const LEAD_SORTABLE: SortableMap = {
    name: (dir) => ({ name: dir }),
    category: (dir) => ({ categoryOption: { name: dir } }),
    source: (dir) => ({ sourceOption: { name: dir } }),
    priority: (dir) => ({ priority: dir }),
    status: (dir) => ({ status: dir }),
    score: (dir) => ({ score: dir }),
    next_step_date: (dir) => ({ next_step_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const LEAD_DEFAULT_ORDER = [{ next_step_date: 'asc' as const }, { updated_at: 'desc' as const }];

@Injectable()
export class CrmLeadsService {
    constructor(
        private db: DatabaseService,
        private customersService: CustomersService,
        private customFields: CustomFieldsService,
        private taxonomy: CrmLeadTaxonomyService,
    ) {}

    private mapLeadData(dto: CreateLeadDto | UpdateLeadDto) {
        // `source`/`category` are stripped: they name a taxonomy row rather than
        // holding a column value, and are resolved into source_id/category_id
        // (plus the dual-written legacy enum) by the caller.
        const {
            custom_fields: _ignoredCustomFields,
            source: _ignoredSource,
            category: _ignoredCategory,
            ...rest
        } = dto as any;
        const data: Record<string, unknown> = { ...rest };
        if ('next_step_date' in dto && dto.next_step_date) {
            data.next_step_date = new Date(dto.next_step_date);
        }
        if ('next_step_date' in dto && dto.next_step_date === null) {
            data.next_step_date = null;
        }
        return data;
    }

    /**
     * Resolve a client-supplied source/category reference (row id, `code`, or
     * display name) against the tenant's own rows.
     *
     * Throws rather than falling back on an unknown value — silently rewriting a
     * lead's provenance to OTHER is what the old `resolveEnum` did, and it made
     * bad imports invisible.
     */
    private async resolveTaxonomy(
        tenantId: string,
        kind: LeadTaxonomyKind,
        value: string | null | undefined,
    ) {
        if (value === undefined) return undefined;
        if (value === null || String(value).trim() === '') return null;
        const row = await this.taxonomy.resolveByIdOrCode(tenantId, kind, String(value));
        if (!row) {
            const label = kind === LeadTaxonomyKind.SOURCE ? 'source' : 'category';
            throw new BadRequestException(`Unknown lead ${label}: "${value}".`);
        }
        return row;
    }

    /**
     * Fold a patch's source/category references into the update payload.
     *
     * A field absent from the patch (`undefined`) is left alone; an explicitly
     * cleared one (`null`/empty) is nulled — except source, which is NOT NULL on
     * the legacy column and so falls back to the tenant's OTHER row instead.
     */
    private async applyTaxonomyPatch(
        tenantId: string,
        dto: UpdateLeadDto,
        data: Record<string, unknown>,
    ) {
        const sourceRow = await this.resolveTaxonomy(tenantId, LeadTaxonomyKind.SOURCE, dto.source);
        if (sourceRow !== undefined) {
            const resolved = sourceRow ?? (await this.taxonomy.fallbackSource(tenantId));
            data.source_id = resolved?.id ?? null;
            data.source = coerceLegacySource(resolved?.code);
        }

        const categoryRow = await this.resolveTaxonomy(
            tenantId,
            LeadTaxonomyKind.CATEGORY,
            dto.category,
        );
        if (categoryRow !== undefined) {
            data.category_id = categoryRow?.id ?? null;
            data.category = coerceLegacyCategory(categoryRow?.code);
        }
    }

    async create(tenantId: string, userId: string, dto: CreateLeadDto) {
        if (dto.mobile) {
            const existing = await this.db.lead.findUnique({
                where: { tenant_id_mobile: { tenant_id: tenantId, mobile: dto.mobile } },
                select: { id: true },
            });
            if (existing) {
                throw new BadRequestException('A lead with this mobile number already exists.');
            }
        }

        const status = dto.status ?? LeadStatus.NEW;
        if (status === LeadStatus.LOST && !dto.lost_reason) {
            throw new BadRequestException('lost_reason is required when creating a lead with status LOST.');
        }

        const priority = dto.priority ?? 'MEDIUM';

        // A lead always has a source. When none is named, fall back to the
        // tenant's OTHER row — which may itself be absent on a tenant that has
        // not been synced yet, hence the null-tolerant handling below.
        const sourceRow =
            (await this.resolveTaxonomy(tenantId, LeadTaxonomyKind.SOURCE, dto.source)) ??
            (await this.taxonomy.fallbackSource(tenantId));
        const categoryRow = await this.resolveTaxonomy(
            tenantId,
            LeadTaxonomyKind.CATEGORY,
            dto.category,
        );

        const nextStepDate = dto.next_step_date ? new Date(dto.next_step_date) : null;
        const score = computeLeadScore(
            {
                status,
                sourceWeight: sourceRow?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority,
                last_contacted_at: null,
                next_step_date: nextStepDate,
            },
            0,
        );

        const customFields = await this.customFields.sanitizeValues(
            tenantId,
            CustomFieldEntity.LEAD,
            dto.custom_fields,
        );

        return this.db.lead.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                mobile: dto.mobile,
                email: dto.email,
                address: dto.address,
                category_id: categoryRow?.id ?? null,
                category: coerceLegacyCategory(categoryRow?.code),
                priority,
                remarks: dto.remarks,
                source_id: sourceRow?.id ?? null,
                source: coerceLegacySource(sourceRow?.code),
                status,
                lost_reason: status === LeadStatus.LOST ? dto.lost_reason : undefined,
                // A lead can be filed already-lost (a walk-in who bought elsewhere),
                // in which case it closed the moment it was created.
                closed_at: isClosedStatus(status) ? new Date() : undefined,
                score,
                linkedin_url: dto.linkedin_url,
                fb_url: dto.fb_url,
                x_url: dto.x_url,
                website_url: dto.website_url,
                next_step: dto.next_step,
                next_step_date: nextStepDate ?? undefined,
                next_step_assigned_to: dto.next_step_assigned_to,
                assigned_to: dto.assigned_to,
                store_id: dto.store_id,
                created_by: userId,
                custom_fields: customFields ?? undefined,
            },
            include: leadIncludes,
        });
    }

    async findAll(
        tenantId: string,
        opts: {
            status?: string;
            source?: string;
            category?: string;
            priority?: string;
            assignedTo?: string;
            myActionsToday?: boolean;
            userId?: string;
            search?: string;
            page?: number;
            limit?: number;
            sortBy?: string;
            sortDir?: string;
        },
    ) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.status) where.status = opts.status;
        // Filters carry a taxonomy row id. A stale bookmarked filter naming a
        // deleted row simply matches nothing, rather than erroring.
        if (opts.source) where.source_id = opts.source;
        if (opts.category) where.category_id = opts.category;
        if (opts.priority) where.priority = opts.priority;
        if (opts.assignedTo) where.assigned_to = opts.assignedTo;
        if (opts.myActionsToday && opts.userId) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            where.next_step_assigned_to = opts.userId;
            where.next_step_date = { gte: today, lt: tomorrow };
        }
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { mobile: { contains: opts.search, mode: 'insensitive' } },
                { email: { contains: opts.search, mode: 'insensitive' } },
                { remarks: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.lead.findMany({
                where,
                include: leadIncludes,
                orderBy: resolveOrderBy(opts.sortBy, opts.sortDir, LEAD_SORTABLE, LEAD_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.lead.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const lead = await this.db.lead.findFirst({
            where: { id, tenant_id: tenantId },
            include: leadIncludes,
        });
        if (!lead) throw new NotFoundException('Lead not found');
        return lead;
    }

    /**
     * Folds a status change into the update payload: the lost reason it requires,
     * and the close timestamp the CRM dashboard counts periods by.
     *
     * Only a *transition* stamps `closed_at` — re-saving an already-lost lead must
     * not move it, or won/lost-in-period would follow whoever edited the row last.
     * Reopening a closed lead clears it.
     */
    private applyStatusTransition(
        // `status` is typed loosely because the row comes back carrying Prisma's
        // own LeadStatus enum, which is structurally identical but nominally
        // distinct from the DTO's.
        existing: { status: string; lost_reason: string | null },
        dto: UpdateLeadDto,
        data: Record<string, unknown>,
    ) {
        const changed = Boolean(dto.status) && dto.status !== existing.status;
        const nextStatus = dto.status ?? existing.status;

        if (nextStatus === LeadStatus.LOST) {
            const reason = dto.lost_reason ?? existing.lost_reason;
            if (!reason) {
                throw new BadRequestException('lost_reason is required when marking a lead as LOST.');
            }
            data.lost_reason = reason;
        } else if (changed) {
            data.lost_reason = null;
        }

        if (changed) {
            data.closed_at = isClosedStatus(nextStatus) ? new Date() : null;
        }
    }

    async update(tenantId: string, id: string, dto: UpdateLeadDto) {
        const existing = await this.db.lead.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead not found');
        if (existing.status === LeadStatus.CONVERTED) {
            throw new BadRequestException('Converted leads cannot be edited.');
        }

        if (dto.mobile && dto.mobile !== existing.mobile) {
            const mobileTaken = await this.db.lead.findUnique({
                where: { tenant_id_mobile: { tenant_id: tenantId, mobile: dto.mobile } },
                select: { id: true },
            });
            if (mobileTaken) {
                throw new BadRequestException('A lead with this mobile number already exists.');
            }
        }

        const data = this.mapLeadData(dto);

        await this.applyTaxonomyPatch(tenantId, dto, data);

        const customFields = await this.customFields.sanitizeValues(
            tenantId,
            CustomFieldEntity.LEAD,
            dto.custom_fields,
        );
        if (customFields !== undefined) {
            data.custom_fields = customFields;
        }

        const nextStatus = dto.status ?? existing.status;
        this.applyStatusTransition(existing, dto, data);

        // Weight comes from the lead's (possibly just-changed) source row; an
        // unbackfilled lead has no row yet and scores at the default.
        const effectiveSourceId = (data.source_id as string | null | undefined) ?? existing.source_id;
        const weightRow = effectiveSourceId
            ? await this.db.leadSourceOption.findFirst({
                where: { id: effectiveSourceId, tenant_id: tenantId },
                select: { score_weight: true },
            })
            : null;

        const conversationCount = await this.db.leadConversation.count({ where: { lead_id: id } });
        data.score = computeLeadScore(
            {
                status: nextStatus,
                sourceWeight: weightRow?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority: dto.priority ?? existing.priority,
                last_contacted_at: existing.last_contacted_at,
                next_step_date:
                    'next_step_date' in data
                        ? (data.next_step_date as Date | null)
                        : existing.next_step_date,
            },
            conversationCount,
        );

        return this.db.lead.update({
            where: { id },
            data,
            include: leadIncludes,
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.lead.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead not found');
        await this.db.lead.delete({ where: { id } });
        return { success: true };
    }

    /** Apply a single action to many leads at once. All operations are tenant-scoped. */
    async bulkAction(tenantId: string, dto: BulkLeadActionDto) {
        const { ids, action, value } = dto;
        const where = { tenant_id: tenantId, id: { in: ids } };

        if (action === LeadBulkAction.DELETE) {
            const res = await this.db.lead.deleteMany({ where });
            return { count: res.count };
        }

        if (action === LeadBulkAction.ASSIGN) {
            const assignee = value && value.trim() ? value.trim() : null;
            const res = await this.db.lead.updateMany({ where, data: { assigned_to: assignee } });
            return { count: res.count };
        }

        if (action === LeadBulkAction.STATUS) {
            const status = value as LeadStatus;
            if (!status || !Object.values(LeadStatus).includes(status)) {
                throw new BadRequestException('Invalid status.');
            }
            if (status === LeadStatus.LOST || status === LeadStatus.CONVERTED) {
                throw new BadRequestException(
                    'Bulk status change to LOST or CONVERTED is not supported — edit those leads individually.',
                );
            }
            const res = await this.db.lead.updateMany({ where, data: { status } });
            return { count: res.count };
        }

        throw new BadRequestException('Unsupported bulk action.');
    }

    /** Counts of leads per pipeline stage, for the CRM hub dashboard. */
    async getStatusSummary(tenantId: string) {
        const grouped = await this.db.lead.groupBy({
            by: ['status'],
            where: { tenant_id: tenantId },
            _count: { _all: true },
        });

        const counts: Record<string, number> = {};
        for (const status of Object.values(LeadStatus)) {
            counts[status] = 0;
        }
        for (const row of grouped) {
            counts[row.status] = row._count._all;
        }

        const open = counts.NEW + counts.CONTACTED + counts.QUALIFIED;
        return { counts, open };
    }

    private resolveEnum<T extends string>(raw: unknown, allowed: T[]): T | undefined {
        if (raw === undefined || raw === null) return undefined;
        const value = String(raw).trim().toUpperCase();
        return allowed.includes(value as T) ? (value as T) : undefined;
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        const defs = await this.customFields.listDefinitions(
            tenantId,
            CustomFieldEntity.LEAD,
        );

        // Prefetched once, not per row: the importer accepts up to 5000 rows.
        // Inactive rows are included so importing historical data onto a
        // retired source still lands on the right row instead of failing.
        const [sourceRows, categoryRows] = await Promise.all([
            this.taxonomy.list(tenantId, LeadTaxonomyKind.SOURCE, true),
            this.taxonomy.list(tenantId, LeadTaxonomyKind.CATEGORY, true),
        ]);
        const sourceIndex = buildTaxonomyIndex(sourceRows);
        const categoryIndex = buildTaxonomyIndex(categoryRows);
        const fallbackSource = await this.taxonomy.fallbackSource(tenantId);

        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => {
                const rawStatus = raw.status != null && String(raw.status).trim() !== ''
                    ? (this.resolveEnum(raw.status, Object.values(LeadStatus) as string[]) ?? LeadStatus.NEW)
                    : undefined;
                if (rawStatus === LeadStatus.LOST) {
                    throw new Error('status LOST requires a lost_reason, which import does not support — set status after import instead');
                }
                return {
                    name: String(raw.name ?? '').trim(),
                    mobile: String(raw.mobile ?? '').trim() || null,
                    email: raw.email ? String(raw.email).trim() || null : null,
                    address: raw.address ? String(raw.address).trim() || null : null,
                    remarks: raw.remarks ? String(raw.remarks).trim() || null : null,
                    // Unknown values fail the row rather than being silently
                    // rewritten to OTHER. runImport turns the throw into
                    // "Row N: <message>", which tells the shop owner exactly
                    // which cell to fix — the old behaviour corrupted the
                    // lead's provenance and reported success.
                    category: resolveImportRef(raw.category, categoryIndex, 'category') ?? null,
                    priority: raw.priority != null && String(raw.priority).trim() !== ''
                        ? (this.resolveEnum(raw.priority, Object.values(LeadPriority) as string[]) ?? LeadPriority.MEDIUM)
                        : undefined,
                    source: resolveImportRef(raw.source, sourceIndex, 'source'),
                    status: rawStatus,
                    linkedin_url: raw.linkedin_url ? String(raw.linkedin_url).trim() || null : null,
                    fb_url: raw.fb_url ? String(raw.fb_url).trim() || null : null,
                    x_url: raw.x_url ? String(raw.x_url).trim() || null : null,
                    website_url: raw.website_url ? String(raw.website_url).trim() || null : null,
                    next_step: raw.next_step ? String(raw.next_step).trim() || null : null,
                    next_step_date: (() => {
                        const v = raw.next_step_date;
                        if (v == null || String(v).trim() === '') return null;
                        const d = new Date(String(v).trim());
                        return isNaN(d.getTime()) ? null : d;
                    })(),
                    custom_fields: defs.reduce<Record<string, string>>((acc, def) => {
                        const target = def.label.trim().toLowerCase();
                        const matchKey = Object.keys(raw).find(
                            (k) => k === def.key || k.trim().toLowerCase() === target,
                        );
                        const raw2 = matchKey !== undefined ? raw[matchKey] : undefined;
                        if (raw2 !== undefined && raw2 !== null && String(raw2).trim() !== '') {
                            acc[def.key] = String(raw2).trim().slice(0, 500);
                        }
                        return acc;
                    }, {}),
                };
            },
            findDuplicate: async (row) => {
                if (!row.mobile) return null;
                const existing = await this.db.lead.findUnique({
                    where: { tenant_id_mobile: { tenant_id: tenantId, mobile: row.mobile } },
                    select: { id: true },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const source = row.source ?? fallbackSource;
                const score = computeLeadScore(
                    {
                        status: row.status ?? LeadStatus.NEW as any,
                        sourceWeight: source?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                        priority: row.priority ?? LeadPriority.MEDIUM as any,
                        last_contacted_at: null,
                        next_step_date: row.next_step_date ?? null,
                    },
                    0,
                );
                await this.db.lead.create({
                    data: {
                        tenant_id: tenantId,
                        name: row.name,
                        mobile: row.mobile ?? undefined,
                        email: row.email ?? undefined,
                        address: row.address ?? undefined,
                        remarks: row.remarks ?? undefined,
                        category_id: row.category?.id ?? null,
                        category: coerceLegacyCategory(row.category?.code),
                        priority: row.priority ?? LeadPriority.MEDIUM,
                        source_id: source?.id ?? null,
                        source: coerceLegacySource(source?.code),
                        status: row.status ?? LeadStatus.NEW,
                        // Import can carry CONVERTED (a backlog of already-won deals);
                        // LOST is rejected upstream for want of a reason.
                        closed_at: isClosedStatus(row.status ?? LeadStatus.NEW) ? new Date() : undefined,
                        linkedin_url: row.linkedin_url ?? undefined,
                        fb_url: row.fb_url ?? undefined,
                        x_url: row.x_url ?? undefined,
                        website_url: row.website_url ?? undefined,
                        next_step: row.next_step ?? undefined,
                        next_step_date: row.next_step_date ?? undefined,
                        score,
                        custom_fields: Object.keys(row.custom_fields ?? {}).length
                            ? row.custom_fields
                            : undefined,
                    } as any,
                });
            },
            update: async (id, row) => {
                await this.db.lead.update({
                    where: { id },
                    data: {
                        name: row.name,
                        mobile: row.mobile,
                        ...(row.email    !== null      ? { email: row.email }       : {}),
                        ...(row.address  !== null      ? { address: row.address }   : {}),
                        ...(row.remarks  !== null      ? { remarks: row.remarks }   : {}),
                        ...(row.category !== null
                            ? {
                                category_id: row.category.id,
                                category: coerceLegacyCategory(row.category.code),
                            }
                            : {}),
                        ...(row.priority !== undefined ? { priority: row.priority } : {}),
                        ...(row.source !== undefined
                            ? {
                                source_id: row.source.id,
                                source: coerceLegacySource(row.source.code),
                            }
                            : {}),
                        // `closed_at` is deliberately not touched here. An upsert
                        // import is a bulk sync, not a deal being closed, and it
                        // re-runs over unchanged rows — stamping would re-date every
                        // won deal on every import. A lead moved to CONVERTED this
                        // way still counts in the all-time totals, just not in
                        // won-this-period until someone edits it for real.
                        ...(row.status   !== undefined ? { status: row.status }     : {}),
                        ...(row.linkedin_url !== null ? { linkedin_url: row.linkedin_url } : {}),
                        ...(row.fb_url       !== null ? { fb_url: row.fb_url }             : {}),
                        ...(row.x_url        !== null ? { x_url: row.x_url }               : {}),
                        ...(row.website_url  !== null ? { website_url: row.website_url }   : {}),
                        ...(row.next_step    !== null ? { next_step: row.next_step }       : {}),
                        ...(row.next_step_date !== null ? { next_step_date: row.next_step_date } : {}),
                        ...(Object.keys(row.custom_fields ?? {}).length
                            ? { custom_fields: row.custom_fields }
                            : {}),
                    } as any,
                });
            },
        });
    }

    async convert(tenantId: string, id: string) {
        const lead = await this.db.lead.findFirst({ where: { id, tenant_id: tenantId } });
        if (!lead) throw new NotFoundException('Lead not found');
        if (lead.status === LeadStatus.CONVERTED) {
            throw new BadRequestException('Lead is already converted.');
        }

        const existingCustomer = await this.db.customer.findFirst({
            where: { tenant_id: tenantId, phone: lead.mobile, deleted_at: null },
            select: { id: true, name: true, phone: true },
        });
        if (existingCustomer) {
            throw new ConflictException({
                message: 'A customer with this mobile number already exists.',
                customerId: existingCustomer.id,
            });
        }

        const customer = await this.customersService.create(tenantId, {
            name: lead.name,
            phone: lead.mobile,
            email: lead.email ?? undefined,
            address: lead.address ?? undefined,
        });

        const updatedLead = await this.db.lead.update({
            where: { id },
            data: {
                status: LeadStatus.CONVERTED,
                converted_customer_id: customer.id,
                closed_at: new Date(),
                score: 100,
            },
            include: leadIncludes,
        });

        return { lead: updatedLead, customer };
    }
}