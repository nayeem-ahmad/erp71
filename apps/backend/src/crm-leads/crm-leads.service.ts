import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CreateLeadDto, LeadCategory, LeadPriority, LeadSource, LeadStatus, UpdateLeadDto } from './crm-leads.dto';
import { paginate } from '../common/pagination.dto';
import { computeLeadScore } from './lead-scoring.util';
import { runImport, ImportResult } from '../common/import.util';

const leadIncludes = {
    assignee: { select: { id: true, name: true, email: true } },
    nextStepAssignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
    convertedCustomer: { select: { id: true, name: true, phone: true } },
} as const;

@Injectable()
export class CrmLeadsService {
    constructor(
        private db: DatabaseService,
        private customersService: CustomersService,
    ) {}

    private mapLeadData(dto: CreateLeadDto | UpdateLeadDto) {
        const data: Record<string, unknown> = { ...dto };
        if ('next_step_date' in dto && dto.next_step_date) {
            data.next_step_date = new Date(dto.next_step_date);
        }
        if ('next_step_date' in dto && dto.next_step_date === null) {
            data.next_step_date = null;
        }
        return data;
    }

    async create(tenantId: string, userId: string, dto: CreateLeadDto) {
        const existing = await this.db.lead.findUnique({
            where: { tenant_id_mobile: { tenant_id: tenantId, mobile: dto.mobile } },
            select: { id: true },
        });
        if (existing) {
            throw new BadRequestException('A lead with this mobile number already exists.');
        }

        const status = dto.status ?? LeadStatus.NEW;
        if (status === LeadStatus.LOST && !dto.lost_reason) {
            throw new BadRequestException('lost_reason is required when creating a lead with status LOST.');
        }

        const priority = dto.priority ?? 'MEDIUM';
        const source = dto.source ?? 'OTHER';
        const nextStepDate = dto.next_step_date ? new Date(dto.next_step_date) : null;
        const score = computeLeadScore(
            { status, source, priority, last_contacted_at: null, next_step_date: nextStepDate },
            0,
        );

        return this.db.lead.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                mobile: dto.mobile,
                email: dto.email,
                address: dto.address,
                category: dto.category,
                priority,
                remarks: dto.remarks,
                source,
                status,
                lost_reason: status === LeadStatus.LOST ? dto.lost_reason : undefined,
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
        },
    ) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.status) where.status = opts.status;
        if (opts.source) where.source = opts.source;
        if (opts.category) where.category = opts.category;
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
                orderBy: [{ next_step_date: 'asc' }, { updated_at: 'desc' }],
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

        const nextStatus = dto.status ?? existing.status;
        if (nextStatus === LeadStatus.LOST) {
            const reason = dto.lost_reason ?? existing.lost_reason;
            if (!reason) {
                throw new BadRequestException('lost_reason is required when marking a lead as LOST.');
            }
            data.lost_reason = reason;
        } else if (dto.status && dto.status !== existing.status) {
            data.lost_reason = null;
        }

        const conversationCount = await this.db.leadConversation.count({ where: { lead_id: id } });
        data.score = computeLeadScore(
            {
                status: nextStatus,
                source: dto.source ?? existing.source,
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
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name', 'mobile'],
            castRow: (raw) => {
                const status = this.resolveEnum(raw.status, Object.values(LeadStatus) as string[]) ?? LeadStatus.NEW;
                if (status === LeadStatus.LOST) {
                    throw new Error('status LOST requires a lost_reason, which import does not support — set status after import instead');
                }
                return {
                    name: String(raw.name ?? '').trim(),
                    mobile: String(raw.mobile ?? '').trim(),
                    email: raw.email ? String(raw.email).trim() || null : null,
                    address: raw.address ? String(raw.address).trim() || null : null,
                    remarks: raw.remarks ? String(raw.remarks).trim() || null : null,
                    category: this.resolveEnum(raw.category, Object.values(LeadCategory) as string[]) ?? null,
                    priority: this.resolveEnum(raw.priority, Object.values(LeadPriority) as string[]) ?? LeadPriority.MEDIUM,
                    source: this.resolveEnum(raw.source, Object.values(LeadSource) as string[]) ?? LeadSource.OTHER,
                    status,
                };
            },
            findDuplicate: async (row) => {
                const existing = await this.db.lead.findUnique({
                    where: { tenant_id_mobile: { tenant_id: tenantId, mobile: row.mobile } },
                    select: { id: true },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const score = computeLeadScore(
                    { status: row.status, source: row.source, priority: row.priority, last_contacted_at: null, next_step_date: null },
                    0,
                );
                await this.db.lead.create({
                    data: {
                        tenant_id: tenantId,
                        name: row.name,
                        mobile: row.mobile,
                        email: row.email,
                        address: row.address,
                        remarks: row.remarks,
                        category: row.category,
                        priority: row.priority,
                        source: row.source,
                        status: row.status,
                        score,
                    },
                });
            },
            update: async (id, row) => {
                await this.db.lead.update({
                    where: { id },
                    data: {
                        name: row.name,
                        mobile: row.mobile,
                        ...(row.email    !== null ? { email: row.email }       : {}),
                        ...(row.address  !== null ? { address: row.address }   : {}),
                        ...(row.remarks  !== null ? { remarks: row.remarks }   : {}),
                        ...(row.category !== null ? { category: row.category } : {}),
                        priority: row.priority,
                        source: row.source,
                        status: row.status,
                    },
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
                score: 100,
            },
            include: leadIncludes,
        });

        return { lead: updatedLead, customer };
    }
}