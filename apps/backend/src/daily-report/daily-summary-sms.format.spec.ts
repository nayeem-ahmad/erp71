import type { DailyReport } from './daily-report.types';
import type { SummaryBranch } from './daily-summary-email.format';
import { formatDailySummarySms } from './daily-summary-sms.format';

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

function branch(storeName: string, overrides: Partial<DailyReport> = {}): SummaryBranch {
    return { storeId: storeName, storeName, report: report({ storeName, ...overrides }) };
}

const base = {
    tenantName: 'Karim Electronics',
    date: '2026-10-20',
    timezone: 'Asia/Dhaka',
    locale: 'en',
};

describe('formatDailySummarySms', () => {
    it('sums the shop and keeps dues once, without a taka sign', () => {
        const dues = { newDues: 0, collected: 0, accountsReceivable: 210000, accountsPayable: 85000 };
        const text = formatDailySummarySms({
            ...base,
            branches: [
                branch('Main', {
                    headlines: { netSales: 1000, cashMovement: 800, newDues: 0, vsPreviousPct: null },
                    sales: { bills: 2, gross: 1000, returnsAmount: 0, returnsCount: 1, net: 1000, avgBill: 500 },
                    moneyOut: { purchases: { count: 1, net: 400 }, paidToSuppliers: 0, expenses: { count: 0, amount: 0 } },
                    dues,
                }),
                branch('Gulshan', {
                    headlines: { netSales: 500, cashMovement: 0, newDues: 0, vsPreviousPct: null },
                    sales: { bills: 1, gross: 500, returnsAmount: 0, returnsCount: 0, net: 500, avgBill: 500 },
                    dues,
                }),
            ],
        });

        expect(text).toBe(
            'Karim Electronics 20 Oct: Sales Tk1,500 (3 bills, 1 returns). Cash +Tk800. Purchases Tk400. Dues Tk210,000. Suppliers Tk85,000.',
        );
        expect(text).not.toContain('৳');
        expect(text.length).toBeLessThanOrEqual(160);
    });

    it('says no sales on a quiet day and still names standing dues', () => {
        const text = formatDailySummarySms({
            ...base,
            branches: [
                branch('Main', {
                    dues: { newDues: 0, collected: 0, accountsReceivable: 500, accountsPayable: 0 },
                }),
            ],
        });
        expect(text).toBe('Karim Electronics 20 Oct: No sales. Dues Tk500.');
    });

    it('uses Bangla words and the taka sign', () => {
        const text = formatDailySummarySms({
            ...base,
            locale: 'bn',
            branches: [
                branch('Main', {
                    headlines: { netSales: 1500, cashMovement: 0, newDues: 0, vsPreviousPct: null },
                    sales: { bills: 3, gross: 1500, returnsAmount: 0, returnsCount: 0, net: 1500, avgBill: 500 },
                }),
            ],
        });
        expect(text).toBe('Karim Electronics 20 Oct: বিক্রি ৳1,500 (3 বিল).');
    });
});
