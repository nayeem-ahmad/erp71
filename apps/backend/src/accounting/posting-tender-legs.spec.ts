import { Prisma } from '@prisma/client';
import { autoPostFromRules } from './posting.utils';

type Rule = { debit_account_id: string; credit_account_id: string };

/**
 * Drives autoPostFromRules with `tenderLegs` and captures the voucher details
 * it writes. The shape is posting-party.spec.ts's `buildTx`, except that
 * `postingRule.findFirst` answers per (event, condition key, condition value),
 * the way the real per-mode rules do, so a line's own mode can find its own
 * rule.
 *
 * accountPartyTypes maps account id → party_type for every account the tenant
 * owns; an id missing from it is another tenant's.
 */
function buildTx(rules: Record<string, Rule>, accountPartyTypes: Record<string, string | null>) {
    const captured: { details?: any[] } = {};

    const tx = {
        postingEvent: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'pe-1' }),
            update: jest.fn().mockResolvedValue({ id: 'pe-1' }),
        },
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
        postingRule: {
            findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
                const rule = rules[`${where.event_type}:${where.condition_key}:${where.condition_value}`];
                return rule && where.is_active === true && where.tenant_id === 'tenant-1' ? rule : null;
            }),
        },
        account: {
            findMany: jest.fn().mockImplementation(async ({ where }: any) => {
                const ids: string[] = where.id.in;
                return Object.entries(accountPartyTypes)
                    .filter(([id]) => ids.includes(id))
                    .map(([id, party_type]) => ({ id, party_type }));
            }),
        },
        voucherSequence: {
            upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'CR' }),
            update: jest.fn().mockResolvedValue({}),
        },
        accountingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        voucher: {
            create: jest.fn().mockImplementation(async ({ data }: any) => {
                captured.details = data.details.create;
                return { id: 'v-1', voucher_number: 'CR-00001', voucher_type: data.voucher_type };
            }),
        },
    } as any;

    return { tx, captured };
}

const SALE_RULES: Record<string, Rule> = {
    'sale:payment_mode:cash': { debit_account_id: 'cash-in-hand', credit_account_id: 'revenue' },
    'sale:payment_mode:bkash': { debit_account_id: 'bkash-acct', credit_account_id: 'revenue' },
    'sale:payment_mode:credit': { debit_account_id: 'ar', credit_account_id: 'revenue' },
};

const ACCOUNTS: Record<string, string | null> = {
    'cash-in-hand': null,
    'bkash-acct': null,
    'upay-acct': null,
    'bank-acct': null,
    revenue: null,
    ar: 'CUSTOMER',
    payable: 'SUPPLIER',
};

const saleInput = (tx: any, extra: Record<string, unknown>) => ({
    tx,
    tenantId: 'tenant-1',
    eventType: 'sale' as const,
    conditionKey: 'payment_mode' as const,
    conditionValue: 'cash',
    sourceModule: 'sales',
    sourceType: 'sale',
    sourceId: 'sale-1',
    amount: 1100,
    ...extra,
});

/** Details as [account, debit, credit] for readable assertions. */
const rows = (details: any[]) =>
    details.map((d) => [d.account_id, Number(d.debit_amount), Number(d.credit_amount)]);

describe('autoPostFromRules — tenderLegs', () => {
    it('writes one debit line per linked account and one revenue credit', async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            tenderLegs: {
                side: 'debit',
                lines: [
                    { accountId: 'cash-in-hand', mode: 'cash', amount: 1000 },
                    { accountId: 'upay-acct', mode: 'cash', amount: 100 },
                ],
            },
        }));

        expect(rows(captured.details!)).toEqual([
            ['cash-in-hand', 1000, 0],
            ['upay-acct', 100, 0],
            ['revenue', 0, 1100],
        ]);
        expect(tx.voucher.create).toHaveBeenCalledTimes(1);
        expect(tx.voucher.create.mock.calls[0][0].data.voucher_type).toBe('cash_receive');
    });

    it("an unlinked bkash line takes the bkash rule's account, not the first tender's", async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            tenderLegs: {
                side: 'debit',
                lines: [
                    { accountId: null, mode: 'cash', amount: 600 },
                    { mode: 'bkash', amount: 400 },
                    { mode: 'bkash', amount: 100 },
                ],
            },
        }));

        expect(rows(captured.details!)).toEqual([
            ['cash-in-hand', 600, 0],
            ['bkash-acct', 500, 0],
            ['revenue', 0, 1100],
        ]);
        expect(tx.postingRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bkash', is_active: true }),
        }));
        // Cached by mode: one lookup for the main rule, one each for cash and bkash.
        expect(tx.postingRule.findFirst).toHaveBeenCalledTimes(3);
    });

    it("an unlinked line whose mode has no rule takes the found rule's tender-side account", async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            conditionValue: 'bkash',
            amount: 300,
            tenderLegs: {
                side: 'debit',
                lines: [
                    { accountId: 'upay-acct', mode: 'cash', amount: 100 },
                    { mode: 'nagad', amount: 200 },
                ],
            },
        }));

        expect(rows(captured.details!)).toEqual([
            ['upay-acct', 100, 0],
            ['bkash-acct', 200, 0],
            ['revenue', 0, 300],
        ]);
    });

    it('merges two lines on the same account', async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            amount: 800,
            tenderLegs: {
                side: 'debit',
                lines: [
                    { accountId: 'bkash-acct', mode: 'bkash', amount: 500 },
                    { accountId: null, mode: 'bkash', amount: 300 },
                    { accountId: 'cash-in-hand', mode: 'cash', amount: 0 },
                ],
            },
        }));

        // The unlinked bkash line resolves to the account the linked one names,
        // so both land on one row; the zero cash line leaves no row at all.
        expect(rows(captured.details!)).toEqual([
            ['bkash-acct', 800, 0],
            ['revenue', 0, 800],
        ]);
        expect(tx.account.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['bkash-acct', 'revenue']);
    });

    it('fails on a sum mismatch', async () => {
        const { tx } = buildTx(SALE_RULES, ACCOUNTS);

        await expect(autoPostFromRules(saleInput(tx, {
            amount: 1100,
            tenderLegs: { side: 'debit', lines: [{ accountId: 'cash-in-hand', mode: 'cash', amount: 1000 }] },
        }))).rejects.toThrow('AUTO_POSTING_TENDER_SUM_MISMATCH');

        expect(tx.postingEvent.update).toHaveBeenLastCalledWith({
            where: { id: 'pe-1' },
            data: { status: 'failed', last_error: 'AUTO_POSTING_TENDER_SUM_MISMATCH' },
        });
        expect(tx.voucher.create).not.toHaveBeenCalled();
    });

    it('accepts float noise within half a paisa', async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            amount: 0.1 + 0.2,
            tenderLegs: {
                side: 'debit',
                lines: [
                    { accountId: 'cash-in-hand', mode: 'cash', amount: 0.1 },
                    { accountId: 'bkash-acct', mode: 'bkash', amount: 0.2 },
                ],
            },
        }));

        const details = captured.details!;
        const debit = details.reduce((s, d) => s.plus(d.debit_amount), new Prisma.Decimal(0));
        const credit = details.reduce((s, d) => s.plus(d.credit_amount), new Prisma.Decimal(0));
        expect(debit.equals(credit)).toBe(true);
        expect(debit.toString()).toBe('0.3');
    });

    it("fails when a tender account is not the tenant's, or is the opposite account", async () => {
        for (const accountId of ['foreign-acct', 'revenue']) {
            const { tx } = buildTx(SALE_RULES, ACCOUNTS);

            await expect(autoPostFromRules(saleInput(tx, {
                amount: 100,
                tenderLegs: { side: 'debit', lines: [{ accountId, mode: 'cash', amount: 100 }] },
            }))).rejects.toThrow('AUTO_POSTING_ACCOUNT_INVALID');

            expect(tx.postingEvent.update).toHaveBeenLastCalledWith({
                where: { id: 'pe-1' },
                data: { status: 'failed', last_error: 'AUTO_POSTING_ACCOUNT_INVALID' },
            });
            expect(tx.voucher.create).not.toHaveBeenCalled();
        }
    });

    it('tags the party on the control leg only', async () => {
        // A purchase paid by split tender: Dr Purchase Payable (the supplier's
        // control account) / Cr one line per tender account.
        const rules: Record<string, Rule> = {
            'purchase:payment_mode:cash': { debit_account_id: 'payable', credit_account_id: 'cash-in-hand' },
            'purchase:payment_mode:bkash': { debit_account_id: 'payable', credit_account_id: 'bkash-acct' },
        };
        const { tx, captured } = buildTx(rules, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            eventType: 'purchase',
            sourceModule: 'purchases',
            sourceType: 'purchase',
            sourceId: 'pur-1',
            amount: 1000,
            partyType: 'SUPPLIER',
            partyId: 'sup-1',
            tenderLegs: {
                side: 'credit',
                lines: [
                    { accountId: 'bank-acct', mode: 'bank', amount: 700 },
                    { mode: 'bkash', amount: 300 },
                ],
            },
        }));

        // Debit rows first, as every two-line voucher has always been written.
        expect(rows(captured.details!)).toEqual([
            ['payable', 1000, 0],
            ['bank-acct', 0, 700],
            ['bkash-acct', 0, 300],
        ]);
        const payable = captured.details!.find((d) => d.account_id === 'payable');
        expect(payable).toMatchObject({ party_type: 'SUPPLIER', party_id: 'sup-1' });
        for (const tender of captured.details!.filter((d) => d.account_id !== 'payable')) {
            expect(tender.party_type).toBeUndefined();
            expect(tender.party_id).toBeUndefined();
        }
    });

    it('skips without a rule, or without an amount, before any tender work', async () => {
        const noRule = buildTx({}, ACCOUNTS);
        await expect(autoPostFromRules(saleInput(noRule.tx, {
            tenderLegs: { side: 'debit', lines: [{ accountId: 'cash-in-hand', mode: 'cash', amount: 5 }] },
        }))).resolves.toEqual({ postingStatus: 'skipped' });
        expect(noRule.tx.account.findMany).not.toHaveBeenCalled();

        const zero = buildTx(SALE_RULES, ACCOUNTS);
        await expect(autoPostFromRules(saleInput(zero.tx, {
            amount: 0,
            tenderLegs: { side: 'debit', lines: [{ accountId: 'cash-in-hand', mode: 'cash', amount: 5 }] },
        }))).resolves.toEqual({ postingStatus: 'skipped' });
        expect(zero.tx.postingRule.findFirst).toHaveBeenCalledTimes(1);
        expect(zero.tx.account.findMany).not.toHaveBeenCalled();
    });

    it('does not consult the override inputs', async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, {
            amount: 100,
            overrideDebitAccountId: 'upay-acct',
            overrideCreditAccountId: 'ar',
            tenderLegs: { side: 'debit', lines: [{ accountId: 'bank-acct', mode: 'bank', amount: 100 }] },
        }));

        expect(rows(captured.details!)).toEqual([
            ['bank-acct', 100, 0],
            ['revenue', 0, 100],
        ]);
    });

    it('without tenderLegs the voucher is unchanged', async () => {
        const { tx, captured } = buildTx(SALE_RULES, ACCOUNTS);

        await autoPostFromRules(saleInput(tx, { conditionValue: 'bkash', amount: 500 }));

        expect(captured.details).toEqual([
            {
                account_id: 'bkash-acct',
                debit_amount: new Prisma.Decimal(500),
                credit_amount: new Prisma.Decimal(0),
            },
            {
                account_id: 'revenue',
                debit_amount: new Prisma.Decimal(0),
                credit_amount: new Prisma.Decimal(500),
            },
        ]);
        expect(tx.postingRule.findFirst).toHaveBeenCalledTimes(1);
        expect(tx.account.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 'tenant-1',
            id: { in: ['bkash-acct', 'revenue'] },
        });
    });
});
