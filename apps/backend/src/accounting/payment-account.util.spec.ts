import { BadRequestException } from '@nestjs/common';
import { cashLegOverride, resolveCreditPaymentMethod, storedPaymentMethodAccountId } from './payment-account.util';

describe('payment-account.util', () => {
    const db = () => ({ paymentMethod: { findFirst: jest.fn() } });

    describe('resolveCreditPaymentMethod()', () => {
        it('returns the tenant\'s active method with its account', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' });

            await expect(resolveCreditPaymentMethod(client as any, 't1', 'pm-bkash'))
                .resolves.toEqual({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' });
            expect(client.paymentMethod.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pm-bkash', tenant_id: 't1', is_active: true },
            }));
        });

        it('refuses an unknown, foreign or switched-off method', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue(null);

            await expect(resolveCreditPaymentMethod(client as any, 't1', 'pm-other'))
                .rejects.toThrow(BadRequestException);
        });
    });

    describe('storedPaymentMethodAccountId()', () => {
        it('reads the current link of a method even after it was switched off', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acc-bank' });

            await expect(storedPaymentMethodAccountId(client as any, 't1', 'pm-bank')).resolves.toBe('acc-bank');
            expect(client.paymentMethod.findFirst.mock.calls[0][0].where).toEqual({ id: 'pm-bank', tenant_id: 't1' });
        });

        it('is undefined without a stored method, or when it has no account', async () => {
            const client = db();
            await expect(storedPaymentMethodAccountId(client as any, 't1', null)).resolves.toBeUndefined();
            expect(client.paymentMethod.findFirst).not.toHaveBeenCalled();

            client.paymentMethod.findFirst.mockResolvedValue({ account_id: null });
            await expect(storedPaymentMethodAccountId(client as any, 't1', 'pm-cash')).resolves.toBeUndefined();
        });
    });

    describe('cashLegOverride()', () => {
        it('puts money coming in on the debit side', () => {
            expect(cashLegOverride('in', 'acc-bkash')).toEqual({ overrideDebitAccountId: 'acc-bkash' });
        });

        it('puts money going out on the credit side', () => {
            expect(cashLegOverride('out', 'acc-bank')).toEqual({ overrideCreditAccountId: 'acc-bank' });
        });

        it('overrides nothing without an account, so the rule default stands', () => {
            expect(cashLegOverride('in', undefined)).toEqual({});
            expect(cashLegOverride('out', null)).toEqual({});
        });
    });
});
