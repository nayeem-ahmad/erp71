import { DEFAULT_PAYMENT_METHODS, linkDefaultPaymentMethodAccounts } from '@erp71/database';

describe('default payment methods', () => {
    const buildTx = (methods: any[], accounts: any[]) => ({
        paymentMethod: {
            findMany: jest.fn().mockResolvedValue(methods),
            update: jest.fn().mockResolvedValue({}),
        },
        account: { findMany: jest.fn().mockResolvedValue(accounts) },
    });

    it('lists defaults in the order Cash, Bank, bKash, Nagad, Card', () => {
        expect(DEFAULT_PAYMENT_METHODS.map((m) => m.name)).toEqual(['Cash', 'Bank', 'bKash', 'Nagad', 'Card']);
        expect(DEFAULT_PAYMENT_METHODS.map((m) => m.sort_order)).toEqual([1, 2, 3, 4, 5]);
    });

    it('names the account each default posts to', () => {
        expect(DEFAULT_PAYMENT_METHODS.map((m) => [m.name, m.link_to])).toEqual([
            ['Cash', 'Cash in Hand'],
            ['Bank', 'Main Bank Account'],
            ['bKash', 'bKash Account'],
            ['Nagad', 'Nagad Account'],
            ['Card', 'Main Bank Account'],
        ]);
    });

    it('links each unlinked default method to the account of that exact name', async () => {
        const tx = buildTx(
            [
                { id: 'pm-cash', name: 'Cash', account_id: null },
                { id: 'pm-bk', name: 'bKash', account_id: null },
            ],
            [
                { id: 'a-cash', name: 'Cash in Hand' },
                { id: 'a-bk', name: 'bKash Account' },
            ],
        );

        await expect(linkDefaultPaymentMethodAccounts(tx, 't1')).resolves.toEqual({ linked: ['Cash', 'bKash'] });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-cash' }, data: { account_id: 'a-cash' } });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-bk' }, data: { account_id: 'a-bk' } });
    });

    it('links Bank and Card to the same Main Bank Account', async () => {
        const tx = buildTx(
            [
                { id: 'pm-bank', name: 'Bank', account_id: null },
                { id: 'pm-card', name: 'Card', account_id: null },
            ],
            [{ id: 'a-bank', name: 'Main Bank Account' }],
        );

        await expect(linkDefaultPaymentMethodAccounts(tx, 't1')).resolves.toEqual({ linked: ['Bank', 'Card'] });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-bank' }, data: { account_id: 'a-bank' } });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-card' }, data: { account_id: 'a-bank' } });
    });

    it('reads only this tenant\'s unlinked, default-named methods', async () => {
        const tx = buildTx([], []);

        await expect(linkDefaultPaymentMethodAccounts(tx, 't1')).resolves.toEqual({ linked: [] });

        const where = tx.paymentMethod.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenant_id: 't1', account_id: null });
        expect(where.name.in).toEqual(['Cash', 'Bank', 'bKash', 'Nagad', 'Card']);
        expect(tx.account.findMany).not.toHaveBeenCalled();
    });

    it('limits the Cash method to the first store and leaves Bank on every branch', async () => {
        const tx = {
            paymentMethod: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'pm-cash', name: 'Cash', account_id: null },
                    { id: 'pm-bank', name: 'Bank', account_id: null },
                ]),
                update: jest.fn().mockResolvedValue({}),
            },
            paymentMethodStore: {
                create: jest.fn().mockResolvedValue({}),
            },
            account: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'a-cash', name: 'Cash in Hand', store_id: 's1' },
                    { id: 'a-bank', name: 'Main Bank Account', store_id: null },
                ]),
            },
            store: {
                findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'Babu Bazar' }),
            },
        };

        await linkDefaultPaymentMethodAccounts(tx, 't1');

        expect(tx.paymentMethod.update).toHaveBeenCalledWith({
            where: { id: 'pm-cash' },
            data: { account_id: 'a-cash', all_branches: false },
        });
        expect(tx.paymentMethodStore.create).toHaveBeenCalledWith({
            data: { tenant_id: 't1', payment_method_id: 'pm-cash', store_id: 's1' },
        });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({
            where: { id: 'pm-bank' },
            data: { account_id: 'a-bank' },
        });
    });

    it('never overwrites an existing link and skips names with no matching account', async () => {
        // The query asks for account_id: null, so a linked method is never returned.
        const tx = buildTx(
            [
                { id: 'pm-nagad', name: 'Nagad', account_id: null },
                { id: 'pm-cash', name: 'Cash', account_id: null },
            ],
            [{ id: 'a-cash', name: 'Cash in Hand' }],
        );

        await expect(linkDefaultPaymentMethodAccounts(tx, 't1')).resolves.toEqual({ linked: ['Cash'] });
        expect(tx.paymentMethod.update).toHaveBeenCalledTimes(1);
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-cash' }, data: { account_id: 'a-cash' } });
        expect(tx.paymentMethod.findMany.mock.calls[0][0].where.account_id).toBeNull();
    });
});
