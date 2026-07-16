import {
    isFabricatedVoucher,
    FabricationCandidate,
} from '@erp71/database/prisma/repair-fabricated-vouchers.utils';

const accountNameById = new Map<string, string>([
    ['acc-bank', 'Main Bank Account'],
    ['acc-cash', 'Cash in Hand'],
    ['acc-expense', 'General Operating Expense'],
    ['acc-transit', 'Goods in Transit'],
    ['acc-stock', 'Stock on Hand'],
]);

const voucher = (
    sourceType: string | null,
    debitAccountId: string,
    creditAccountId: string,
): FabricationCandidate => ({
    source_type: sourceType,
    details: [
        { account_id: debitAccountId, debit_amount: 500, credit_amount: 0 },
        { account_id: creditAccountId, debit_amount: 0, credit_amount: 500 },
    ],
});

describe('isFabricatedVoucher', () => {
    it('flags a transfer voucher posted by the fund_movement none-fallback', () => {
        expect(isFabricatedVoucher(voucher('transfer', 'acc-bank', 'acc-cash'), accountNameById)).toBe(true);
    });

    it.each(['shrinkage', 'stock_take_adjustment'])(
        'flags a %s voucher posted by the inventory_adjustment none-fallback',
        (sourceType) => {
            expect(isFabricatedVoucher(voucher(sourceType, 'acc-expense', 'acc-cash'), accountNameById)).toBe(true);
        },
    );

    it('preserves a transfer voucher a tenant configured correctly', () => {
        // Dr Goods in Transit / Cr Stock on Hand is a deliberate perpetual-inventory
        // configuration, not the fallback. Deleting it would destroy real work.
        expect(isFabricatedVoucher(voucher('transfer', 'acc-transit', 'acc-stock'), accountNameById)).toBe(false);
    });

    it('preserves a voucher from an unrelated source type', () => {
        expect(isFabricatedVoucher(voucher('sale', 'acc-cash', 'acc-bank'), accountNameById)).toBe(false);
    });

    it('preserves a voucher with a null source type', () => {
        expect(isFabricatedVoucher(voucher(null, 'acc-bank', 'acc-cash'), accountNameById)).toBe(false);
    });

    it('preserves a voucher whose accounts only half-match the fingerprint', () => {
        expect(isFabricatedVoucher(voucher('transfer', 'acc-bank', 'acc-stock'), accountNameById)).toBe(false);
    });

    it('preserves a voucher that is not exactly two lines', () => {
        const threeLines: FabricationCandidate = {
            source_type: 'transfer',
            details: [
                { account_id: 'acc-bank', debit_amount: 500, credit_amount: 0 },
                { account_id: 'acc-cash', debit_amount: 0, credit_amount: 300 },
                { account_id: 'acc-stock', debit_amount: 0, credit_amount: 200 },
            ],
        };
        expect(isFabricatedVoucher(threeLines, accountNameById)).toBe(false);
    });
});
