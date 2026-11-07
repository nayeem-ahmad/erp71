import { Injectable, BadRequestException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import {
    idsOrNoneClause,
    searchClause,
    statusSetClause,
    type SalesDocumentListFilters,
} from '../common/sales-document-list-filters';
import { numberConditionFilter } from '../common/number-condition.util';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { startOfZonedToday, zonedDayRange } from '../common/tenant-time.util';
import { roundMoney } from '@erp71/shared-types';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber, numberTakenIn } from '../database/document-number.utils';
import {
    CreateSalesOrderDto,
    UpdateSalesOrderDto,
    UpdateOrderStatusDto,
    AddDepositDto,
    type SalesOrderPaymentStatus,
} from './sales-orders.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { resolveInlineCustomer } from '../customers/resolve-inline-customer.util';

const SALES_ORDER_SORTABLE: SortableMap = {
    order_number: (dir) => ({ order_number: dir }),
    status: (dir) => ({ status: dir }),
    payment_status: (dir) => ({ payment_status: dir }),
    total_amount: (dir) => ({ total_amount: dir }),
    delivery_date: (dir) => ({ delivery_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
    customer: (dir) => ({ customer: { name: dir } }),
};

/** An order still to be delivered — the ones a delivery date can make late. */
const OPEN_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'PROCESSING'];

/** What narrows the sales-orders list — and, alike, its stats strip. */
export interface SalesOrderListFilters extends Partial<Omit<SalesDocumentListFilters, 'timezone'>> {
    timezone: string;
    paymentStatus?: SalesOrderPaymentStatus[];
}

/** `GET /sales-orders/summary` — see `SalesOrdersService.summary`. */
export interface SalesOrderListSummary {
    count: number;
    cancelledCount: number;
    /** Order totals, cancelled orders left out. */
    value: number;
    /** Deposits taken against those orders. */
    advance: number;
    open: { count: number; amount: number };
    delivered: { count: number; amount: number };
    /** Open orders whose delivery date has passed. */
    overdue: number;
}

@Injectable()
export class SalesOrdersService {
    constructor(private db: DatabaseService) {}

    private normalizeDeliveryDate(value?: Date | string) {
        if (!value) return undefined;

        const parsed = new Date(
            typeof value === 'string' && value.length === 10
                ? `${value}T00:00:00.000Z`
                : value,
        );

        if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('Invalid delivery date');
        }

        return parsed;
    }

    async create(tenantId: string, userId: string, dto: CreateSalesOrderDto) {
        return this.db.$transaction(async (tx) => {
            if (dto.newCustomer) {
                dto.customerId = await resolveInlineCustomer(tx, tenantId, dto.newCustomer, dto.storeId);
            }

            const orderNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: 'SALES_ORDER',
                storeId: dto.storeId,
                isTaken: numberTakenIn(tx.salesOrder, tenantId, 'order_number'),
            });
            const deliveryDate = this.normalizeDeliveryDate(dto.deliveryDate);
            
            const itemsData = dto.items.map(item => ({
                product_id: item.productId,
                quantity: item.quantity,
                price_at_order: item.priceAtOrder
            }));

            const order = await tx.salesOrder.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    customer_id: dto.customerId,
                    order_number: orderNumber,
                    total_amount: dto.totalAmount,
                    prices_include_vat: dto.pricesIncludeVat ?? true,
                    vat_amount: dto.vatAmount ?? 0,
                    status: dto.status || 'DRAFT',
                    payment_status: 'UNPAID',
                    delivery_date: deliveryDate,
                    created_by: userId,
                    items: { create: itemsData }
                },
                include: { items: true }
            });

            return order;
        });
    }

    async updateStatus(tenantId: string, id: string, dto: UpdateOrderStatusDto) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id, tenant_id: tenantId },
                include: { items: true }
            });

            if (!order) throw new BadRequestException('Order not found');

            // If transitioning to DELIVERED, decrement stock
            if (dto.status === 'DELIVERED' && order.status !== 'DELIVERED') {
                const warehouseId = await resolveWarehouseId(tx, tenantId, order.store_id);
                for (const item of order.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId,
                        quantityDelta: -item.quantity,
                        movementType: 'SALES_ORDER_DELIVERY',
                        referenceType: 'SALES_ORDER',
                        referenceId: id,
                    });
                }
                
                // Also update customer total_spent based on the entire order amount
                if (order.customer_id) {
                     await tx.customer.update({
                         where: { id: order.customer_id },
                         data: { total_spent: { increment: order.total_amount } }
                     });
                }
            }

            return tx.salesOrder.update({
                where: { id },
                data: { status: dto.status }
            });
        });
    }

    async addDeposit(tenantId: string, id: string, dto: AddDepositDto) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id, tenant_id: tenantId },
                include: { deposits: true }
            });

            if (!order) throw new BadRequestException('Order not found');

            const currentPaid = Number(order.amount_paid);
            const newPaid = currentPaid + dto.amount;

            // Recalculate payment status
            let paymentStatus = order.payment_status;
            if (newPaid >= Number(order.total_amount)) {
                paymentStatus = 'PAID';
            } else if (newPaid > 0) {
                paymentStatus = 'PARTIAL';
            }

            await tx.orderDeposit.create({
                data: {
                    order_id: id,
                    amount: dto.amount,
                    payment_method: dto.paymentMethod
                }
            });

            return tx.salesOrder.update({
                where: { id },
                data: { 
                    amount_paid: newPaid,
                    payment_status: paymentStatus 
                },
                include: { deposits: true }
            });
        });
    }

    /**
     * The `where` behind the list and its stats strip, so the two always
     * describe the same documents. The date filter is the order's own
     * `delivery_date`; the created date has a filter of its own.
     */
    private listWhere(tenantId: string, opts?: SalesOrderListFilters): Prisma.SalesOrderWhereInput {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const delivery = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);
        const where: Prisma.SalesOrderWhereInput = {
            tenant_id: tenantId,
            ...(opts?.storeId ? { store_id: opts.storeId } : {}),
            ...(created ? { created_at: created } : {}),
            ...(delivery ? { delivery_date: delivery } : {}),
            ...(statusSetClause(opts?.statuses, opts?.statusExclude) as Prisma.SalesOrderWhereInput),
            ...(opts?.total ? { total_amount: numberConditionFilter(opts.total) } : {}),
            ...(opts?.paymentStatus?.length ? { payment_status: { in: opts.paymentStatus } } : {}),
        };
        const and: Prisma.SalesOrderWhereInput[] = [];
        const search = searchClause(opts?.search, ['order_number', 'customer.name', 'customer.phone']);
        if (search) and.push(search as Prisma.SalesOrderWhereInput);
        const customer = idsOrNoneClause('customer_id', opts?.customerIds);
        if (customer) and.push(customer as Prisma.SalesOrderWhereInput);
        if (and.length) where.AND = and;
        return where;
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: SalesOrderListFilters & { sortBy?: string; sortDir?: string },
    ): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.salesOrder.findMany({
                    ...(args as object),
                    include: { customer: true, items: { include: { product: true } }, deposits: true },
                }),
            count: (args) => this.db.salesOrder.count(args as any),
            where: this.listWhere(tenantId, opts) as Record<string, unknown>,
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, SALES_ORDER_SORTABLE, { created_at: 'desc' }),
            page,
            limit,
        });
    }

    /**
     * The stats strip above the sales-orders list, over exactly the rows it
     * shows: what is on order and how much of it was paid up front, what is
     * still to deliver (and late), and what has gone out. Cancelled orders
     * are counted but carry no value.
     */
    async summary(tenantId: string, opts: SalesOrderListFilters): Promise<SalesOrderListSummary> {
        const where = this.listWhere(tenantId, opts);
        const within = (extra: Prisma.SalesOrderWhereInput): Prisma.SalesOrderWhereInput => ({ AND: [where, extra] });
        const [count, cancelledCount, live, open, delivered, overdue] = await Promise.all([
            this.db.salesOrder.count({ where }),
            this.db.salesOrder.count({ where: within({ status: 'CANCELLED' }) }),
            this.db.salesOrder.aggregate({
                where: within({ status: { not: 'CANCELLED' } }),
                _sum: { total_amount: true, amount_paid: true },
            }),
            this.db.salesOrder.aggregate({
                where: within({ status: { in: OPEN_ORDER_STATUSES } }),
                _count: { _all: true },
                _sum: { total_amount: true },
            }),
            this.db.salesOrder.aggregate({
                where: within({ status: 'DELIVERED' }),
                _count: { _all: true },
                _sum: { total_amount: true },
            }),
            this.db.salesOrder.count({
                where: within({
                    status: { in: OPEN_ORDER_STATUSES },
                    delivery_date: { lt: startOfZonedToday(opts.timezone) },
                }),
            }),
        ]);
        return {
            count,
            cancelledCount,
            value: roundMoney(Number(live._sum.total_amount ?? 0)),
            advance: roundMoney(Number(live._sum.amount_paid ?? 0)),
            open: { count: open._count._all, amount: roundMoney(Number(open._sum.total_amount ?? 0)) },
            delivered: { count: delivered._count._all, amount: roundMoney(Number(delivered._sum.total_amount ?? 0)) },
            overdue,
        };
    }

    async findOne(tenantId: string, id: string) {
        return this.db.salesOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: { customer: true, items: { include: { product: true } }, deposits: true }
        });
    }

    async update(tenantId: string, id: string, dto: UpdateSalesOrderDto) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.salesOrder.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });
            if (!existing) throw new BadRequestException('Order not found');
            if (existing.status === 'DELIVERED') {
                throw new BadRequestException('Cannot edit a delivered order');
            }

            const updateData: any = {};
            if (dto.customerId !== undefined) updateData.customer_id = dto.customerId || null;
            if (dto.status !== undefined) updateData.status = dto.status;
            if (dto.deliveryDate !== undefined) {
                updateData.delivery_date = this.normalizeDeliveryDate(dto.deliveryDate);
            }

            if (dto.vatAmount !== undefined) updateData.vat_amount = dto.vatAmount;

            if (dto.items && dto.items.length > 0) {
                // Delete old items and create new ones
                await tx.salesOrderItem.deleteMany({ where: { order_id: id } });

                const totalAmount = dto.totalAmount ?? dto.items.reduce(
                    (sum, item) => sum + item.quantity * item.priceAtOrder, 0,
                );
                updateData.total_amount = totalAmount;

                return tx.salesOrder.update({
                    where: { id },
                    data: {
                        ...updateData,
                        items: {
                            create: dto.items.map((item) => ({
                                product_id: item.productId,
                                quantity: item.quantity,
                                price_at_order: item.priceAtOrder,
                            })),
                        },
                    },
                    include: { customer: true, items: { include: { product: true } }, deposits: true },
                });
            }

            if (dto.totalAmount !== undefined) updateData.total_amount = dto.totalAmount;

            return tx.salesOrder.update({
                where: { id },
                data: updateData,
                include: { customer: true, items: { include: { product: true } }, deposits: true },
            });
        });
    }

    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findFirst({
                where: { id, tenant_id: tenantId },
            });
            if (!order) throw new BadRequestException('Order not found');
            if (order.status === 'DELIVERED') {
                throw new BadRequestException('Cannot delete a delivered order');
            }

            await tx.orderDeposit.deleteMany({ where: { order_id: id } });
            await tx.salesOrderItem.deleteMany({ where: { order_id: id } });
            await tx.salesOrder.deleteMany({ where: { id, tenant_id: tenantId } });

            return { deleted: true };
        });
    }
}
