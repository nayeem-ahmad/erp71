import { assertCustomerCreditForSale, creditDueAmount } from './customer-credit.utils';
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
});