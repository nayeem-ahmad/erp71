import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { createdAtRange } from '../common/created-range.util';
import { zonedDayRange } from '../common/tenant-time.util';
import { idsOrNoneClause, searchClause, statusSetClause } from '../common/sales-document-list-filters';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { CreateDeliveryDto, UpdateDeliveryDto } from './delivery.dto';

/** A delivery still on its way: not yet handed over, failed or called off. */
export const OPEN_DELIVERY_STATUSES = ['PENDING', 'IN_TRANSIT'];

const DELIVERY_SORTABLE: SortableMap = {
    customerName: (dir) => ({ customerName: dir }),
    driver: (dir) => ({ driverName: { sort: dir, nulls: 'last' } }),
    status: (dir) => ({ status: dir }),
    scheduledAt: (dir) => ({ scheduledAt: { sort: dir, nulls: 'last' } }),
    created_at: (dir) => ({ created_at: dir }),
};

/** What narrows the delivery list — and, alike, its stats strip. */
export interface DeliveryListFilters {
    search?: string;
    statuses?: string[];
    statusExclude?: boolean;
    /** Driver names; `none` is a delivery with no driver yet. */
    drivers?: string[];
    /** The scheduled day, `YYYY-MM-DD[THH:mm]`. */
    scheduledFrom?: string;
    scheduledTo?: string;
    createdFrom?: string;
    createdTo?: string;
    timezone?: string;
}

/** `GET /delivery/summary` — see `DeliveryService.summary`. */
export interface DeliveryListSummary {
    count: number;
    pending: number;
    inTransit: number;
    delivered: number;
    failed: number;
    cancelled: number;
    /** Still open with its scheduled time already past. */
    overdue: number;
    /** Still open with no driver on it. */
    unassigned: number;
}

@Injectable()
export class DeliveryService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The `where` behind the delivery list and its stats strip, so the strip
     * always counts the rows the list shows.
     */
    private listWhere(tenantId: string, filters: DeliveryListFilters = {}): Prisma.DeliveryOrderWhereInput {
        const where: Prisma.DeliveryOrderWhereInput = {
            tenantId,
            ...(statusSetClause(filters.statuses, filters.statusExclude) as Prisma.DeliveryOrderWhereInput),
        };
        const created = createdAtRange(filters.createdFrom, filters.createdTo, filters.timezone);
        if (created) where.created_at = created;
        const scheduled = zonedDayRange(filters.scheduledFrom, filters.scheduledTo, filters.timezone);
        if (scheduled) where.scheduledAt = scheduled;
        const and: Prisma.DeliveryOrderWhereInput[] = [];
        const search = searchClause(filters.search, [
            'customerName',
            'customerPhone',
            'deliveryAddress',
            'driverName',
            'driverPhone',
            'sale.serial_number',
        ]);
        if (search) and.push(search as Prisma.DeliveryOrderWhereInput);
        const driver = idsOrNoneClause('driverName', filters.drivers);
        if (driver) and.push(driver as Prisma.DeliveryOrderWhereInput);
        if (and.length) where.AND = and;
        return where;
    }

    async listDeliveries(
        tenantId: string,
        page: number,
        limit: number,
        opts?: (DeliveryListFilters & { sortBy?: string; sortDir?: string }) | string,
    ) {
        const skip = (page - 1) * limit;
        const filters: DeliveryListFilters & { sortBy?: string; sortDir?: string } =
            typeof opts === 'string' ? { statuses: [opts] } : (opts ?? {});
        const where = this.listWhere(tenantId, filters);

        const [items, total] = await Promise.all([
            this.db.deliveryOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: resolveOrderBy(filters.sortBy, filters.sortDir, DELIVERY_SORTABLE, {
                    created_at: 'desc',
                }) as Prisma.DeliveryOrderOrderByWithRelationInput,
                select: {
                    id: true,
                    saleId: true,
                    customerName: true,
                    customerPhone: true,
                    deliveryAddress: true,
                    driverName: true,
                    driverPhone: true,
                    status: true,
                    notes: true,
                    scheduledAt: true,
                    deliveredAt: true,
                    created_at: true,
                    updated_at: true,
                    sale: { select: { id: true, serial_number: true } },
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

    /**
     * The stats strip above the delivery list, over exactly the rows the list
     * shows: how many in each state, and of those still open, how many are
     * late against their scheduled time or still have nobody to take them.
     */
    async summary(tenantId: string, filters: DeliveryListFilters, now: Date = new Date()): Promise<DeliveryListSummary> {
        const where = this.listWhere(tenantId, filters);
        const open: Prisma.DeliveryOrderWhereInput = { status: { in: OPEN_DELIVERY_STATUSES } };
        const [byStatus, overdue, unassigned] = await Promise.all([
            this.db.deliveryOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
            this.db.deliveryOrder.count({ where: { AND: [where, open, { scheduledAt: { lt: now } }] } }),
            this.db.deliveryOrder.count({ where: { AND: [where, open, { driverName: null }] } }),
        ]);
        const counts = new Map(byStatus.map((row) => [row.status, row._count._all]));
        const of = (status: string) => counts.get(status) ?? 0;
        return {
            count: byStatus.reduce((sum, row) => sum + row._count._all, 0),
            pending: of('PENDING'),
            inTransit: of('IN_TRANSIT'),
            delivered: of('DELIVERED'),
            failed: of('FAILED'),
            cancelled: of('CANCELLED'),
            overdue,
            unassigned,
        };
    }

    /** The driver names on the tenant's deliveries, for the Driver chip. */
    async listDrivers(tenantId: string): Promise<string[]> {
        const rows = await this.db.deliveryOrder.groupBy({
            by: ['driverName'],
            where: { tenantId, driverName: { not: null } },
            orderBy: { driverName: 'asc' },
            take: 200,
        });
        return rows
            .map((row) => row.driverName)
            .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
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
