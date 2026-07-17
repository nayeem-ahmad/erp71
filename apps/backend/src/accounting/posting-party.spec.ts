import { autoPostFromRules } from './posting.utils';

/**
 * Drives autoPostFromRules through a full posting and captures the voucher
 * details it creates, to prove the party dimension tags the RIGHT leg and only
 * that leg.
 *
 * accountPartyTypes maps account id → party_type, standing in for
 * Account.party_type. The rule debits 'ar' (a control account) and credits
 * 'revenue' (not).
 */
function buildTx(accountPartyTypes: Record<string, string | null>) {
    const captured: { details?: any[] } = {};

    const tx = {
        postingEvent: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'pe-1' }),
            update: jest.fn().mockResolvedValue({ id: 'pe-1' }),
        },
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
        postingRule: {
            findFirst: jest.fn().mockResolvedValue({
                debit_account_id: 'ar',
                credit_account_id: 'revenue',
            }),
        },
        account: {
            findMany: jest.fn().mockResolvedValue(
                Object.entries(accountPartyTypes).map(([id, party_type]) => ({ id, party_type })),
            ),
        },
        voucherSequence: {
            upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'CR' }),
            update: jest.fn().mockResolvedValue({}),
        },
        voucher: {
            create: jest.fn().mockImplementation(async ({ data }: any) => {
                captured.details = data.details.create;
                return { id: 'v-1', voucher_number: 'CR-00001', voucher_type: data.voucher_type };
            }),
        },
    } as any;

    return { tx, captured };
}

const baseInput = (tx: any, extra: Record<string, unknown>) => ({
    tx,
    tenantId: 'tenant-1',
    eventType: 'sale' as const,
    conditionKey: 'payment_mode' as const,
    conditionValue: 'credit',
    sourceModule: 'sales',
    sourceType: 'sale',
    sourceId: 'sale-1',
    amount: 500,
    ...extra,
});

describe('autoPostFromRules — party dimension', () => {
    it('tags the control-account leg with the party, and leaves the other leg untagged', async () => {
        const { tx, captured } = buildTx({ ar: 'CUSTOMER', revenue: null });

        await autoPostFromRules(baseInput(tx, { partyType: 'CUSTOMER', partyId: 'cust-1' }));

        const arLine = captured.details!.find((d) => d.account_id === 'ar');
        const revenueLine = captured.details!.find((d) => d.account_id === 'revenue');

        expect(arLine.party_type).toBe('CUSTOMER');
        expect(arLine.party_id).toBe('cust-1');
        expect(revenueLine.party_type).toBeUndefined();
        expect(revenueLine.party_id).toBeUndefined();
    });

    it('does not tag when no party is passed', async () => {
        const { tx, captured } = buildTx({ ar: 'CUSTOMER', revenue: null });

        await autoPostFromRules(baseInput(tx, {}));

        expect(captured.details!.every((d) => d.party_id === undefined)).toBe(true);
    });

    it('does not tag when the party TYPE does not match the control account', async () => {
        // A supplier id must never land on the customer receivable, even by mistake
        // — that would corrupt both parties' subsidiary ledgers.
        const { tx, captured } = buildTx({ ar: 'CUSTOMER', revenue: null });

        await autoPostFromRules(baseInput(tx, { partyType: 'SUPPLIER', partyId: 'sup-1' }));

        expect(captured.details!.every((d) => d.party_id === undefined)).toBe(true);
    });

    it('does not tag when partyType is given but partyId is missing', async () => {
        const { tx, captured } = buildTx({ ar: 'CUSTOMER', revenue: null });

        await autoPostFromRules(baseInput(tx, { partyType: 'CUSTOMER' }));

        expect(captured.details!.every((d) => d.party_id === undefined)).toBe(true);
    });

    it('tags the credit leg when the control account is on the credit side', async () => {
        // e.g. a purchase: Dr Purchases / Cr Purchase Payable. The payable is the
        // control account and it is the credit leg.
        const { tx, captured } = buildTx({ ar: null, revenue: 'SUPPLIER' });

        await autoPostFromRules(baseInput(tx, { partyType: 'SUPPLIER', partyId: 'sup-1' }));

        const debitLine = captured.details!.find((d) => d.account_id === 'ar');
        const creditLine = captured.details!.find((d) => d.account_id === 'revenue');

        expect(creditLine.party_id).toBe('sup-1');
        expect(debitLine.party_id).toBeUndefined();
    });
});
