import { BadRequestException } from '@nestjs/common';
import { addCalendarDays, zonedDayStart } from '../common/tenant-time.util';
import { DailyReportService } from './daily-report.service';

describe('DailyReportService.getReport', () => {
    const cashierSessions = { getSessionSummary: jest.fn() };
    const purchaseReports = { getPurchaseSummary: jest.fn() };
    const expenses = { getSummary: jest.fn() };
    const accounting = { getAccountingDashboardOverview: jest.fn() };
    const db = {
        sale: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
        cashierSession: { findMany: jest.fn().mockResolvedValue([]) },
        customerCreditTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        supplierCreditTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        inventoryShrinkage: { findMany: jest.fn().mockResolvedValue([]) },
        inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const input = {
        tenantId: 't1',
        storeId: 's1',
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-01',
        timezone: 'Asia/Dhaka',
        locale: 'en',
        now: new Date('2026-10-01T15:00:00.000Z'),
    };

    let service: DailyReportService;

    beforeEach(() => {
        jest.clearAllMocks();
        const todayStart = zonedDayStart('2026-10-01', 'Asia/Dhaka')!;
        db.sale.findMany.mockImplementation(async ({ where }: { where: { sale_date?: { gte?: Date } } }) => {
            if (where.sale_date?.gte?.getTime() === todayStart.getTime()) {
                return [
                    {
                        total_amount: 600,
                        amount_paid: 600,
                        sale_date: new Date('2026-10-01T04:00:00.000Z'),
                        payments: [{ payment_method: 'CASH', amount: 600 }],
                        items: [],
                    },
                    {
                        total_amount: 400,
                        amount_paid: 250,
                        sale_date: new Date('2026-10-01T08:00:00.000Z'),
                        payments: [{ payment_method: 'bKash', amount: 250 }],
                        items: [{ quantity: 3, price_at_sale: 500 / 3, product: { name: 'Charger' } }],
                    },
                ];
            }
            return [];
        });
        db.sale.count.mockResolvedValue(0);
        db.salesReturn.findMany.mockResolvedValue([
            { total_refund: 200, return_number: 'R1', reason: 'damaged' },
        ]);
        db.cashierSession.findMany.mockResolvedValue([]);
        db.customerCreditTransaction.findMany.mockResolvedValue([]);
        db.supplierCreditTransaction.findMany.mockResolvedValue([]);
        db.product.findMany.mockResolvedValue([]);
        db.inventoryShrinkage.findMany.mockResolvedValue([]);
        purchaseReports.getPurchaseSummary.mockResolvedValue({
            summary: { netPurchases: 0, orderCount: 0 },
        });
        expenses.getSummary.mockResolvedValue({ total: 0, entries: [] });
        accounting.getAccountingDashboardOverview.mockResolvedValue({
            position: { accounts_receivable: 142000, accounts_payable: 87000 },
        });
        service = new DailyReportService(
            db as any,
            cashierSessions as any,
            purchaseReports as any,
            expenses as any,
            accounting as any,
        );
    });

    it('makes tenders including Credit equal gross and net equal gross minus returns', async () => {
        const report = await service.getReport(input);
        expect(report.sales.gross).toBe(1000);
        expect(report.sales.net).toBe(800);
        expect(report.headlines.netSales).toBe(800);
        const tenderSum = report.tenders.reduce((s, t) => s + t.amount, 0);
        expect(tenderSum).toBe(1000);
        expect(report.tenders.some((t) => t.method === 'Credit' && t.amount === 150)).toBe(true);
    });

    it('counts a 01:00 Asia/Dhaka sale in both net sales and new dues', async () => {
        const todayStart = zonedDayStart('2026-10-01', 'Asia/Dhaka')!;
        db.sale.findMany.mockImplementation(async ({ where }: { where: { sale_date?: { gte?: Date } } }) => {
            if (where.sale_date?.gte?.getTime() === todayStart.getTime()) {
                return [
                    {
                        total_amount: 1000,
                        amount_paid: 0,
                        sale_date: new Date('2026-09-30T19:00:00.000Z'),
                        payments: [],
                        items: [],
                    },
                ];
            }
            return [];
        });
        db.salesReturn.findMany.mockResolvedValue([]);
        const report = await service.getReport(input);
        expect(report.sales.gross).toBe(1000);
        expect(report.sales.net).toBe(1000);
        expect(report.headlines.netSales).toBe(1000);
        expect(report.headlines.newDues).toBe(1000);
        expect(report.firstSaleAt).toBe('2026-09-30T19:00:00.000Z');
    });

    it('includes an overnight open till on today and leaves unassigned sales out of expected cash', async () => {
        db.cashierSession.findMany.mockResolvedValue([
            {
                id: 'sess-night',
                status: 'OPEN',
                opened_at: new Date('2026-09-30T18:00:00.000Z'),
                closed_at: null,
                opening_cash: 500,
                counter: { name: 'Counter 1' },
                user: { name: 'Amina' },
            },
        ]);
        cashierSessions.getSessionSummary.mockResolvedValue({
            sessionId: 'sess-night',
            openingCash: 500,
            cashTakings: 300,
            refunds: 0,
            cashIn: 0,
            cashOut: 0,
            expectedCash: 800,
            closingCash: null,
            variance: null,
        });
        db.sale.count.mockResolvedValue(2);
        const report = await service.getReport(input);
        expect(report.till?.sessions).toHaveLength(1);
        expect(report.till?.sessions[0].sessionId).toBe('sess-night');
        expect(report.till?.rollup.expectedCash).toBe(800);
        expect(report.till?.unassignedSalesCount).toBe(2);
        expect(report.till?.openSessionCount).toBe(1);
        expect(report.till?.rollup.variance).toBeNull();
        const start = zonedDayStart('2026-10-01', 'Asia/Dhaka');
        const end = zonedDayStart(addCalendarDays('2026-10-01', 1), 'Asia/Dhaka');
        expect(db.cashierSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    opened_at: { lt: end },
                    OR: [{ closed_at: null }, { closed_at: { gte: start } }],
                }),
            }),
        );
    });

    it('keeps vsPreviousPct null when yesterday sales cannot load', async () => {
        const todayStart = zonedDayStart('2026-10-01', 'Asia/Dhaka')!;
        db.sale.findMany.mockImplementation(async ({ where }: { where: { sale_date?: { gte?: Date } } }) => {
            if (where.sale_date?.gte?.getTime() === todayStart.getTime()) {
                return [
                    {
                        total_amount: 800,
                        amount_paid: 800,
                        sale_date: new Date('2026-10-01T04:00:00.000Z'),
                        payments: [{ payment_method: 'CASH', amount: 800 }],
                        items: [],
                    },
                ];
            }
            throw new Error('yesterday down');
        });
        db.salesReturn.findMany.mockResolvedValue([]);
        const report = await service.getReport(input);
        expect(report.sales.net).toBe(800);
        expect(report.headlines.vsPreviousPct).toBeNull();
    });

    it('nulls stock when the product query rejects and still returns sales', async () => {
        db.product.findMany.mockRejectedValue(new Error('stock down'));
        const report = await service.getReport(input);
        expect(report.stock).toBeNull();
        expect(report.sales.net).toBe(800);
    });

    it('rejects a future local date', async () => {
        await expect(service.getReport({ ...input, date: '2026-10-02' })).rejects.toBeInstanceOf(BadRequestException);
    });
});
