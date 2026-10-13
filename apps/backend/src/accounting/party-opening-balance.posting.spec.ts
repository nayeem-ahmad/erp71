import { OPENING_BALANCE_EQUITY_ACCOUNT, postPartyOpeningBalance } from './party-opening-balance.posting';

const postMultiLeg: jest.Mock = jest.fn(async () => ({ postingStatus: 'posted', voucherId: 'v-1' }));

jest.mock('./posting.utils', () => ({
    postMultiLeg: (...args: any[]) => postMultiLeg(...args),
}));

const AS_OF = new Date('2025-01-01T00:00:00.000Z');

/** A chart with both control accounts and the opening-balance equity account. */
function makeTx(accounts: Record<string, string | null> = {}) {
    const chart: Record<string, string | null> = {
        CUSTOMER: 'acct-ar',
        SUPPLIER: 'acct-ap',
        [OPENING_BALANCE_EQUITY_ACCOUNT]: 'acct-obe',
        ...accounts,
    };
    return {
        account: {
            findFirst: jest.fn(async ({ where }: any) => {
                const id = chart[where.party_type ?? where.name];
                return id ? { id } : null;
            }),
        },
    } as any;
}

const base = {
    tenantId: 't1',
    partyId: 'party-1',
    date: AS_OF,
    sourceModule: 'external-sync',
    sourceId: 'credit-row-1',
    storeId: 'store-1',
    description: 'Opening balance imported from EXPRESS_RETAIL_PRO',
};

function legsOf(call = 0) {
    return postMultiLeg.mock.calls[call][0].legs;
}

beforeEach(() => postMultiLeg.mockClear());

describe('postPartyOpeningBalance', () => {
    it('debits the customer on receivables against opening-balance equity for what they owed', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'CUSTOMER', amount: 8685 });

        expect(legsOf()).toEqual([
            { accountId: 'acct-ar', debit: 8685, partyType: 'CUSTOMER', partyId: 'party-1' },
            { accountId: 'acct-obe', credit: 8685 },
        ]);
    });

    it('credits receivables for a customer who opened in advance', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'CUSTOMER', amount: -250.5 });

        expect(legsOf()).toEqual([
            { accountId: 'acct-ar', credit: 250.5, partyType: 'CUSTOMER', partyId: 'party-1' },
            { accountId: 'acct-obe', debit: 250.5 },
        ]);
    });

    it('credits the supplier on payables for what the shop owed them', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'SUPPLIER', amount: 548425 });

        expect(legsOf()).toEqual([
            { accountId: 'acct-ap', credit: 548425, partyType: 'SUPPLIER', partyId: 'party-1' },
            { accountId: 'acct-obe', debit: 548425 },
        ]);
    });

    it('debits payables for a supplier the shop had paid in advance', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'SUPPLIER', amount: -100 });

        expect(legsOf()).toEqual([
            { accountId: 'acct-ap', debit: 100, partyType: 'SUPPLIER', partyId: 'party-1' },
            { accountId: 'acct-obe', credit: 100 },
        ]);
    });

    it('posts one journal keyed on the ledger row, dated at the opening', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'CUSTOMER', amount: 10 });

        expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
            tx,
            tenantId: 't1',
            eventType: 'party_opening_balance',
            sourceModule: 'external-sync',
            sourceType: 'customer_opening_balance',
            sourceId: 'credit-row-1',
            date: AS_OF,
            storeId: 'store-1',
            description: base.description,
        }));
    });

    it('names the supplier source type for a supplier opening', async () => {
        const tx = makeTx();
        await postPartyOpeningBalance({ tx, ...base, party: 'SUPPLIER', amount: 10 });

        expect(postMultiLeg.mock.calls[0][0].sourceType).toBe('supplier_opening_balance');
    });

    it('posts nothing for a zero opening', async () => {
        const result = await postPartyOpeningBalance({ tx: makeTx(), ...base, party: 'CUSTOMER', amount: 0.004 });

        expect(result.postingStatus).toBe('skipped');
        expect(postMultiLeg).not.toHaveBeenCalled();
    });

    it('posts nothing when the workspace has no control account for the party', async () => {
        const result = await postPartyOpeningBalance({
            tx: makeTx({ CUSTOMER: null }), ...base, party: 'CUSTOMER', amount: 500,
        });

        expect(result.postingStatus).toBe('skipped');
        expect(postMultiLeg).not.toHaveBeenCalled();
    });

    it('refuses rather than posting half an entry when the equity account is missing', async () => {
        await expect(postPartyOpeningBalance({
            tx: makeTx({ [OPENING_BALANCE_EQUITY_ACCOUNT]: null }), ...base, party: 'CUSTOMER', amount: 500,
        })).rejects.toThrow(/Opening Balance Equity/);
        expect(postMultiLeg).not.toHaveBeenCalled();
    });
});

describe('the Opening Balance Equity account', () => {
    it('is provisioned by the default chart, as equity under Capital', () => {
        // The posting refuses without it, so a tenant the template does not
        // reach would fail every import that carries an opening due.
        const { DEFAULT_ACCOUNTING_TEMPLATE } = jest.requireActual('@erp71/database');
        const placed = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group: any) =>
            group.subgroups.flatMap((subgroup: any) =>
                subgroup.accounts.map((account: any) => ({ ...account, group: group.name, subgroup: subgroup.name })),
            ),
        ).find((account: any) => account.name === OPENING_BALANCE_EQUITY_ACCOUNT);

        expect(placed).toMatchObject({ group: 'Owner Equity', subgroup: 'Capital', type: 'equity', code: '310102' });
        expect(placed.party_type).toBeUndefined();
    });
});
