import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateInteractionDto, UpdateInteractionDto } from './crm-interactions.dto';
import { paginate } from '../common/pagination.dto';

@Injectable()
export class CrmInteractionsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreateInteractionDto) {
        const customer = await this.db.customer.findFirst({
            where: { id: dto.customer_id, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const [interaction] = await this.db.$transaction([
            this.db.customerInteraction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: dto.customer_id,
                    type: dto.type,
                    direction: dto.direction ?? 'OUTBOUND',
                    summary: dto.summary,
                    outcome: dto.outcome,
                    store_id: dto.store_id,
                    created_by: userId,
                },
                include: { creator: { select: { id: true, name: true, email: true } } },
            }),
            this.db.customer.update({
                where: { id: dto.customer_id },
                data: { last_contacted_at: new Date() },
            }),
        ]);

        return interaction;
    }

    async findAll(
        tenantId: string,
        opts: { customerId?: string; page?: number; limit?: number },
    ) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.customerId) where.customer_id = opts.customerId;

        const [items, total] = await Promise.all([
            this.db.customerInteraction.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true, email: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.customerInteraction.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const item = await this.db.customerInteraction.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                creator: { select: { id: true, name: true, email: true } },
            },
        });
        if (!item) throw new NotFoundException('Interaction not found');
        return item;
    }

    async update(tenantId: string, id: string, dto: UpdateInteractionDto) {
        const existing = await this.db.customerInteraction.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Interaction not found');

        return this.db.customerInteraction.update({
            where: { id },
            data: dto,
            include: { creator: { select: { id: true, name: true, email: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.customerInteraction.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Interaction not found');
        await this.db.customerInteraction.delete({ where: { id } });
        return { success: true };
    }
}
