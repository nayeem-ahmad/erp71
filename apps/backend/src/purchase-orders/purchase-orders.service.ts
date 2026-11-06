import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { idsOrNoneClause, searchClause, statusSetClause, type DocumentListFilters } from '../common/document-list-filters';
import { numberConditionFilter } from '../common/number-condition.util';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { startOfZonedToday, zonedDayRange } from '../common/tenant-time.util';
import { roundMoney } from '@erp71/shared-types';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber, numberTakenIn } from '../database/document-number.utils';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './purchase-order.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

const PURCHASE_ORDER_SORTABLE: SortableMap = {
    po_number: (dir) => ({ po_number: dir }),
    status: (dir) => ({ status: dir }),
    total_amount: (dir) => ({ total_amount: dir }),
    expected_date: (dir) => ({ expected_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
    supplier: (dir) => ({ supplier: { name: dir } }),
};

/** A purchase order still waiting on its goods. */
const OPEN_PO_STATUSES = ['DRAFT', 'SENT'];

/** What narrows the purchase-orders list — and, alike, its stats strip. */
export interface PurchaseOrderListFilters extends Partial<Omit<DocumentListFilters, 'timezone'>> {
    timezone: string;
}

/** `GET /purchase-orders/summary` — see `PurchaseOrdersService.summary`. */
export interface PurchaseOrderListSummary {
    count: number;
    cancelledCount: number;
    /** Order totals, cancelled orders left out. */
    value: number;
    open: { count: number; amount: number };
    received: { count: number; amount: number };
    /** Open orders whose expected date has passed. */
    overdue: number;
}

@Injectable()
export class PurchaseOrdersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreatePurchaseOrderDto) {
        const store = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
        });
        if (!store) throw new NotFoundException('Store not found');

        const productIds = dto.items.map((i) => i.productId);
        const products = await this.db.product.findMany({
            where: { tenant_id: tenantId, id: { in: productIds } },
        });
        if (products.length !== dto.items.length) {
            throw new BadRequestException('One or more products not found.');
        }

        if (dto.supplierId) {
            const supplier = await this.db.supplier.findFirst({
                where: { id: dto.supplierId, tenant_id: tenantId, deleted_at: null },
            });
            if (!supplier) throw new BadRequestException('Supplier not found.');
        }

        const subtotal = dto.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
        const tax = dto.taxAmount ?? 0;
        const discount = dto.discountAmount ?? 0;
        const freight = dto.freightAmount ?? 0;
        const total = subtotal + tax + freight - discount;

        return this.db.$transaction(async (tx) => {
            const poNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: 'PURCHASE_ORDER',
                storeId: dto.storeId,
                isTaken: numberTakenIn(tx.purchaseOrder, tenantId, 'po_number'),
            });

            return tx.purchaseOrder.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    supplier_id: dto.supplierId,
                    po_number: poNumber,
                    expected_date: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
                    subtotal_amount: subtotal,
                    tax_amount: tax,
                    discount_amount: discount,
                    freight_amount: freight,
                    total_amount: total,
                    notes: dto.notes,
                    created_by: userId,
                    items: {
                        create: dto.items.map((i) => ({
                            product_id: i.productId,
                            quantity: i.quantity,
                            unit_cost: i.unitCost,
                            line_total: i.quantity * i.unitCost,
                        })),
                    },
                },
                include: {
                    supplier: true,
                    store: { select: { name: true } },
                    items: { include: { product: true } },
                },
            });
        });
    }

    /**
     * The `where` behind the list and its stats strip, so the two always
     * describe the same documents. The date filter is the document's own
     * `expected_date`; the created date has a filter of its own.
     */
    private listWhere(tenantId: string, opts?: PurchaseOrderListFilters): Prisma.PurchaseOrderWhereInput {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const ownDate = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);
        const where: Prisma.PurchaseOrderWhereInput = {
            tenant_id: tenantId,
            ...(opts?.storeId ? { store_id: opts.storeId } : {}),
            ...(created ? { created_at: created } : {}),
            ...(ownDate ? { expected_date: ownDate } : {}),
            ...(statusSetClause(opts?.statuses, opts?.statusExclude) as Prisma.PurchaseOrderWhereInput),
            ...(opts?.total ? { total_amount: numberConditionFilter(opts.total) } : {}),
        };
        const and: Prisma.PurchaseOrderWhereInput[] = [];
        const search = searchClause(opts?.search, ['po_number', 'notes', 'supplier.name']);
        if (search) and.push(search as Prisma.PurchaseOrderWhereInput);
        const supplier = idsOrNoneClause('supplier_id', opts?.supplierIds);
        if (supplier) and.push(supplier as Prisma.PurchaseOrderWhereInput);
        if (and.length) where.AND = and;
        return where;
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: PurchaseOrderListFilters & { sortBy?: string; sortDir?: string },
    ): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.purchaseOrder.findMany({
                    ...(args as object),
                    include: {
                        supplier: true,
                        store: { select: { name: true } },
                        items: { include: { product: true } },
                    },
                }),
            count: (args) => this.db.purchaseOrder.count(args as any),
            where: this.listWhere(tenantId, opts) as Record<string, unknown>,
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, PURCHASE_ORDER_SORTABLE, { created_at: 'desc' }),
            page,
            limit,
        });
    }

    /**
     * The stats strip above the purchase-orders list, over exactly the rows
     * it shows: what is on order, what is still to arrive (and late), and
     * what has been received. Cancelled orders are counted but carry no value.
     */
    async summary(tenantId: string, opts: PurchaseOrderListFilters): Promise<PurchaseOrderListSummary> {
        const where = this.listWhere(tenantId, opts);
        const within = (extra: Prisma.PurchaseOrderWhereInput): Prisma.PurchaseOrderWhereInput => ({ AND: [where, extra] });
        const [count, cancelledCount, live, open, received, overdue] = await Promise.all([
            this.db.purchaseOrder.count({ where }),
            this.db.purchaseOrder.count({ where: within({ status: 'CANCELLED' }) }),
            this.db.purchaseOrder.aggregate({ where: within({ status: { not: 'CANCELLED' } }), _sum: { total_amount: true } }),
            this.db.purchaseOrder.aggregate({
                where: within({ status: { in: OPEN_PO_STATUSES } }),
                _count: { _all: true },
                _sum: { total_amount: true },
            }),
            this.db.purchaseOrder.aggregate({
                where: within({ status: 'RECEIVED' }),
                _count: { _all: true },
                _sum: { total_amount: true },
            }),
            this.db.purchaseOrder.count({
                where: within({
                    status: { in: OPEN_PO_STATUSES },
                    expected_date: { lt: startOfZonedToday(opts.timezone) },
                }),
            }),
        ]);
        return {
            count,
            cancelledCount,
            value: roundMoney(Number(live._sum.total_amount ?? 0)),
            open: { count: open._count._all, amount: roundMoney(Number(open._sum.total_amount ?? 0)) },
            received: { count: received._count._all, amount: roundMoney(Number(received._sum.total_amount ?? 0)) },
            overdue,
        };
    }

    async findOne(tenantId: string, id: string) {
        const po = await this.db.purchaseOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
        });
        if (!po) throw new NotFoundException('Purchase order not found');
        return po;
    }

    async updateStatus(tenantId: string, id: string, dto: UpdatePurchaseOrderStatusDto) {
        const po = await this.db.purchaseOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: { items: true },
        });
        if (!po) throw new NotFoundException('Purchase order not found');

        if (po.status === 'RECEIVED') {
            throw new BadRequestException('This purchase order has already been received.');
        }
        if (po.status === 'CANCELLED') {
            throw new BadRequestException('Cancelled purchase orders cannot be updated.');
        }

        if (dto.status === 'RECEIVED') {
            return this.db.$transaction(async (tx) => {
                const warehouseId = await resolveWarehouseId(tx, tenantId, po.store_id, undefined, 'purchase');

                for (const item of po.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId,
                        quantityDelta: item.quantity,
                        movementType: 'PURCHASE_RECEIPT',
                        referenceType: 'PURCHASE_ORDER',
                        referenceId: po.id,
                        unitCost: Number(item.unit_cost),
                    });
                }

                await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'purchase',
                    conditionKey: 'payment_mode',
                    conditionValue: 'credit',
                    sourceModule: 'purchase-orders',
                    sourceType: 'purchase_order',
                    sourceId: po.id,
                    amount: Number(po.total_amount),
                    description: `Auto-posted PO ${po.po_number}`,
                    referenceNumber: po.po_number,
                    storeId: po.store_id,
                    partyType: 'SUPPLIER',
                    partyId: po.supplier_id ?? undefined,
                });

                return tx.purchaseOrder.update({
                    where: { id },
                    data: { status: 'RECEIVED', received_at: new Date() },
                    include: {
                        supplier: true,
                        store: { select: { name: true } },
                        items: { include: { product: true } },
                    },
                });
            });
        }

        return this.db.purchaseOrder.update({
            where: { id },
            data: { status: dto.status },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
        });
    }

    async getInvoiceData(tenantId: string, id: string) {
        const [po, tenant] = await Promise.all([
            this.db.purchaseOrder.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    // The branch's name and address print on its letterhead.
                    store: { select: { name: true, address: true } },
                    items: { include: { product: true } },
                },
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    name: true,
                    brand_primary_color: true,
                    brand_logo_url: true,
                    brand_business_name: true,
                    vat_registration_no: true,
                    business_tin: true,
                },
            }),
        ]);
        if (!po) throw new NotFoundException('Purchase order not found');
        return { purchaseOrder: po, tenant };
    }
}
