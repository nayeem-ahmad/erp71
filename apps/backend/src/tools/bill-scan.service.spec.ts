import { BillScanService, bestMatch, normalizeBillFields, significantWords } from './bill-scan.service';

describe('bill scan matching', () => {
    it('drops sizes and units from a bill line', () => {
        expect(significantWords('Teer Soyabean Oil 5L x 2')).toEqual(['teer', 'soyabean', 'oil']);
    });

    it('picks the closest product and refuses a weak one', () => {
        const products = [{ name: 'Teer Soyabean Oil 5 Ltr' }, { name: 'Rupchanda Soyabean Oil 5 Ltr' }, { name: 'Teer Atta' }];
        expect(bestMatch('Teer Soyabean Oil 5L', products, (p) => p.name)?.name).toBe('Teer Soyabean Oil 5 Ltr');
        expect(bestMatch('Pran Mango Juice', products, (p) => p.name)).toBeNull();
    });
});

describe('normalizeBillFields', () => {
    it('reads amounts written with commas and Tk, and works out a missing quantity', () => {
        const read = normalizeBillFields({
            vendor_name: ' Rahim Store ',
            bill_date: '2026-11-20',
            lines: [{ description: 'Sugar', unit_price: '120', line_total: '1,200' }, { description: '' }, 'junk'],
            total: 'Tk 1,200',
        });
        expect(read.vendorName).toBe('Rahim Store');
        expect(read.lines).toEqual([{ description: 'Sugar', quantity: 10, unitPrice: 120, lineTotal: 1200 }]);
        expect(read.total).toBe(1200);
    });

    it('throws away a date it cannot trust', () => {
        expect(normalizeBillFields({ bill_date: '20/11/2026' }).billDate).toBeNull();
    });
});

describe('BillScanService', () => {
    it('reports the real charge beside the estimate, and matches an expense head', async () => {
        const ai = { scanBill: jest.fn().mockResolvedValue({ fields: { summary: 'Electricity bill for November', total: 4500 }, creditsUsed: 3.456 }) };
        const db = {
            expenseHead: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'h1', name: 'Shop rent', category: { name: 'Rent' } },
                    { id: 'h2', name: 'Electricity', category: { name: 'Utilities' } },
                ]),
            },
        };
        const service = new BillScanService(ai as never, db as never);
        const result = await service.scan({ tenantId: 't', userId: 'u', timezone: 'Asia/Dhaka' }, {
            target: 'expense', imageBase64: 'abc', width: 1200, height: 1600,
        });
        expect(result.credits_used).toBe(3.46);
        expect(result.credits_estimate.expected).toBeGreaterThan(0);
        expect(result.expenseHead).toEqual({ id: 'h2', name: 'Electricity', categoryName: 'Utilities' });
        expect(ai.scanBill).toHaveBeenCalledWith('t', expect.objectContaining({ target: 'expense', maxTokens: 2000 }));
    });
});
