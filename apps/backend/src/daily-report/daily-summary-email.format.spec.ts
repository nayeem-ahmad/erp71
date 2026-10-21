import type { DailyReport } from './daily-report.types';
import { formatDailySummaryEmail, type SummaryBranch } from './daily-summary-email.format';

function report(overrides: Partial<DailyReport> = {}): DailyReport {
    return {
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-20',
        timezone: 'Asia/Dhaka',
        generatedAt: '2026-10-20T18:20:00.000Z',
        asOf: '2026-10-20T18:20:00.000Z',
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

function branch(storeId: string, storeName: string, overrides: Partial<DailyReport> = {}): SummaryBranch {
    return { storeId, storeName, report: report({ storeName, ...overrides }) };
}

const base = {
    tenantName: 'Karim Electronics',
    date: '2026-10-20',
    timezone: 'Asia/Dhaka',
    locale: 'en',
    asOf: '2026-10-20T18:20:00.000Z',
    reportBaseUrl: 'https://app.erp71.com',
};

describe('formatDailySummaryEmail', () => {
    it('keeps a single branch as one block, with a link to that day', () => {
        const email = formatDailySummaryEmail({
            ...base,
            branches: [branch('store-1', 'Main', {
                headlines: { netSales: 128400, cashMovement: 18400, newDues: 0, vsPreviousPct: null },
                sales: { bills: 46, gross: 130000, returnsAmount: 1600, returnsCount: 2, net: 128400, avgBill: 2791 },
                tenders: [
                    { method: 'CASH', amount: 84200 },
                    { method: 'bKash', amount: 12000 },
                    { method: 'Credit', amount: 32200 },
                ],
                till: {
                    sessions: [],
                    rollup: {
                        openingCash: 0, cashTakings: 84200, refunds: 0, cashIn: 0, cashOut: 0,
                        expectedCash: 0, closingCash: 120, variance: 120,
                    },
                    openSessionCount: 0,
                    unassignedSalesCount: 0,
                },
                dues: { newDues: 0, collected: 0, accountsReceivable: 210000, accountsPayable: 85000 },
            })],
        });

        expect(email.subject).toBe('Karim Electronics · Main · 20 Oct');
        expect(email.text).not.toMatch(/All branches/);
        expect(email.text).toMatch(/Sales ৳128,400 \(46 bills, 2 returns\)/);
        expect(email.text).toMatch(/Dues now ৳210,000/);
        expect(email.text).toMatch(/Open the report/);
        expect(email.text).toContain('https://app.erp71.com/sales/daily-report?date=2026-10-20&storeId=store-1');
        expect(email.html).toContain('storeId=store-1');
    });

    it('puts the company total first and does not repeat company-wide figures', () => {
        const dues = { newDues: 0, collected: 0, accountsReceivable: 5000, accountsPayable: 2000 };
        const reorder = [{ code: 'REORDER' as const, count: 4, href: '/inventory/reports/reorder' }];
        const email = formatDailySummaryEmail({
            ...base,
            branches: [
                branch('g', 'Gulshan', {
                    headlines: { netSales: 500, cashMovement: 200, newDues: 0, vsPreviousPct: null },
                    sales: { bills: 1, gross: 500, returnsAmount: 0, returnsCount: 1, net: 500, avgBill: 500 },
                    tenders: [{ method: 'CASH', amount: 200 }],
                    till: {
                        sessions: [],
                        rollup: {
                            openingCash: 0, cashTakings: 200, refunds: 0, cashIn: 0, cashOut: 0,
                            expectedCash: 0, closingCash: 0, variance: -10,
                        },
                        openSessionCount: 1,
                        unassignedSalesCount: 0,
                    },
                    dues,
                    topProducts: [{ name: 'Widget', units: 2, revenue: 200 }],
                    checklist: [
                        { code: 'OPEN_TILL', count: 1, href: '/sales/cashier-sessions' },
                        ...reorder,
                    ],
                }),
                branch('m', 'Main <b>', {
                    headlines: { netSales: 1000, cashMovement: 600, newDues: 0, vsPreviousPct: null },
                    sales: { bills: 2, gross: 1000, returnsAmount: 0, returnsCount: 0, net: 1000, avgBill: 500 },
                    tenders: [
                        { method: 'CASH', amount: 600 },
                        { method: 'bKash', amount: 400 },
                    ],
                    moneyOut: { purchases: { count: 0, net: 0 }, paidToSuppliers: 0, expenses: { count: 1, amount: 100 } },
                    dues,
                    topProducts: [{ name: 'Widget', units: 3, revenue: 600 }],
                    checklist: reorder,
                }),
            ],
        });

        expect(email.subject).toBe('Karim Electronics · 20 Oct');
        const text = email.text;
        const overall = text.slice(text.indexOf('All branches'), text.indexOf('Main <b>'));
        expect(text.indexOf('All branches')).toBeLessThan(text.indexOf('Main <b>'));
        expect(text.indexOf('Main <b>')).toBeLessThan(text.indexOf('Gulshan'));
        expect(text).toMatch(/Sales ৳1,500 \(3 bills, 1 returns\)/);
        expect(text.match(/Dues now/g)).toHaveLength(1);
        expect(overall).toMatch(/Cash \+৳800/);
        expect(overall).not.toMatch(/· till/);
        expect(text).toMatch(/Top: Widget ×5/);
        expect(text).toMatch(/1 till open · 4 to reorder/);
        expect(text).not.toMatch(/8 to reorder/);
        expect(email.html).toContain('Main &lt;b&gt;');
        expect(email.html).not.toContain('Main <b>');
        expect(email.html).toContain('storeId=m');
        expect(email.html).toContain('storeId=g');
    });

    it('keeps a quiet branch as one line and still says when the whole day was quiet', () => {
        const email = formatDailySummaryEmail({
            ...base,
            branches: [
                branch('m', 'Main'),
                branch('g', 'Gulshan'),
            ],
        });

        expect(email.text).toMatch(/All branches\nNo sales/);
        expect(email.text).toMatch(/Main\nhttps:\/\/app\.erp71\.com\/sales\/daily-report\?date=2026-10-20&storeId=m\nNo sales/);
        expect(email.text).toMatch(/Gulshan\nhttps:\/\/app\.erp71\.com\/sales\/daily-report\?date=2026-10-20&storeId=g\nNo sales/);
    });
});
