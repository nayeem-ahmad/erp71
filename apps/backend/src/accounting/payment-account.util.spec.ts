import { BadRequestException } from '@nestjs/common';
import { resolveSettlementAccount } from './payment-account.util';

describe('resolveSettlementAccount', () => {
    const makeDb = () => ({
        account: { findFirst: jest.fn() },
        paymentMethod: { findFirst: jest.fn().mockResolvedValue(null) },
        postingRule: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    it('keeps the rule default when nothing is given', async () => {
        const db = makeDb();
        await expect(resolveSettlementAccount(db as any, 't1', {})).resolves.toEqual({
            paymentMethod: null,
            accountId: undefined,
        });
        expect(db.paymentMethod.findFirst).not.toHaveBeenCalled();
    });

    it('uses an explicit account only when it belongs to the tenant', async () => {
        const db = makeDb();
        db.account.findFirst.mockResolvedValueOnce({ id: 'acc-1' });
        await expect(resolveSettlementAccount(db as any, 't1', { paymentMethod: 'Bank', accountId: 'acc-1' }))
            .resolves.toEqual({ paymentMethod: 'Bank', accountId: 'acc-1' });

        db.account.findFirst.mockResolvedValueOnce(null);
        await expect(resolveSettlementAccount(db as any, 't1', { accountId: 'other-tenant' }))
            .rejects.toThrow(BadRequestException);
    });

    it('prefers the account linked to the named method', async () => {
        const db = makeDb();
        db.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acc-upay', type: 'Mobile Wallet' });
        await expect(resolveSettlementAccount(db as any, 't1', { paymentMethod: 'Upay' }))
            .resolves.toEqual({ paymentMethod: 'Upay', accountId: 'acc-upay' });
        expect(db.postingRule.findFirst).not.toHaveBeenCalled();
    });

    it('classifies an unlinked custom method by its type, not just its name', async () => {
        // "Upay" names nothing classifyPaymentMode knows, so the name alone
        // would read as cash; its configured type says it is a wallet.
        const db = makeDb();
        db.paymentMethod.findFirst.mockResolvedValue({ account_id: null, type: 'Mobile Wallet' });
        db.postingRule.findFirst.mockResolvedValue({ debit_account_id: 'acc-bank' });

        await expect(resolveSettlementAccount(db as any, 't1', { paymentMethod: 'Upay' }))
            .resolves.toEqual({ paymentMethod: 'Upay', accountId: 'acc-bank' });
        expect(db.postingRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ event_type: 'sale', condition_value: 'bank' }),
        }));
    });

    it('treats cash as the rule default', async () => {
        const db = makeDb();
        db.paymentMethod.findFirst.mockResolvedValue({ account_id: null, type: 'Cash' });
        await expect(resolveSettlementAccount(db as any, 't1', { paymentMethod: 'Cash Register' }))
            .resolves.toEqual({ paymentMethod: 'Cash Register', accountId: undefined });
        expect(db.postingRule.findFirst).not.toHaveBeenCalled();
    });
});
