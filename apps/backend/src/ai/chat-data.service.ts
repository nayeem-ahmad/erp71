import { Injectable } from '@nestjs/common';
import { AccountCategory, AccountType } from '../accounting/accounting.constants';
import { DatabaseService } from '../database/database.service';

/**
 * Read-only, tenant-scoped queries that back the chatbot's breadth tools.
 *
 * The report-grade tools delegate to the same service method their REST
 * endpoint uses, so their numbers cannot drift from the report page. The tools
 * here are a different shape: entity lookup, document headers, open-work counts
 * and roster totals. None of those has a canonical report to agree with, and
 * routing each through its own feature module would drag fifteen modules and
 * their guards into `AiModule` for what are, in every case, list queries.
 *
 * Everything in this file takes `tenantId` as its first argument and passes it
 * into the `where` clause. There is no method here that can be called without
 * one, which is what keeps the tool layer's isolation guarantee true.
 */

export type EntityType =
    | 'product'
    | 'customer'
    | 'supplier'
    | 'branch'
    | 'warehouse'
    | 'category'
    | 'brand'
    | 'employee'
    | 'account';

export type DocumentType =
    | 'sale'
    | 'sales_return'
    | 'purchase'
    | 'purchase_return'
    | 'sales_order'
    | 'purchase_order'
    | 'quotation'
    | 'expense'
    | 'voucher';

export type PipelineKind = 'sales_orders' | 'purchase_orders' | 'quotations' | 'leads' | 'deliveries';

export interface ResolvedEntity {
    id: string;
    label: string;
    detail?: string | null;
}

export interface DocumentQuery {
    type: DocumentType;
    from?: string;
    to?: string;
    storeId?: string;
    search?: string;
    limit: number;
}

/** Statuses that mean "still being worked", per document family. */
const OPEN_STATUSES: Record<Exclude<PipelineKind, 'leads'>, string[]> = {
    sales_orders: ['DRAFT', 'CONFIRMED', 'PROCESSING'],
    purchase_orders: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'CONFIRMED'],
    quotations: ['DRAFT', 'SENT', 'REVISED'],
    deliveries: ['PENDING', 'ASSIGNED', 'IN_TRANSIT'],
};

@Injectable()
export class ChatDataService {
    constructor(private readonly db: DatabaseService) {}

    // ── Entity resolution ────────────────────────────────────────────────────

    /**
     * Turns a name a user typed into ids the other tools can filter by.
     *
     * Without this the model has no way to narrow anything except by branch —
     * branch ids are pasted into the system prompt, and every other id is
     * invisible to it. The alternative it reaches for otherwise is inventing a
     * plausible-looking uuid, which the store guard rejects but the warehouse
     * and product filters would silently accept.
     */
    async resolveEntity(tenantId: string, type: EntityType, query: string, limit = 10): Promise<ResolvedEntity[]> {
        const search = query.trim();
        if (!search) return [];
        const contains = { contains: search, mode: 'insensitive' as const };

        switch (type) {
            case 'product': {
                const rows = await this.db.product.findMany({
                    where: {
                        tenant_id: tenantId,
                        deleted_at: null,
                        OR: [{ name: contains }, { sku: contains }],
                    },
                    select: { id: true, name: true, sku: true, group: { select: { name: true } } },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({
                    id: r.id,
                    label: r.name,
                    detail: [r.sku, r.group?.name].filter(Boolean).join(' · ') || null,
                }));
            }
            case 'customer': {
                const rows = await this.db.customer.findMany({
                    where: {
                        tenant_id: tenantId,
                        deleted_at: null,
                        OR: [{ name: contains }, { phone: contains }, { customer_code: contains }],
                    },
                    select: { id: true, name: true, phone: true, customer_code: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name, detail: r.phone ?? r.customer_code }));
            }
            case 'supplier': {
                const rows = await this.db.supplier.findMany({
                    where: {
                        tenant_id: tenantId,
                        deleted_at: null,
                        OR: [{ name: contains }, { phone: contains }],
                    },
                    select: { id: true, name: true, phone: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name, detail: r.phone }));
            }
            case 'branch': {
                const rows = await this.db.store.findMany({
                    where: { tenant_id: tenantId, name: contains },
                    select: { id: true, name: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name }));
            }
            case 'warehouse': {
                const rows = await this.db.warehouse.findMany({
                    where: { tenant_id: tenantId, OR: [{ name: contains }, { code: contains }] },
                    select: { id: true, name: true, code: true, store: { select: { name: true } } },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name, detail: `${r.code} · ${r.store.name}` }));
            }
            case 'category': {
                const rows = await this.db.productGroup.findMany({
                    where: { tenant_id: tenantId, name: contains },
                    select: { id: true, name: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name }));
            }
            case 'brand': {
                const rows = await this.db.brand.findMany({
                    where: { tenant_id: tenantId, name: contains },
                    select: { id: true, name: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name }));
            }
            case 'employee': {
                const rows = await this.db.employee.findMany({
                    where: {
                        tenant_id: tenantId,
                        deleted_at: null,
                        OR: [{ name: contains }, { employee_code: contains }, { phone: contains }],
                    },
                    select: {
                        id: true,
                        name: true,
                        employee_code: true,
                        designation: { select: { name: true } },
                    },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({
                    id: r.id,
                    label: r.name,
                    detail: [r.employee_code, r.designation?.name].filter(Boolean).join(' · ') || null,
                }));
            }
            default: {
                const rows = await this.db.account.findMany({
                    where: { tenant_id: tenantId, OR: [{ name: contains }, { code: contains }] },
                    select: { id: true, name: true, code: true, type: true },
                    take: limit,
                    orderBy: { name: 'asc' },
                });
                return rows.map((r) => ({ id: r.id, label: r.name, detail: [r.code, r.type].filter(Boolean).join(' · ') }));
            }
        }
    }

    /** Product ids and names for every catalogue entity type, for `describe`. */
    async getDataCoverage(tenantId: string) {
        const [sale, purchase, voucher, productCount, customerCount, supplierCount, employeeCount, storeCount] =
            await Promise.all([
                this.db.sale.aggregate({
                    where: { tenant_id: tenantId, status: 'COMPLETED' },
                    _min: { sale_date: true },
                    _max: { sale_date: true },
                    _count: { _all: true },
                }),
                this.db.purchase.aggregate({
                    where: { tenant_id: tenantId },
                    _min: { created_at: true },
                    _max: { created_at: true },
                    _count: { _all: true },
                }),
                this.db.voucher.aggregate({
                    where: { tenant_id: tenantId },
                    _min: { date: true },
                    _max: { date: true },
                    _count: { _all: true },
                }),
                this.db.product.count({ where: { tenant_id: tenantId, deleted_at: null } }),
                this.db.customer.count({ where: { tenant_id: tenantId, deleted_at: null } }),
                this.db.supplier.count({ where: { tenant_id: tenantId, deleted_at: null } }),
                this.db.employee.count({ where: { tenant_id: tenantId, deleted_at: null } }),
                this.db.store.count({ where: { tenant_id: tenantId } }),
            ]);

        return {
            sales: {
                count: sale._count._all,
                earliest: toDateString(sale._min.sale_date),
                latest: toDateString(sale._max.sale_date),
            },
            purchases: {
                count: purchase._count._all,
                earliest: toDateString(purchase._min.created_at),
                latest: toDateString(purchase._max.created_at),
            },
            accounting: {
                voucherCount: voucher._count._all,
                earliest: toDateString(voucher._min.date),
                latest: toDateString(voucher._max.date),
            },
            catalogue: {
                products: productCount,
                customers: customerCount,
                suppliers: supplierCount,
                employees: employeeCount,
                branches: storeCount,
            },
        };
    }

    // ── Documents ────────────────────────────────────────────────────────────

    /**
     * Individual document headers — the drill-down under an aggregate.
     *
     * An aggregate answer is only auditable if the user can get to the rows
     * behind it: "who owes ৳50,000" is a starting point, "which four invoices
     * make it up" is the answer they can act on.
     */
    async listDocuments(tenantId: string, query: DocumentQuery) {
        const { from, to, storeId, search, limit } = query;
        const window = buildWindow(from, to);
        const searchFilter = search?.trim();

        switch (query.type) {
            case 'sale': {
                const rows = await this.db.sale.findMany({
                    where: {
                        tenant_id: tenantId,
                        status: 'COMPLETED',
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { sale_date: window } : {}),
                        ...(searchFilter
                            ? {
                                  OR: [
                                      { serial_number: { contains: searchFilter, mode: 'insensitive' } },
                                      { reference_number: { contains: searchFilter, mode: 'insensitive' } },
                                      { customer: { name: { contains: searchFilter, mode: 'insensitive' } } },
                                  ],
                              }
                            : {}),
                    },
                    select: {
                        id: true,
                        serial_number: true,
                        reference_number: true,
                        total_amount: true,
                        amount_paid: true,
                        sale_date: true,
                        store: { select: { name: true } },
                        customer: { select: { name: true } },
                    },
                    orderBy: { sale_date: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.reference_number || r.serial_number,
                    date: toDateString(r.sale_date),
                    party: r.customer?.name ?? 'Walk-in customer',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    outstanding: Number(r.total_amount) - Number(r.amount_paid),
                    status: 'COMPLETED',
                }));
            }
            case 'sales_return': {
                const rows = await this.db.salesReturn.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                        ...(searchFilter ? { return_number: { contains: searchFilter, mode: 'insensitive' } } : {}),
                    },
                    select: {
                        id: true,
                        return_number: true,
                        total_refund: true,
                        reason: true,
                        status: true,
                        created_at: true,
                        store: { select: { name: true } },
                        sale: { select: { serial_number: true, customer: { select: { name: true } } } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.return_number,
                    date: toDateString(r.created_at),
                    party: r.sale?.customer?.name ?? 'Walk-in customer',
                    branch: r.store.name,
                    amount: Number(r.total_refund),
                    status: r.status,
                    note: r.reason ?? null,
                    againstInvoice: r.sale?.serial_number ?? null,
                }));
            }
            case 'purchase': {
                const rows = await this.db.purchase.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                        ...(searchFilter
                            ? {
                                  OR: [
                                      { purchase_number: { contains: searchFilter, mode: 'insensitive' } },
                                      { supplier: { name: { contains: searchFilter, mode: 'insensitive' } } },
                                  ],
                              }
                            : {}),
                    },
                    select: {
                        id: true,
                        purchase_number: true,
                        total_amount: true,
                        paid_amount: true,
                        payment_status: true,
                        created_at: true,
                        store: { select: { name: true } },
                        supplier: { select: { name: true } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.purchase_number,
                    date: toDateString(r.created_at),
                    party: r.supplier?.name ?? 'Unknown supplier',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    outstanding: Number(r.total_amount) - Number(r.paid_amount),
                    status: r.payment_status,
                }));
            }
            case 'purchase_return': {
                const rows = await this.db.purchaseReturn.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                    },
                    select: {
                        id: true,
                        return_number: true,
                        total_amount: true,
                        created_at: true,
                        store: { select: { name: true } },
                        purchase: { select: { purchase_number: true, supplier: { select: { name: true } } } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.return_number,
                    date: toDateString(r.created_at),
                    party: r.purchase?.supplier?.name ?? 'Unknown supplier',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    againstInvoice: r.purchase?.purchase_number ?? null,
                }));
            }
            case 'sales_order': {
                const rows = await this.db.salesOrder.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                        ...(searchFilter ? { order_number: { contains: searchFilter, mode: 'insensitive' } } : {}),
                    },
                    select: {
                        id: true,
                        order_number: true,
                        total_amount: true,
                        amount_paid: true,
                        status: true,
                        payment_status: true,
                        delivery_date: true,
                        created_at: true,
                        store: { select: { name: true } },
                        customer: { select: { name: true } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.order_number,
                    date: toDateString(r.created_at),
                    party: r.customer?.name ?? 'Walk-in customer',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    outstanding: Number(r.total_amount) - Number(r.amount_paid),
                    status: `${r.status} / ${r.payment_status}`,
                    dueDate: toDateString(r.delivery_date),
                }));
            }
            case 'purchase_order': {
                const rows = await this.db.purchaseOrder.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                        ...(searchFilter ? { po_number: { contains: searchFilter, mode: 'insensitive' } } : {}),
                    },
                    select: {
                        id: true,
                        po_number: true,
                        total_amount: true,
                        status: true,
                        expected_date: true,
                        created_at: true,
                        store: { select: { name: true } },
                        supplier: { select: { name: true } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.po_number,
                    date: toDateString(r.created_at),
                    party: r.supplier?.name ?? 'Unknown supplier',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    status: r.status,
                    dueDate: toDateString(r.expected_date),
                }));
            }
            case 'quotation': {
                const rows = await this.db.quotation.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { created_at: window } : {}),
                        ...(searchFilter ? { quote_number: { contains: searchFilter, mode: 'insensitive' } } : {}),
                    },
                    select: {
                        id: true,
                        quote_number: true,
                        total_amount: true,
                        status: true,
                        valid_until: true,
                        created_at: true,
                        store: { select: { name: true } },
                        customer: { select: { name: true } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.quote_number,
                    date: toDateString(r.created_at),
                    party: r.customer?.name ?? 'Walk-in customer',
                    branch: r.store.name,
                    amount: Number(r.total_amount),
                    status: r.status,
                    dueDate: toDateString(r.valid_until),
                }));
            }
            case 'expense': {
                const rows = await this.db.expenseEntry.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(from || to
                            ? { expense_date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
                            : {}),
                    },
                    select: {
                        id: true,
                        amount: true,
                        expense_date: true,
                        description: true,
                        payment_method: true,
                        category: { select: { name: true } },
                        store: { select: { name: true } },
                    },
                    orderBy: { expense_date: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: null,
                    date: toDateString(r.expense_date),
                    party: r.category.name,
                    branch: r.store?.name ?? 'All branches',
                    amount: Number(r.amount),
                    status: r.payment_method,
                    note: r.description,
                }));
            }
            default: {
                const rows = await this.db.voucher.findMany({
                    where: {
                        tenant_id: tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        ...(window ? { date: window } : {}),
                        ...(searchFilter
                            ? {
                                  OR: [
                                      { voucher_number: { contains: searchFilter, mode: 'insensitive' } },
                                      { reference_number: { contains: searchFilter, mode: 'insensitive' } },
                                      { description: { contains: searchFilter, mode: 'insensitive' } },
                                  ],
                              }
                            : {}),
                    },
                    select: {
                        id: true,
                        voucher_number: true,
                        voucher_type: true,
                        description: true,
                        date: true,
                        store: { select: { name: true } },
                        details: { select: { debit_amount: true } },
                    },
                    orderBy: { date: 'desc' },
                    take: limit,
                });
                return rows.map((r) => ({
                    id: r.id,
                    number: r.voucher_number,
                    date: toDateString(r.date),
                    party: r.voucher_type,
                    branch: r.store?.name ?? 'Head office',
                    // A balanced voucher's debit total is its value; summing both
                    // sides would report every voucher at twice its amount.
                    amount: r.details.reduce((sum, d) => sum + Number(d.debit_amount ?? 0), 0),
                    note: r.description,
                }));
            }
        }
    }

    // ── Forward-looking work ─────────────────────────────────────────────────

    /**
     * Work that is committed but not finished — the questions every other tool
     * is blind to, because they all aggregate what already happened.
     */
    async getOpenPipeline(tenantId: string, kind: PipelineKind, storeId?: string, limit = 20) {
        if (kind === 'leads') {
            const leads = await this.db.lead.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(storeId ? { store_id: storeId } : {}),
                    // Open means still workable: converted and lost leads are done.
                    status: { notIn: ['CONVERTED', 'LOST'] },
                },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    priority: true,
                    next_step: true,
                    next_step_date: true,
                    last_contacted_at: true,
                },
                orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
                take: limit,
            });
            const byStatus = countBy(leads.map((l) => String(l.status)));
            return {
                kind,
                openCount: leads.length,
                totalValue: null,
                byStatus,
                rows: leads.map((l) => ({
                    id: l.id,
                    label: l.name,
                    status: String(l.status),
                    amount: null,
                    dueDate: toDateString(l.next_step_date),
                    detail: l.next_step ?? null,
                })),
            };
        }

        if (kind === 'deliveries') {
            const rows = await this.db.deliveryOrder.findMany({
                where: { tenantId, status: { in: OPEN_STATUSES.deliveries } },
                select: {
                    id: true,
                    customerName: true,
                    status: true,
                    scheduledAt: true,
                    deliveryAddress: true,
                },
                orderBy: { scheduledAt: 'asc' },
                take: limit,
            });
            return {
                kind,
                openCount: rows.length,
                totalValue: null,
                byStatus: countBy(rows.map((r) => r.status)),
                rows: rows.map((r) => ({
                    id: r.id,
                    label: r.customerName,
                    status: r.status,
                    amount: null,
                    dueDate: toDateString(r.scheduledAt),
                    detail: r.deliveryAddress,
                })),
            };
        }

        if (kind === 'sales_orders') {
            const rows = await this.db.salesOrder.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(storeId ? { store_id: storeId } : {}),
                    status: { in: OPEN_STATUSES.sales_orders },
                },
                select: {
                    id: true,
                    order_number: true,
                    status: true,
                    total_amount: true,
                    amount_paid: true,
                    delivery_date: true,
                    customer: { select: { name: true } },
                },
                orderBy: { created_at: 'desc' },
                take: limit,
            });
            const all = await this.db.salesOrder.aggregate({
                where: {
                    tenant_id: tenantId,
                    ...(storeId ? { store_id: storeId } : {}),
                    status: { in: OPEN_STATUSES.sales_orders },
                },
                _sum: { total_amount: true, amount_paid: true },
                _count: { _all: true },
            });
            return {
                kind,
                openCount: all._count._all,
                totalValue: Number(all._sum.total_amount ?? 0),
                unpaidValue: Number(all._sum.total_amount ?? 0) - Number(all._sum.amount_paid ?? 0),
                byStatus: countBy(rows.map((r) => r.status)),
                rows: rows.map((r) => ({
                    id: r.id,
                    label: `${r.order_number} · ${r.customer?.name ?? 'Walk-in customer'}`,
                    status: r.status,
                    amount: Number(r.total_amount),
                    dueDate: toDateString(r.delivery_date),
                    detail: null,
                })),
            };
        }

        if (kind === 'purchase_orders') {
            const where = {
                tenant_id: tenantId,
                ...(storeId ? { store_id: storeId } : {}),
                status: { in: OPEN_STATUSES.purchase_orders },
            };
            const [rows, all] = await Promise.all([
                this.db.purchaseOrder.findMany({
                    where,
                    select: {
                        id: true,
                        po_number: true,
                        status: true,
                        total_amount: true,
                        expected_date: true,
                        supplier: { select: { name: true } },
                    },
                    orderBy: { created_at: 'desc' },
                    take: limit,
                }),
                this.db.purchaseOrder.aggregate({ where, _sum: { total_amount: true }, _count: { _all: true } }),
            ]);
            return {
                kind,
                openCount: all._count._all,
                totalValue: Number(all._sum.total_amount ?? 0),
                byStatus: countBy(rows.map((r) => r.status)),
                rows: rows.map((r) => ({
                    id: r.id,
                    label: `${r.po_number} · ${r.supplier?.name ?? 'Unknown supplier'}`,
                    status: r.status,
                    amount: Number(r.total_amount),
                    dueDate: toDateString(r.expected_date),
                    detail: null,
                })),
            };
        }

        const where = {
            tenant_id: tenantId,
            ...(storeId ? { store_id: storeId } : {}),
            status: { in: OPEN_STATUSES.quotations },
        };
        const [rows, all] = await Promise.all([
            this.db.quotation.findMany({
                where,
                select: {
                    id: true,
                    quote_number: true,
                    status: true,
                    total_amount: true,
                    valid_until: true,
                    customer: { select: { name: true } },
                },
                orderBy: { created_at: 'desc' },
                take: limit,
            }),
            this.db.quotation.aggregate({ where, _sum: { total_amount: true }, _count: { _all: true } }),
        ]);
        return {
            kind: 'quotations' as const,
            openCount: all._count._all,
            totalValue: Number(all._sum.total_amount ?? 0),
            byStatus: countBy(rows.map((r) => r.status)),
            rows: rows.map((r) => ({
                id: r.id,
                label: `${r.quote_number} · ${r.customer?.name ?? 'Walk-in customer'}`,
                status: r.status,
                amount: Number(r.total_amount),
                dueDate: toDateString(r.valid_until),
                detail: null,
            })),
        };
    }

    // ── Cash ─────────────────────────────────────────────────────────────────

    /**
     * What is in the drawer and the bank right now.
     *
     * Balances are summed from posted voucher lines rather than a stored
     * balance column, which is how the cashbook and bankbook reports derive
     * them too — a cached balance is the thing that goes stale silently.
     */
    async getCashPosition(tenantId: string, storeId?: string) {
        const accounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                type: AccountType.ASSET,
                category: { in: [AccountCategory.CASH, AccountCategory.BANK] },
            },
            select: { id: true, name: true, code: true, category: true },
        });

        const balanceLines = accounts.length
            ? await this.db.voucherDetail.findMany({
                  where: {
                      account_id: { in: accounts.map((a) => a.id) },
                      voucher: { tenant_id: tenantId, ...(storeId ? { store_id: storeId } : {}) },
                  },
                  select: { account_id: true, debit_amount: true, credit_amount: true },
              })
            : [];

        // Cash and bank are asset accounts, so the balance is debits less credits.
        const balanceById = new Map<string, number>();
        for (const line of balanceLines) {
            const current = balanceById.get(line.account_id) ?? 0;
            balanceById.set(line.account_id, current + Number(line.debit_amount) - Number(line.credit_amount));
        }

        const rows = accounts.map((a) => ({
            id: a.id,
            name: a.name,
            code: a.code,
            kind: a.category,
            balance: balanceById.get(a.id) ?? 0,
        }));

        const openSessions = await this.db.cashierSession.findMany({
            where: { tenant_id: tenantId, status: 'OPEN', ...(storeId ? { store_id: storeId } : {}) },
            select: {
                id: true,
                opened_at: true,
                opening_cash: true,
                store: { select: { name: true } },
                user: { select: { name: true, email: true } },
            },
            orderBy: { opened_at: 'asc' },
            take: 20,
        });

        return {
            accounts: rows.sort((a, b) => b.balance - a.balance),
            totals: {
                cash: rows.filter((r) => r.kind === AccountCategory.CASH).reduce((s, r) => s + r.balance, 0),
                bank: rows.filter((r) => r.kind === AccountCategory.BANK).reduce((s, r) => s + r.balance, 0),
                all: rows.reduce((s, r) => s + r.balance, 0),
            },
            openCashierSessions: openSessions.map((s) => ({
                id: s.id,
                branch: s.store.name,
                cashier: s.user.name || s.user.email,
                openedAt: s.opened_at.toISOString(),
                openingCash: Number(s.opening_cash),
            })),
        };
    }

    // ── People ───────────────────────────────────────────────────────────────

    /** Headcount, attendance and payroll for a period, in one round-trip. */
    async getWorkforceSummary(tenantId: string, from: string, to: string) {
        const [headcount, byStatus, attendance, payroll, topPaid] = await Promise.all([
            this.db.employee.count({ where: { tenant_id: tenantId, deleted_at: null, status: 'ACTIVE' } }),
            this.db.employee.groupBy({
                by: ['status'],
                where: { tenant_id: tenantId, deleted_at: null },
                _count: { _all: true },
            }),
            this.db.attendanceRecord.groupBy({
                by: ['status'],
                where: { tenant_id: tenantId, date: { gte: new Date(from), lte: endOfDay(to) } },
                _count: { _all: true },
            }),
            this.db.salaryPayment.aggregate({
                where: { tenant_id: tenantId, payment_date: { gte: new Date(from), lte: endOfDay(to) } },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            this.db.salaryPayment.groupBy({
                by: ['employee_id'],
                where: { tenant_id: tenantId, payment_date: { gte: new Date(from), lte: endOfDay(to) } },
                _sum: { amount: true },
                orderBy: { _sum: { amount: 'desc' } },
                take: 10,
            }),
        ]);

        const employees = topPaid.length
            ? await this.db.employee.findMany({
                  where: { id: { in: topPaid.map((p) => p.employee_id) } },
                  select: { id: true, name: true, designation: { select: { name: true } } },
              })
            : [];
        const nameById = new Map(employees.map((e) => [e.id, e]));

        const attendanceCounts = Object.fromEntries(
            attendance.map((row) => [String(row.status), row._count._all]),
        );
        const attendanceTotal = attendance.reduce((sum, row) => sum + row._count._all, 0);

        return {
            headcount: {
                active: headcount,
                byStatus: Object.fromEntries(byStatus.map((row) => [String(row.status), row._count._all])),
            },
            attendance: {
                recordCount: attendanceTotal,
                byStatus: attendanceCounts,
                presentRatePct:
                    attendanceTotal > 0 ? ((attendanceCounts.PRESENT ?? 0) / attendanceTotal) * 100 : null,
            },
            payroll: {
                totalPaid: Number(payroll._sum.amount ?? 0),
                paymentCount: payroll._count._all,
                topEarners: topPaid.map((p) => ({
                    employee: nameById.get(p.employee_id)?.name ?? 'Unknown',
                    designation: nameById.get(p.employee_id)?.designation?.name ?? null,
                    paid: Number(p._sum.amount ?? 0),
                })),
            },
        };
    }

    // ── Inventory movement ───────────────────────────────────────────────────

    /** The stock ledger: every reason a quantity changed, newest first. */
    async getStockMovements(
        tenantId: string,
        params: { productId?: string; warehouseId?: string; from?: string; to?: string; movementType?: string; limit: number },
    ) {
        const window = buildWindow(params.from, params.to);
        const rows = await this.db.inventoryMovement.findMany({
            where: {
                tenant_id: tenantId,
                ...(params.productId ? { product_id: params.productId } : {}),
                ...(params.warehouseId ? { warehouse_id: params.warehouseId } : {}),
                ...(params.movementType ? { movement_type: params.movementType } : {}),
                ...(window ? { created_at: window } : {}),
            },
            select: {
                id: true,
                movement_type: true,
                quantity_delta: true,
                balance_after: true,
                unit_cost: true,
                note: true,
                created_at: true,
                product: { select: { name: true } },
                warehouse: { select: { name: true } },
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: params.limit,
        });

        const inbound = rows.filter((r) => r.quantity_delta > 0).reduce((s, r) => s + r.quantity_delta, 0);
        const outbound = rows.filter((r) => r.quantity_delta < 0).reduce((s, r) => s + r.quantity_delta, 0);

        return {
            totals: { unitsIn: inbound, unitsOut: Math.abs(outbound), netChange: inbound + outbound },
            rows: rows.map((r) => ({
                date: toDateString(r.created_at),
                product: r.product.name,
                warehouse: r.warehouse.name,
                type: r.movement_type,
                quantityDelta: r.quantity_delta,
                balanceAfter: r.balance_after,
                unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
                note: r.note,
            })),
        };
    }

    // ── Loyalty ──────────────────────────────────────────────────────────────

    /** Points outstanding and who holds them — the unbilled liability. */
    async getLoyaltySummary(tenantId: string, limit = 10) {
        const [totals, top, settings] = await Promise.all([
            this.db.customer.aggregate({
                where: { tenant_id: tenantId, deleted_at: null, loyalty_points: { gt: 0 } },
                _sum: { loyalty_points: true },
                _count: { _all: true },
            }),
            this.db.customer.findMany({
                where: { tenant_id: tenantId, deleted_at: null, loyalty_points: { gt: 0 } },
                select: { id: true, name: true, phone: true, loyalty_points: true, total_spent: true },
                orderBy: { loyalty_points: 'desc' },
                take: limit,
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    loyalty_points_enabled: true,
                    loyalty_earn_rate: true,
                    loyalty_redeem_rate: true,
                    loyalty_min_redeem: true,
                },
            }),
        ]);

        const pointsOutstanding = totals._sum.loyalty_points ?? 0;
        const redeemRate = Number(settings?.loyalty_redeem_rate ?? 0);

        return {
            enabled: settings?.loyalty_points_enabled ?? false,
            totalPointsOutstanding: pointsOutstanding,
            customersWithPoints: totals._count._all,
            // What those points are worth if every holder redeemed today — the
            // figure a shop owner actually needs, since points are a liability.
            estimatedRedemptionValue: redeemRate > 0 ? pointsOutstanding * redeemRate : null,
            settings: settings
                ? {
                      earnRate: Number(settings.loyalty_earn_rate ?? 0),
                      redeemRate,
                      minRedeem: Number(settings.loyalty_min_redeem ?? 0),
                  }
                : null,
            topHolders: top.map((c) => ({
                customer: c.name,
                phone: c.phone,
                points: c.loyalty_points,
                lifetimeSpend: Number(c.total_spent),
            })),
        };
    }
}

function toDateString(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

/** A bare date upper bound covers the whole day, not the instant of midnight. */
function endOfDay(value: string): Date {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    return new Date(dateOnly ? `${value.trim()}T23:59:59.999Z` : value);
}

function buildWindow(from?: string, to?: string) {
    if (!from && !to) return null;
    return {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: endOfDay(to) } : {}),
    };
}

function countBy(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
}
