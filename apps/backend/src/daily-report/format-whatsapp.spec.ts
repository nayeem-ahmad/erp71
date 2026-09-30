import { formatDailyReportWhatsApp } from './format-whatsapp';
import type { DailyReport } from './daily-report.types';

function emptyReport(overrides: Partial<DailyReport> = {}): DailyReport {
    return {
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-01',
        timezone: 'Asia/Dhaka',
        generatedAt: '2026-10-01T15:18:00.000Z',
        asOf: '2026-10-01T15:18:00.000Z',
        firstSaleAt: null,
        lastSaleAt: null,
        headlines: { netSales: 0, cashMovement: 0, newDues: 0, vsPreviousPct: null },
        sales: { bills: 0, gross: 0, returnsAmount: 0, returnsCount: 0, net: 0, avgBill: 0 },
        tenders: [],
        till: null,
        moneyOut: { purchases: { count: 0, net: 0 }, paidToSuppliers: 0, expenses: { count: 0, amount: 0 } },
        dues: null,
        topProducts: [],
        returns: { rows: [], moreCount: 0 },
        stock: null,
        checklist: [],
        whatsappText: '',
        ...overrides,
    };
}

describe('formatDailyReportWhatsApp', () => {
    it('says No sales on a quiet day', () => {
        const text = formatDailyReportWhatsApp(emptyReport(), 'en');
        expect(text).toMatch(/Karim Electronics/);
        expect(text).toMatch(/No sales/);
        expect(text).not.toMatch(/Purchases/i);
    });

    it('omits a zero purchases line and includes till variance', () => {
        const text = formatDailyReportWhatsApp(
            emptyReport({
                headlines: { netSales: 84500, cashMovement: 31200, newDues: 12000, vsPreviousPct: 12 },
                sales: { bills: 47, gross: 89100, returnsAmount: 4600, returnsCount: 3, net: 84500, avgBill: 1798 },
                tenders: [
                    { method: 'CASH', amount: 38000 },
                    { method: 'bKash', amount: 22500 },
                    { method: 'Credit', amount: 12000 },
                ],
                till: {
                    sessions: [],
                    rollup: {
                        openingCash: 2000, cashTakings: 38000, refunds: 0, cashIn: 0, cashOut: 0,
                        expectedCash: 23200, closingCash: 23050, variance: -150,
                    },
                    openSessionCount: 0,
                    unassignedSalesCount: 0,
                },
                moneyOut: { purchases: { count: 0, net: 0 }, paidToSuppliers: 0, expenses: { count: 1, amount: 1800 } },
                topProducts: [{ name: 'Samsung 25W', units: 14, revenue: 12600 }],
                checklist: [{ code: 'REORDER', count: 4, href: '/inventory/reports/reorder' }],
            }),
            'en',
        );
        expect(text).toMatch(/Sales ৳84,500/);
        expect(text).toMatch(/till/);
        expect(text).toMatch(/-৳150|−৳150/);
        expect(text).not.toMatch(/purchases/i);
        expect(text).toMatch(/expenses/i);
        expect(text.length).toBeLessThanOrEqual(700);
    });
});
