import { resolveMoneyAccount, manualDrawerProblem } from './cash-account';

const press = '501fed1b-9732-44fa-98b1-271fae2bc135';
const babu = '5998f11f-70ff-4eec-a1c8-c42418cd461b';
const lt = '9df1d62c-b797-4111-9ffc-17a22862c4f0';
const cf = 'f5a45408-79b0-4b70-b3af-bc2fe806085d';
const premier = '110102';

describe('resolveMoneyAccount', () => {
    it('posts Press Club cash to the Press Club drawer', () => {
        expect(resolveMoneyAccount({
            mode: 'cash',
            storeId: press,
            tenderAccount: null,
            branchDrawer: { id: lt, storeId: press },
            sharedAccountId: null,
        })).toEqual({ accountId: lt });
    });

    it('refuses the Babu Bazar drawer on a Press Club voucher', () => {
        expect(resolveMoneyAccount({
            mode: 'cash',
            storeId: press,
            tenderAccount: { id: cf, storeId: babu, category: 'cash', name: 'Main Cash (CF)' },
            branchDrawer: { id: lt, storeId: press },
            sharedAccountId: null,
        })).toEqual({ error: 'DRAWER_BRANCH_MISMATCH' });
    });

    it('keeps a Premier Bank tender on a Press Club voucher', () => {
        expect(resolveMoneyAccount({
            mode: 'bank',
            storeId: press,
            tenderAccount: { id: premier, storeId: null, category: 'bank', name: 'Premier Bank 186' },
            branchDrawer: null,
            sharedAccountId: null,
        })).toEqual({ accountId: premier });
    });

    it('refuses cash when the voucher has no branch', () => {
        expect(resolveMoneyAccount({
            mode: 'cash',
            storeId: null,
            tenderAccount: null,
            branchDrawer: { id: lt, storeId: press },
            sharedAccountId: null,
        })).toEqual({ error: 'NO_BRANCH' });
    });
});

describe('manualDrawerProblem', () => {
    it('rejects a drawer line for another branch and allows a bank line', () => {
        const drawer = { id: lt, name: 'Main Cash (LT)', category: 'cash', store_id: press };
        const bank = { id: premier, name: 'Premier Bank 186', category: 'bank', store_id: null };

        expect(manualDrawerProblem(babu, drawer)).toBe('DRAWER_BRANCH_MISMATCH');
        expect(manualDrawerProblem(null, drawer)).toBe('NO_BRANCH');
        expect(manualDrawerProblem(press, drawer)).toBeNull();
        expect(manualDrawerProblem(babu, bank)).toBeNull();
    });
});
