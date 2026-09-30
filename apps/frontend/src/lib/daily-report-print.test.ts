import { enMessages } from '@/lib/localization/messages/en';
import type { DailyReport } from '@/lib/daily-report';
import { buildDailyReportHtml } from '@/lib/daily-report-print';

const enLabels = enMessages.sales.dailyReport;

const quietPayload: DailyReport = {
    tenantName: 'Karim Electronics',
    storeName: 'Main',
    date: '2026-10-01',
    timezone: 'Asia/Dhaka',
    generatedAt: '2026-10-01T15:18:00.000Z',
    asOf: '2026-10-01T15:18:00.000Z',
    firstSaleAt: '2026-10-01T03:12:00.000Z',
    lastSaleAt: '2026-10-01T14:40:00.000Z',
    headlines: {
        netSales: 38000,
        cashMovement: 12000,
        newDues: 5000,
        vsPreviousPct: 8.5,
    },
    sales: {
        bills: 12,
        gross: 40000,
        returnsAmount: 2000,
        returnsCount: 1,
        net: 38000,
        avgBill: 3166.67,
    },
    tenders: [
        { method: 'CASH', amount: 20000 },
        { method: 'BKASH', amount: 15000 },
        { method: 'Credit', amount: 5000 },
    ],
    till: {
        sessions: [],
        rollup: {
            openingCash: 0,
            cashTakings: 20000,
            refunds: 0,
            cashIn: 0,
            cashOut: 0,
            expectedCash: 20000,
            closingCash: null,
            variance: null,
        },
        openSessionCount: 0,
        unassignedSalesCount: 0,
    },
    moneyOut: {
        purchases: { count: 0, net: 0 },
        paidToSuppliers: 0,
        expenses: { count: 0, amount: 0 },
    },
    dues: {
        newDues: 5000,
        collected: 0,
        accountsReceivable: 18000,
        accountsPayable: 9000,
    },
    topProducts: [{ name: 'USB-C cable', units: 8, revenue: 2400 }],
    returns: { rows: [], moreCount: 0 },
    stock: null,
    checklist: [],
    whatsappText: 'Karim Electronics · Main · 1 Oct\nNo sales\nAs of 9:18 pm',
};

describe('buildDailyReportHtml', () => {
    it('omits the stock section when stock is null', () => {
        const html = buildDailyReportHtml(quietPayload, enLabels);
        expect(html).not.toMatch(/Stock/i);
        expect(html).toMatch(/Sales/);
    });

    it('omits money out, empty checklist, and empty returns', () => {
        const html = buildDailyReportHtml(quietPayload, enLabels);
        expect(html).not.toMatch(/Money out/i);
        expect(html).not.toMatch(/Checklist/i);
        expect(html).not.toMatch(/Returns/i);
        expect(html).toMatch(/Top products/);
        expect(html).toMatch(/USB-C cable/);
    });

    it('omits stock when every count is zero', () => {
        const html = buildDailyReportHtml(
            {
                ...quietPayload,
                stock: { reorder: [], reorderCount: 0, zeroCount: 0, shrinkageCount: 0, shrinkageAmount: 0 },
            },
            enLabels,
        );
        expect(html).not.toMatch(/Stock/i);
    });
});
