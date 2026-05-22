import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateDeliveryDto, UpdateDeliveryDto } from './delivery.dto';

@Injectable()
export class DeliveryService {
    constructor(private readonly db: DatabaseService) {}

    async listDeliveries(tenantId: string, page: number, limit: number, status?: string) {
        const skip = (page - 1) * limit;
        const where: any = { tenantId };
        if (status) where.status = status;

        const [items, total] = await Promise.all([
            this.db.deliveryOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    saleId: true,
                    customerName: true,
                    customerPhone: true,
                    deliveryAddress: true,
                    driverName: true,
                    driverPhone: true,
                    status: true,
                    scheduledAt: true,
                    deliveredAt: true,
                    created_at: true,
                    updated_at: true,
                },
            }),
            this.db.deliveryOrder.count({ where }),
        ]);

        return {
            items,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
        };
    }

    async getDelivery(tenantId: string, id: string) {
        const delivery = await this.db.deliveryOrder.findFirst({
            where: { id, tenantId },
        });
        if (!delivery) throw new NotFoundException('Delivery order not found');
        return delivery;
    }

    async createDelivery(tenantId: string, dto: CreateDeliveryDto) {
        if (dto.saleId) {
            const sale = await this.db.sale.findFirst({
                where: { id: dto.saleId, tenant_id: tenantId },
                select: { id: true },
            });
            if (!sale) throw new BadRequestException('Sale not found or does not belong to this tenant');
        }

        return this.db.deliveryOrder.create({
            data: {
                tenantId,
                saleId: dto.saleId ?? null,
                customerName: dto.customerName,
                customerPhone: dto.customerPhone ?? null,
                deliveryAddress: dto.deliveryAddress,
                driverName: dto.driverName ?? null,
                driverPhone: dto.driverPhone ?? null,
                notes: dto.notes ?? null,
                scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
            },
        });
    }

    async updateDelivery(tenantId: string, id: string, dto: UpdateDeliveryDto) {
        await this.getDelivery(tenantId, id);

        const data: any = {};
        if (dto.driverName !== undefined) data.driverName = dto.driverName;
        if (dto.driverPhone !== undefined) data.driverPhone = dto.driverPhone;
        if (dto.deliveryAddress !== undefined) data.deliveryAddress = dto.deliveryAddress;
        if (dto.notes !== undefined) data.notes = dto.notes;
        if (dto.scheduledAt !== undefined) data.scheduledAt = new Date(dto.scheduledAt);
        if (dto.status !== undefined) {
            data.status = dto.status;
            if (dto.status === 'DELIVERED') data.deliveredAt = new Date();
        }

        return this.db.deliveryOrder.update({ where: { id }, data });
    }

    async cancelDelivery(tenantId: string, id: string) {
        await this.getDelivery(tenantId, id);
        return this.db.deliveryOrder.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });
    }
}
