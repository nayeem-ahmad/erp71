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
import { CreatePurchaseQuotationDto, UpdatePurchaseQuotationStatusDto } from './purchase-quotation.dto';

const INCLUDE = {
    supplier: { select: { id: true, name: true, phone: true, email: true } },
    store: { select: { name: true } },
    items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} as const;

const PURCHASE_QUOTATION_SORTABLE: SortableMap = {
    rfq_number: (dir) => ({ rfq_number: dir }),
    status: (dir) => ({ status: dir }),
    total_amount: (dir) => ({ total_amount: dir }),
    valid_until: (dir) => ({ valid_until: dir }),
    created_at: (dir) => ({ created_at: dir }),
    supplier: (dir) => ({ supplier: { name: dir } }),
};

/** A quotation still waiting on the supplier or on our decision. */
const PENDING_RFQ_STATUSES = ['DRAFT', 'SENT', 'RECEIVED'];
/** A quotation that came to nothing carries no value. */
const DEAD_RFQ_STATUSES = ['CANCELLED', 'REJECTED'];

/** What narrows the purchase-quotations list — and, alike, its stats strip. */
export interface PurchaseQuotationListFilters extends Partial<Omit<DocumentListFilters, 'timezone'>> {
    timezone: string;
}

/** `GET /purchase-quotations/summary` — see `PurchaseQuotationsService.summary`. */
export interface PurchaseQuotationListSummary {
    count: number;
    /** Quoted totals, cancelled and rejected quotations left out. */
    value: number;
    pending: number;
    accepted: { count: number; amount: number };
    converted: number;
    /** Still pending or accepted, past their valid-until date. */
    expired: number;
}

@Injectable()
export class PurchaseQuotationsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreatePurchaseQuotationDto) {
        const store = await this.db.store.findFirst({ where: { id: dto.storeId, tenant_id: tenantId } });
        if (!store) throw new NotFoundException('Store not found');

        if (dto.supplierId) {
            const supplier = await this.db.supplier.findFirst({
                where: { id: dto.supplierId, tenant_id: tenantId, deleted_at: null },
            });
            if (!supplier) throw new BadRequestException('Supplier not found.');
        }

        const total = dto.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

        return this.db.$transaction(async (tx) => {
            const rfqNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: 'RFQ',
                storeId: dto.storeId,
                isTaken: numberTakenIn(tx.purchaseQuotation, tenantId, 'rfq_number'),
            });

            return tx.purchaseQuotation.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    supplier_id: dto.supplierId ?? null,
                    rfq_number: rfqNumber,
                    valid_until: dto.validUntil ? new Date(dto.validUntil) : null,
                    total_amount: total,
                    notes: dto.notes ?? null,
                    items: {
                        create: dto.items.map((i) => ({
                            product_id: i.productId,
                            quantity: i.quantity,
                            unit_cost: i.unitCost,
                            line_total: i.quantity * i.unitCost,
                        })),
                    },
                },
                include: INCLUDE,
            });
        });
    }

    /**
     * The `where` behind the list and its stats strip, so the two always
     * describe the same documents. The date filter is the document's own
     * `valid_until`; the created date has a filter of its own.
     */
    private listWhere(tenantId: string, opts?: PurchaseQuotationListFilters): Prisma.PurchaseQuotationWhereInput {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const ownDate = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);
        const where: Prisma.PurchaseQuotationWhereInput = {
            tenant_id: tenantId,
            ...(opts?.storeId ? { store_id: opts.storeId } : {}),
            ...(created ? { created_at: created } : {}),
            ...(ownDate ? { valid_until: ownDate } : {}),
            ...(statusSetClause(opts?.statuses, opts?.statusExclude) as Prisma.PurchaseQuotationWhereInput),
            ...(opts?.total ? { total_amount: numberConditionFilter(opts.total) } : {}),
        };
        const and: Prisma.PurchaseQuotationWhereInput[] = [];
        const search = searchClause(opts?.search, ['rfq_number', 'notes', 'supplier.name']);
        if (search) and.push(search as Prisma.PurchaseQuotationWhereInput);
        const supplier = idsOrNoneClause('supplier_id', opts?.supplierIds);
        if (supplier) and.push(supplier as Prisma.PurchaseQuotationWhereInput);
        if (and.length) where.AND = and;
        return where;
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: PurchaseQuotationListFilters & { sortBy?: string; sortDir?: string },
    ): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.purchaseQuotation.findMany({
                    ...(args as object),
                    include: INCLUDE,
                }),
            count: (args) => this.db.purchaseQuotation.count(args as any),
            where: this.listWhere(tenantId, opts) as Record<string, unknown>,
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, PURCHASE_QUOTATION_SORTABLE, { created_at: 'desc' }),
            page,
            limit,
        });
    }

    /**
     * The stats strip above the purchase-quotations list, over exactly the
     * rows it shows: how much is quoted, what is still pending, what was
     * accepted and turned into orders, and what has run past its validity.
     */
    async summary(tenantId: string, opts: PurchaseQuotationListFilters): Promise<PurchaseQuotationListSummary> {
        const where = this.listWhere(tenantId, opts);
        const within = (extra: Prisma.PurchaseQuotationWhereInput): Prisma.PurchaseQuotationWhereInput => ({ AND: [where, extra] });
        const [count, live, pending, accepted, converted, expired] = await Promise.all([
            this.db.purchaseQuotation.count({ where }),
            this.db.purchaseQuotation.aggregate({ where: within({ status: { notIn: DEAD_RFQ_STATUSES } }), _sum: { total_amount: true } }),
            this.db.purchaseQuotation.count({ where: within({ status: { in: PENDING_RFQ_STATUSES } }) }),
            this.db.purchaseQuotation.aggregate({
                where: within({ status: 'ACCEPTED' }),
                _count: { _all: true },
                _sum: { total_amount: true },
            }),
            this.db.purchaseQuotation.count({ where: within({ status: 'CONVERTED' }) }),
            this.db.purchaseQuotation.count({
                where: within({
                    status: { in: [...PENDING_RFQ_STATUSES, 'ACCEPTED'] },
                    valid_until: { lt: startOfZonedToday(opts.timezone) },
                }),
            }),
        ]);
        return {
            count,
            value: roundMoney(Number(live._sum.total_amount ?? 0)),
            pending,
            accepted: { count: accepted._count._all, amount: roundMoney(Number(accepted._sum.total_amount ?? 0)) },
            converted,
            expired,
        };
    }

    async findOne(tenantId: string, id: string) {
        const rfq = await this.db.purchaseQuotation.findFirst({
            where: { id, tenant_id: tenantId },
            include: INCLUDE,
        });
        if (!rfq) throw new NotFoundException('Purchase quotation not found');
        return rfq;
    }

    async updateStatus(tenantId: string, id: string, dto: UpdatePurchaseQuotationStatusDto) {
        const rfq = await this.db.purchaseQuotation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!rfq) throw new NotFoundException('Purchase quotation not found');

        if (rfq.status === 'CONVERTED') throw new BadRequestException('Already converted to a purchase order.');
        if (rfq.status === 'CANCELLED') throw new BadRequestException('Cancelled quotations cannot be updated.');

        return this.db.purchaseQuotation.update({
            where: { id },
            data: { status: dto.status },
            include: INCLUDE,
        });
    }

    async convertToPurchaseOrder(tenantId: string, id: string) {
        const rfq = await this.db.purchaseQuotation.findFirst({
            where: { id, tenant_id: tenantId },
            include: { items: true },
        });
        if (!rfq) throw new NotFoundException('Purchase quotation not found');
        if (rfq.status === 'CONVERTED') throw new BadRequestException('Already converted to a purchase order.');
        if (rfq.status === 'CANCELLED') throw new BadRequestException('Cancelled quotations cannot be converted.');

        return this.db.$transaction(async (tx) => {
            // The same series as a purchase order raised directly.
            const poNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: 'PURCHASE_ORDER',
                storeId: rfq.store_id,
                isTaken: numberTakenIn(tx.purchaseOrder, tenantId, 'po_number'),
            });

            const po = await tx.purchaseOrder.create({
                data: {
                    tenant_id: tenantId,
                    store_id: rfq.store_id,
                    supplier_id: rfq.supplier_id,
                    po_number: poNumber,
                    subtotal_amount: rfq.total_amount,
                    total_amount: rfq.total_amount,
                    notes: rfq.notes,
                    items: {
                        create: rfq.items.map((i) => ({
                            product_id: i.product_id,
                            quantity: i.quantity,
                            unit_cost: i.unit_cost,
                            line_total: i.line_total,
                        })),
                    },
                },
                include: {
                    supplier: true,
                    store: { select: { name: true } },
                    items: { include: { product: true } },
                },
            });

            await tx.purchaseQuotation.update({
                where: { id },
                data: { status: 'CONVERTED' },
            });

            return po;
        });
    }

    async remove(tenantId: string, id: string) {
        const rfq = await this.db.purchaseQuotation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!rfq) throw new NotFoundException('Purchase quotation not found');
        if (rfq.status === 'CONVERTED') throw new BadRequestException('Cannot delete a converted quotation.');

        await this.db.purchaseQuotationItem.deleteMany({ where: { rfq_id: id } });
        await this.db.purchaseQuotation.delete({ where: { id } });
        return { deleted: true };
    }
}
