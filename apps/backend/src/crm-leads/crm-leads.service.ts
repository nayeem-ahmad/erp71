import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CreateLeadDto, LeadStatus, UpdateLeadDto } from './crm-leads.dto';
import { paginate } from '../common/pagination.dto';

@Injectable()
export class CrmLeadsService {
    constructor(
        private db: DatabaseService,
        private customersService: CustomersService,
    ) {}

    async create(tenantId: string, userId: string, dto: CreateLeadDto) {
        const existing = await this.db.lead.findUnique({
            where: { tenant_id_phone: { tenant_id: tenantId, phone: dto.phone } },
            select: { id: true },
        });
        if (existing) {
            throw new BadRequestException('A lead with this phone number already exists.');
        }

        return this.db.lead.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                address: dto.address,
                source: dto.source ?? 'OTHER',
                status: dto.status ?? 'NEW',
                assigned_to: dto.assigned_to,
                notes: dto.notes,
                store_id: dto.store_id,
                created_by: userId,
            },
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                creator: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async findAll(
        tenantId: string,
        opts: {
            status?: string;
            source?: string;
            assignedTo?: string;
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
        if (opts.assignedTo) where.assigned_to = opts.assignedTo;
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search, mode: 'insensitive' } },
                { email: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.lead.findMany({
                where,
                include: {
                    assignee: { select: { id: true, name: true, email: true } },
                    convertedCustomer: { select: { id: true, name: true, phone: true } },
                },
                orderBy: { updated_at: 'desc' },
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
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                creator: { select: { id: true, name: true, email: true } },
                convertedCustomer: { select: { id: true, name: true, phone: true } },
            },
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

        if (dto.phone && dto.phone !== existing.phone) {
            const phoneTaken = await this.db.lead.findUnique({
                where: { tenant_id_phone: { tenant_id: tenantId, phone: dto.phone } },
                select: { id: true },
            });
            if (phoneTaken) {
                throw new BadRequestException('A lead with this phone number already exists.');
            }
        }

        return this.db.lead.update({
            where: { id },
            data: dto,
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                convertedCustomer: { select: { id: true, name: true, phone: true } },
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.lead.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead not found');
        await this.db.lead.delete({ where: { id } });
        return { success: true };
    }

    async convert(tenantId: string, id: string) {
        const lead = await this.db.lead.findFirst({ where: { id, tenant_id: tenantId } });
        if (!lead) throw new NotFoundException('Lead not found');
        if (lead.status === LeadStatus.CONVERTED) {
            throw new BadRequestException('Lead is already converted.');
        }

        const existingCustomer = await this.db.customer.findFirst({
            where: { tenant_id: tenantId, phone: lead.phone, deleted_at: null },
            select: { id: true, name: true, phone: true },
        });
        if (existingCustomer) {
            throw new ConflictException({
                message: 'A customer with this phone number already exists.',
                customerId: existingCustomer.id,
            });
        }

        const customer = await this.customersService.create(tenantId, {
            name: lead.name,
            phone: lead.phone,
            email: lead.email ?? undefined,
            address: lead.address ?? undefined,
        });

        const updatedLead = await this.db.lead.update({
            where: { id },
            data: {
                status: LeadStatus.CONVERTED,
                converted_customer_id: customer.id,
            },
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                convertedCustomer: { select: { id: true, name: true, phone: true } },
            },
        });

        return { lead: updatedLead, customer };
    }
}