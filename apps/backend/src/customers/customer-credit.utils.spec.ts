import { assertCustomerCreditForSale, creditDueAmount, customerLedgerDueDelta } from './customer-credit.utils';
import { BadRequestException } from '@nestjs/common';

describe('customer-credit.utils', () => {
    it('computes credit due from totals', () => {
        expect(creditDueAmount(1000, 600)).toBe(400);
    });

    it('allows credit when within limit', () => {
        expect(() => assertCustomerCreditForSale(
            { due_balance: 1000, credit_limit: 5000 },
            400,
        )).not.toThrow();
    });

    it('rejects credit without customer', () => {
        expect(() => assertCustomerCreditForSale(null, 100)).toThrow(BadRequestException);
    });

    it('rejects credit when projected due exceeds limit', () => {
        expect(() => assertCustomerCreditForSale(
            { due_balance: 4800, credit_limit: 5000 },
            400,
        )).toThrow(/Credit limit exceeded/);
    });

    it('a payment settles its discount along with its money', () => {
        expect(customerLedgerDueDelta('PAYMENT', 100, 3)).toBe(-103);
        expect(customerLedgerDueDelta('PAYMENT', 100)).toBe(-100);
        // Only a payment carries a discount; nothing else may pick one up.
        expect(customerLedgerDueDelta('CREDIT_SALE', 100, 3)).toBe(100);
        expect(customerLedgerDueDelta('PAYOUT', 100, 3)).toBe(100);
    });
});
