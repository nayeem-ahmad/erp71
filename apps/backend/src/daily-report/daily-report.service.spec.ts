import { BadRequestException } from '@nestjs/common';
import { DailyReportService } from './daily-report.service';

function salesSummary(net: number, gross = net, bills = 1, returns = 0) {
    return {
        summary: {
            totalRevenue: gross,
            totalReturns: returns,
            netRevenue: net,
            transactionCount: bills,
            avgOrderValue: bills ? net / bills : 0,
        },
        rows: [{ date: '2026-10-01', transactions: bills, grossRevenue: gross, returns, netRevenue: net }],
    };
}

describe('DailyReportService.getReport', () => {
    const salesReports = {
        getSalesSummary: jest.fn(),
        getSalesBreakdown: jest.fn(),
        getSalesByProduct: jest.fn(),
    };
    const cashierSessions = { getSessionSummary: jest.fn() };
    const purchaseReports = { getPurchaseSummary: jest.fn() };
    const expenses = { getSummary: jest.fn() };
    const accounting = { getAccountingDashboardOverview: jest.fn() };
    const db = {
        sale: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn() },
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
        db.sale.findMany.mockResolvedValue([]);
        db.sale.count.mockResolvedValue(0);
        db.salesReturn.findMany.mockResolvedValue([]);
        db.cashierSession.findMany.mockResolvedValue([]);
        db.customerCreditTransaction.findMany.mockResolvedValue([]);
        db.supplierCreditTransaction.findMany.mockResolvedValue([]);
        db.product.findMany.mockResolvedValue([]);
        db.inventoryShrinkage.findMany.mockResolvedValue([]);
        salesReports.getSalesSummary.mockImplementation((_tid: string, q: { from?: string }) => {
            if (q.from === '2026-09-30') return salesSummary(0, 0, 0, 0);
            return salesSummary(800, 1000, 2, 200);
        });
        salesReports.getSalesBreakdown.mockResolvedValue({
            rows: [
                { label: 'CASH', revenue: 600 },
                { label: 'bKash', revenue: 250 },
            ],
        });
        salesReports.getSalesByProduct.mockResolvedValue({
            rows: [{ product: { name: 'Charger' }, unitsSold: 3, revenue: 500 }],
        });
        purchaseReports.getPurchaseSummary.mockResolvedValue({
            summary: { netPurchases: 0, orderCount: 0 },
        });
        expenses.getSummary.mockResolvedValue({ total: 0, entries: [] });
        accounting.getAccountingDashboardOverview.mockResolvedValue({
            position: { accounts_receivable: 142000, accounts_payable: 87000 },
        });
        db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 1000, amount_paid: 850 } });
        service = new DailyReportService(
            db as any,
            salesReports as any,
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

    it('puts a 01:00 Asia/Dhaka sale on that Dhaka date via getSalesSummary from/to', async () => {
        await service.getReport(input);
        expect(salesReports.getSalesSummary).toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ from: '2026-10-01', to: '2026-10-01', storeId: 's1' }),
            'Asia/Dhaka',
        );
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
