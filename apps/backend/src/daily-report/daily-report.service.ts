import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CashierSessionsService } from '../cashier-sessions/cashier-sessions.service';
import { PurchaseReportsService } from '../purchase-reports/purchase-reports.service';
import { ExpensesService } from '../expenses/expenses.service';
import { AccountingService } from '../accounting/accounting.service';
import { addCalendarDays, zonedDateString, zonedDayStart } from '../common/tenant-time.util';
import { classifyPaymentMode } from '../sales/classify-payment-mode';
import { LOW_STOCK_THRESHOLD } from '../products/products.service';
import { buildTenders, round2 } from './money';
import { formatDailyReportWhatsApp } from './format-whatsapp';
import type {
    DailyReport,
    DailyReportChecklistCode,
    DailyReportTillRollup,
    DailyReportTillSession,
} from './daily-report.types';

export type GetDailyReportInput = {
    tenantId: string;
    storeId: string;
    tenantName: string;
    storeName: string;
    date: string;
    timezone: string;
    locale: string;
    now?: Date;
};

const PENDING_DELIVERY_STATUSES = ['DELIVERY_PENDING', 'AWAITING_DELIVERY', 'PENDING_DELIVERY'];

const CHECKLIST_HREF: Record<DailyReportChecklistCode, string> = {
    OPEN_TILL: '/sales/cashier-sessions',
    REORDER: '/inventory/reports/reorder',
    PENDING_DELIVERY: '/sales/delivery',
};

function num(value: unknown): number {
    return Number(value ?? 0);
}

function expenseEntryCount(summary: unknown): number {
    if (!summary || typeof summary !== 'object') return 0;
    const entries = (summary as { entries?: unknown }).entries;
    return Array.isArray(entries) ? entries.length : 0;
}

async function settled<T>(promise: Promise<T>): Promise<T | null> {
    try {
        return await promise;
    } catch {
        return null;
    }
}

@Injectable()
export class DailyReportService {
    constructor(
        private db: DatabaseService,
        private cashierSessions: CashierSessionsService,
        private purchaseReports: PurchaseReportsService,
        private expenses: ExpensesService,
        private accounting: AccountingService,
    ) {}

    async getReport(input: GetDailyReportInput): Promise<DailyReport> {
        const now = input.now ?? new Date();
        if (input.date > zonedDateString(now, input.timezone)) {
            throw new BadRequestException('Date cannot be in the future');
        }

        const start = zonedDayStart(input.date, input.timezone);
        const end = zonedDayStart(addCalendarDays(input.date, 1), input.timezone);
        if (!start || !end) {
            throw new BadRequestException('Invalid date');
        }
        const dayRange = { gte: start, lt: end };
        const previousStart = zonedDayStart(addCalendarDays(input.date, -1), input.timezone);
        const dateQuery = { from: input.date, to: input.date, storeId: input.storeId };

        const [
            daySales,
            yesterdaySales,
            till,
            purchases,
            expenseSummary,
            supplierPayments,
            customerPayments,
            accountingOverview,
            returnsRows,
            pendingDeliveryCount,
        ] = await Promise.all([
            this.db.sale.findMany({
                where: {
                    tenant_id: input.tenantId,
                    store_id: input.storeId,
                    status: 'COMPLETED',
                    sale_date: dayRange,
                },
                select: {
                    total_amount: true,
                    amount_paid: true,
                    sale_date: true,
                    payments: { select: { payment_method: true, amount: true } },
                    items: {
                        select: {
                            quantity: true,
                            price_at_sale: true,
                            product: { select: { name: true } },
                        },
                    },
                },
            }),
            previousStart
                ? settled(
                      this.db.sale.findMany({
                          where: {
                              tenant_id: input.tenantId,
                              store_id: input.storeId,
                              status: 'COMPLETED',
                              sale_date: { gte: previousStart, lt: start },
                          },
                          select: { total_amount: true },
                      }),
                  )
                : Promise.resolve(null),
            settled(this.loadTill(input, start, end, dayRange)),
            settled(this.purchaseReports.getPurchaseSummary(input.tenantId, dateQuery)),
            settled(this.expenses.getSummary(input.tenantId, dateQuery)),
            settled(
                this.db.supplierCreditTransaction.findMany({
                    where: { tenant_id: input.tenantId, type: 'PAYMENT', created_at: dayRange },
                    select: { amount: true },
                }),
            ),
            settled(
                this.db.customerCreditTransaction.findMany({
                    where: { tenant_id: input.tenantId, type: 'PAYMENT', created_at: dayRange },
                    select: { amount: true },
                }),
            ),
            settled(
                this.accounting.getAccountingDashboardOverview(input.tenantId, {
                    from: input.date,
                    to: input.date,
                }),
            ),
            settled(
                this.db.salesReturn.findMany({
                    where: {
                        tenant_id: input.tenantId,
                        store_id: input.storeId,
                        created_at: dayRange,
                    },
                    select: { return_number: true, reason: true, total_refund: true },
                    orderBy: { created_at: 'desc' },
                }),
            ),
            settled(
                this.db.sale.count({
                    where: {
                        tenant_id: input.tenantId,
                        store_id: input.storeId,
                        status: { in: PENDING_DELIVERY_STATUSES },
                    },
                }),
            ),
        ]);

        const allReturns = returnsRows ?? [];
        const gross = round2(daySales.reduce((sum, sale) => sum + num(sale.total_amount), 0));
        const returnsAmount = round2(allReturns.reduce((sum, row) => sum + num(row.total_refund), 0));
        const net = round2(gross - returnsAmount);
        const bills = daySales.length;
        const yesterdayNet =
            yesterdaySales == null
                ? null
                : round2(yesterdaySales.reduce((sum, sale) => sum + num(sale.total_amount), 0));
        const vsPreviousPct =
            yesterdayNet == null || yesterdayNet === 0
                ? null
                : round2(((net - yesterdayNet) / yesterdayNet) * 100);

        const payMap = new Map<string, number>();
        for (const sale of daySales) {
            for (const payment of sale.payments ?? []) {
                const method = payment.payment_method || 'CASH';
                payMap.set(method, (payMap.get(method) ?? 0) + num(payment.amount));
            }
        }
        const tenders = buildTenders(
            gross,
            Array.from(payMap.entries()).map(([method, amount]) => ({ method, amount })),
        );

        const newDues = round2(
            daySales.reduce(
                (sum, sale) => sum + Math.max(0, num(sale.total_amount) - num(sale.amount_paid)),
                0,
            ),
        );
        const saleTimes = daySales
            .map((sale) => sale.sale_date)
            .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
            .sort((a, b) => a.getTime() - b.getTime());
        const firstSaleAt = saleTimes[0]?.toISOString() ?? null;
        const lastSaleAt = saleTimes.length > 0 ? saleTimes[saleTimes.length - 1].toISOString() : null;

        const collected = round2(
            (customerPayments ?? []).reduce((sum, tx) => sum + num(tx.amount), 0),
        );
        const paidToSuppliers = supplierPayments
            ? round2(supplierPayments.reduce((sum, tx) => sum + num(tx.amount), 0))
            : null;

        const purchasesBlock = purchases
            ? {
                  count: num(purchases.summary.orderCount),
                  net: round2(num(purchases.summary.netPurchases)),
              }
            : null;
        const expensesBlock = expenseSummary
            ? {
                  count: expenseEntryCount(expenseSummary),
                  amount: round2(num(expenseSummary.total)),
              }
            : null;
        const moneyOut =
            purchasesBlock === null && paidToSuppliers === null && expensesBlock === null
                ? null
                : { purchases: purchasesBlock, paidToSuppliers, expenses: expensesBlock };

        const dues = accountingOverview
            ? {
                  newDues,
                  collected,
                  accountsReceivable:
                      accountingOverview.position?.accounts_receivable == null
                          ? null
                          : round2(num(accountingOverview.position.accounts_receivable)),
                  accountsPayable:
                      accountingOverview.position?.accounts_payable == null
                          ? null
                          : round2(num(accountingOverview.position.accounts_payable)),
              }
            : null;

        const productMap = new Map<string, { name: string; units: number; revenue: number }>();
        for (const sale of daySales) {
            for (const item of sale.items ?? []) {
                const name = item.product?.name || '—';
                const existing = productMap.get(name) ?? { name, units: 0, revenue: 0 };
                existing.units += num(item.quantity);
                existing.revenue += num(item.quantity) * num(item.price_at_sale);
                productMap.set(name, existing);
            }
        }
        const topProducts = Array.from(productMap.values())
            .map((row) => ({ ...row, revenue: round2(row.revenue) }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        const returns = {
            rows: allReturns.slice(0, 5).map((row) => ({
                label: (row.reason && String(row.reason).trim()) || String(row.return_number ?? ''),
                amount: round2(num(row.total_refund)),
            })),
            moreCount: Math.max(0, allReturns.length - 5),
        };

        const stock = await settled(this.loadStock(input.tenantId, dayRange));

        const cashMovement = this.cashMovement(till, tenders, allReturns);

        const generatedAt = now.toISOString();
        const checklist = this.checklist(
            till?.openSessionCount ?? 0,
            stock?.reorderCount ?? 0,
            pendingDeliveryCount ?? 0,
        );

        const payload: DailyReport = {
            tenantName: input.tenantName,
            storeName: input.storeName,
            date: input.date,
            timezone: input.timezone,
            generatedAt,
            asOf: generatedAt,
            firstSaleAt,
            lastSaleAt,
            headlines: {
                netSales: net,
                cashMovement,
                newDues,
                vsPreviousPct,
            },
            sales: {
                bills,
                gross,
                returnsAmount,
                returnsCount: allReturns.length,
                net,
                avgBill: bills ? round2(net / bills) : 0,
            },
            tenders,
            till,
            moneyOut,
            dues,
            topProducts,
            returns,
            stock,
            checklist,
            whatsappText: '',
        };
        payload.whatsappText = formatDailyReportWhatsApp(payload, input.locale);
        return payload;
    }

    private cashMovement(
        till: DailyReport['till'],
        tenders: DailyReport['tenders'],
        returns: Array<{ total_refund?: unknown }>,
    ): number {
        if (till && till.sessions.length > 0) {
            const { cashTakings, refunds, cashIn, cashOut } = till.rollup;
            return round2(cashTakings - refunds + cashIn - cashOut);
        }
        const cashTenders = tenders
            .filter((t) => classifyPaymentMode(t.method) === 'cash')
            .reduce((sum, t) => sum + t.amount, 0);
        const cashRefunds = returns.reduce((sum, row) => sum + num(row.total_refund), 0);
        return round2(cashTenders - cashRefunds);
    }

    private checklist(openTills: number, reorderCount: number, pendingDelivery: number) {
        const items: Array<{ code: DailyReportChecklistCode; count: number; href: string }> = [];
        if (openTills > 0) {
            items.push({ code: 'OPEN_TILL', count: openTills, href: CHECKLIST_HREF.OPEN_TILL });
        }
        if (reorderCount > 0) {
            items.push({ code: 'REORDER', count: reorderCount, href: CHECKLIST_HREF.REORDER });
        }
        if (pendingDelivery > 0) {
            items.push({
                code: 'PENDING_DELIVERY',
                count: pendingDelivery,
                href: CHECKLIST_HREF.PENDING_DELIVERY,
            });
        }
        return items;
    }

    private async loadTill(
        input: GetDailyReportInput,
        start: Date,
        end: Date,
        dayRange: { gte: Date; lt: Date },
    ): Promise<NonNullable<DailyReport['till']>> {
        const sessions = await this.db.cashierSession.findMany({
            where: {
                tenant_id: input.tenantId,
                store_id: input.storeId,
                opened_at: { lt: end },
                OR: [{ closed_at: null }, { closed_at: { gte: start } }],
            },
            include: {
                counter: { select: { name: true } },
                user: { select: { name: true } },
            },
        });

        const summaries = await Promise.all(
            sessions.map((session) => this.cashierSessions.getSessionSummary(input.tenantId, session.id)),
        );

        const mapped: DailyReportTillSession[] = sessions.map((session, i) => {
            const summary = summaries[i];
            const status: 'OPEN' | 'CLOSED' = session.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
            return {
                sessionId: session.id,
                counterName: session.counter?.name ?? '',
                cashierName: session.user?.name ?? '',
                status,
                openingCash: round2(num(summary.openingCash)),
                cashTakings: round2(num(summary.cashTakings)),
                refunds: round2(num(summary.refunds)),
                cashIn: round2(num(summary.cashIn)),
                cashOut: round2(num(summary.cashOut)),
                expectedCash: round2(num(summary.expectedCash)),
                closingCash: summary.closingCash == null ? null : round2(num(summary.closingCash)),
                variance: summary.variance == null ? null : round2(num(summary.variance)),
            };
        });

        const anyOpen = mapped.some((s) => s.status === 'OPEN');
        const sum = (pick: (s: DailyReportTillSession) => number) =>
            round2(mapped.reduce((total, s) => total + pick(s), 0));
        const rollup: DailyReportTillRollup = {
            openingCash: sum((s) => s.openingCash),
            cashTakings: sum((s) => s.cashTakings),
            refunds: sum((s) => s.refunds),
            cashIn: sum((s) => s.cashIn),
            cashOut: sum((s) => s.cashOut),
            expectedCash: sum((s) => s.expectedCash),
            closingCash: anyOpen ? null : sum((s) => s.closingCash ?? 0),
            variance: anyOpen ? null : sum((s) => s.variance ?? 0),
        };

        const unassignedSalesCount = await this.db.sale.count({
            where: {
                tenant_id: input.tenantId,
                store_id: input.storeId,
                session_id: null,
                status: 'COMPLETED',
                sale_date: dayRange,
            },
        });

        return {
            sessions: mapped,
            rollup,
            openSessionCount: mapped.filter((s) => s.status === 'OPEN').length,
            unassignedSalesCount,
        };
    }

    private async loadStock(
        tenantId: string,
        dayRange: { gte: Date; lt: Date },
    ): Promise<NonNullable<DailyReport['stock']>> {
        const [settings, products, shrinkages] = await Promise.all([
            this.db.inventorySettings.findUnique({
                where: { tenant_id: tenantId },
                select: { default_reorder_level: true },
            }),
            this.db.product.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: {
                    name: true,
                    reorder_level: true,
                    stocks: { select: { quantity: true } },
                },
            }),
            this.db.inventoryShrinkage.findMany({
                where: { tenant_id: tenantId, direction: 'LOSS', created_at: dayRange },
                include: { items: { select: { quantity: true, unit_cost: true } } },
            }),
        ]);

        const defaultLevel = settings?.default_reorder_level ?? LOW_STOCK_THRESHOLD;
        const reorderAll: Array<{ name: string; onHand: number; level: number }> = [];
        let zeroCount = 0;
        for (const product of products) {
            const onHand = product.stocks.reduce((sum, row) => sum + num(row.quantity), 0);
            const level = product.reorder_level ?? defaultLevel;
            if (onHand <= 0) zeroCount += 1;
            if (onHand <= level) {
                reorderAll.push({ name: product.name, onHand, level });
            }
        }

        const shrinkageAmount = round2(
            shrinkages.reduce(
                (sum, doc) =>
                    sum +
                    doc.items.reduce(
                        (itemSum, item) => itemSum + num(item.quantity) * num(item.unit_cost),
                        0,
                    ),
                0,
            ),
        );

        return {
            reorder: reorderAll.slice(0, 5),
            reorderCount: reorderAll.length,
            zeroCount,
            shrinkageCount: shrinkages.length,
            shrinkageAmount,
        };
    }
}
