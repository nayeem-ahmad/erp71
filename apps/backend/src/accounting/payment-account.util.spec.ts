import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    allocateTenders,
    cashLegOverride,
    resolveCreditPaymentMethod,
    resolveTenders,
    ResolvedTender,
    sameTenders,
    storedPaymentMethodAccountId,
    storedToTenderInputs,
    StoredTender,
} from './payment-account.util';
import { availableAt } from '../payment-methods/payment-method-branches';

const BRANCH_REFUSAL = "That payment method isn't available at this branch.";
const MISSING = 'That payment method does not exist or is switched off.';

interface MethodRow {
    id: string;
    tenant_id: string;
    name: string;
    account_id: string | null;
    is_active: boolean;
    all_branches: boolean;
    stores: { store_id: string }[];
    sort_order: number;
    type: string;
}

const method = (row: Partial<MethodRow> & Pick<MethodRow, 'id' | 'name'>): MethodRow => ({
    tenant_id: 't1',
    account_id: null,
    is_active: true,
    all_branches: true,
    stores: [],
    sort_order: 0,
    type: 'Mobile Wallet',
    ...row,
});

/**
 * A paymentMethod.findMany that answers the way Postgres would for the
 * filters the resolver uses: tenant, `id: { in }`, `is_active`, and an OR of
 * case-insensitive name matches and exact `type` matches. Anything else in `where` fails the test, so
 * a change of query shape is noticed rather than silently matching all rows.
 */
function methodsDb(rows: MethodRow[]) {
    const findMany = jest.fn().mockImplementation(async ({ where, orderBy }: any) => {
        const known = new Set(['tenant_id', 'id', 'is_active', 'OR']);
        for (const key of Object.keys(where)) {
            if (!known.has(key)) throw new Error(`unexpected filter ${key}`);
        }
        const matched = rows.filter((row) => {
            if (row.tenant_id !== where.tenant_id) return false;
            if (where.id?.in && !where.id.in.includes(row.id)) return false;
            if (where.is_active !== undefined && row.is_active !== where.is_active) return false;
            if (where.OR && !where.OR.some((c: any) => (c.name
                ? c.name.mode === 'insensitive' && c.name.equals.toLowerCase() === row.name.toLowerCase()
                : c.type === row.type))) return false;
            return true;
        });
        return orderBy ? [...matched].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) : matched;
    });
    return { paymentMethod: { findMany, findFirst: jest.fn() } };
}

const resolved = (row: Partial<ResolvedTender> & Pick<ResolvedTender, 'amount'>): ResolvedTender => ({
    paymentMethod: 'CASH',
    methodId: null,
    methodName: null,
    accountId: null,
    mode: 'cash',
    ...row,
});

describe('payment-account.util', () => {
    const db = () => ({ paymentMethod: { findFirst: jest.fn() } });

    describe('resolveCreditPaymentMethod()', () => {
        it('returns the tenant\'s method available at the party\'s branch, with its account', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' });

            await expect(resolveCreditPaymentMethod(client as any, 't1', 'pm-bkash', 'store-1'))
                .resolves.toEqual({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' });
            expect(client.paymentMethod.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pm-bkash', tenant_id: 't1', ...availableAt(['store-1']) },
            }));
        });

        it('refuses an unknown, foreign or switched-off method', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue(null);

            await expect(resolveCreditPaymentMethod(client as any, 't1', 'pm-other', 'store-1'))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a method not available at the party\'s branch', async () => {
            const client = db();
            client.paymentMethod.findFirst.mockResolvedValue(null);

            await expect(resolveCreditPaymentMethod(client as any, 't1', 'pm-dhaka-only', 'store-2'))
                .rejects.toThrow(BRANCH_REFUSAL);
            expect(client.paymentMethod.findFirst.mock.calls[0][0].where).toEqual({
                id: 'pm-dhaka-only', tenant_id: 't1',
                is_active: true,
                OR: [{ all_branches: true }, { stores: { some: { store_id: { in: ['store-2'] } } } }],
            });
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

    describe('resolveTenders()', () => {
        it('resolves an id to its name and linked account', async () => {
            const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' })]);

            await expect(resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
            ])).resolves.toEqual([{
                paymentMethod: 'Mobile Wallet',
                methodId: 'pm-bkash',
                methodName: 'bKash',
                accountId: 'acc-bkash',
                mode: 'bkash',
                amount: 200,
            }]);
            expect(client.paymentMethod.findMany.mock.calls[0][0].where.tenant_id).toBe('t1');
        });

        it('refuses a foreign id', async () => {
            const client = methodsDb([method({ id: 'pm-x', name: 'bKash', tenant_id: 't2' })]);

            const attempt = resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'BKASH', paymentMethodId: 'pm-x', amount: 100 },
            ]);
            await expect(attempt).rejects.toThrow(BadRequestException);
            await expect(attempt).rejects.toThrow(MISSING);
        });

        it('refuses a new tender on a method not available at the branch', async () => {
            const client = methodsDb([method({
                id: 'pm-nagad-s2', name: 'Nagad Banani', all_branches: false, stores: [{ store_id: 's2' }],
            })]);

            const attempt = resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'NAGAD', paymentMethodId: 'pm-nagad-s2', amount: 100 },
            ]);
            await expect(attempt).rejects.toThrow(BadRequestException);
            await expect(attempt).rejects.toThrow(new BadRequestException(BRANCH_REFUSAL));
        });

        it('refuses a new tender on a switched-off method', async () => {
            const client = methodsDb([method({ id: 'pm-old', name: 'Old Wallet', is_active: false })]);

            const attempt = resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-old', amount: 100 },
            ]);
            await expect(attempt).rejects.toThrow(BadRequestException);
            await expect(attempt).rejects.toThrow(BRANCH_REFUSAL);
        });

        it('accepts a stored tender whose method moved branch or was switched off', async () => {
            const client = methodsDb([
                method({ id: 'pm-moved', name: 'bKash Gulshan', account_id: 'acc-bkash-g', all_branches: false, stores: [{ store_id: 's2' }] }),
                method({ id: 'pm-off', name: 'Upay', account_id: 'acc-upay', is_active: false }),
            ]);
            const stored: StoredTender[] = [
                { payment_method: 'Mobile Wallet', payment_method_id: 'pm-moved', payment_method_name: 'bKash Gulshan', account_id: 'acc-bkash-g', amount: new Prisma.Decimal(300) },
                { payment_method: 'Mobile Wallet', payment_method_id: 'pm-off', payment_method_name: 'Upay', account_id: 'acc-upay', amount: new Prisma.Decimal(50) },
            ];

            const tenders = await resolveTenders(client as any, 't1', 's1', storedToTenderInputs(stored), stored);

            expect(tenders.map((t) => [t.methodId, t.accountId, t.amount])).toEqual([
                ['pm-moved', 'acc-bkash-g', 300],
                ['pm-off', 'acc-upay', 50],
            ]);
        });

        describe('a stored tender posts as it was saved', () => {
            const storedRow = (row: Partial<StoredTender> & Pick<StoredTender, 'payment_method_id'>): StoredTender => ({
                payment_method: 'Mobile Wallet',
                payment_method_name: 'bKash',
                account_id: 'acc-wallet-a',
                amount: new Prisma.Decimal(200),
                ...row,
            });

            it('a stored tender keeps the account it was posted with after the method is relinked', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-wallet-b' })]);
                const stored = [storedRow({ payment_method_id: 'pm-bkash', account_id: 'acc-wallet-a' })];

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], stored);

                expect(tender).toMatchObject({ methodId: 'pm-bkash', accountId: 'acc-wallet-a' });
            });

            it('a stored tender keeps its saved name after the method is renamed', async () => {
                // "Wallet One" would classify as bank; the saved "bKash" keeps it bkash.
                const client = methodsDb([method({ id: 'pm-bkash', name: 'Wallet One', account_id: 'acc-wallet-a' })]);

                const [kept] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], [storedRow({ payment_method_id: 'pm-bkash', payment_method_name: 'bKash' })]);
                expect(kept).toMatchObject({ methodName: 'bKash', mode: 'bkash' });

                // A row saved before names were stored falls back to the method's name.
                const [legacy] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], [storedRow({ payment_method_id: 'pm-bkash', payment_method_name: null })]);
                expect(legacy).toMatchObject({ methodName: 'Wallet One', mode: 'bank' });
            });

            it('a stored tender whose account was deleted (account_id null) resolves to no account', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-new' })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], [storedRow({ payment_method_id: 'pm-bkash', account_id: null })]);

                expect(tender).toMatchObject({ methodId: 'pm-bkash', accountId: null, mode: 'bkash' });
            });

            it('a new tender on the same method (not in stored) uses the current link', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash Merchant', account_id: 'acc-wallet-b' })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], [storedRow({ payment_method_id: 'pm-other', payment_method_name: 'bKash', account_id: 'acc-wallet-a' })]);

                expect(tender).toMatchObject({ methodName: 'bKash Merchant', accountId: 'acc-wallet-b' });
            });

            it('several stored rows on one method answer with the first', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-wallet-c' })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 200 },
                ], [
                    storedRow({ payment_method_id: 'pm-bkash', account_id: 'acc-wallet-a' }),
                    storedRow({ payment_method_id: 'pm-bkash', account_id: 'acc-wallet-b' }),
                ]);

                expect(tender.accountId).toBe('acc-wallet-a');
            });

            it('round-trips stored rows through storedToTenderInputs with their saved account and name', async () => {
                const client = methodsDb([
                    method({ id: 'pm-bkash', name: 'Wallet One', account_id: 'acc-wallet-b' }),
                    method({ id: 'pm-cash', name: 'Cash', account_id: 'acc-cash-new', all_branches: false, stores: [{ store_id: 's2' }] }),
                ]);
                const rows: StoredTender[] = [
                    { payment_method: 'CASH', payment_method_id: 'pm-cash', payment_method_name: 'Cash Counter', account_id: 'acc-cash', amount: new Prisma.Decimal(1000) },
                    { payment_method: 'Mobile Wallet', payment_method_id: 'pm-bkash', payment_method_name: 'bKash', account_id: 'acc-wallet-a', amount: new Prisma.Decimal(100) },
                ];

                const tenders = await resolveTenders(client as any, 't1', 's1', storedToTenderInputs(rows), rows);

                expect(tenders).toEqual([
                    { paymentMethod: 'CASH', methodId: 'pm-cash', methodName: 'Cash Counter', accountId: 'acc-cash', mode: 'cash', amount: 1000 },
                    { paymentMethod: 'Mobile Wallet', methodId: 'pm-bkash', methodName: 'bKash', accountId: 'acc-wallet-a', mode: 'bkash', amount: 100 },
                ]);
            });
        });

        describe('a legacy stored row (no method id) keeps the method it names editable', () => {
            const legacyRow = (row: Partial<StoredTender> & Pick<StoredTender, 'payment_method'>): StoredTender => ({
                payment_method_id: null,
                payment_method_name: null,
                account_id: 'acc-old',
                amount: new Prisma.Decimal(100),
                ...row,
            });
            const limited = { all_branches: false, stores: [{ store_id: 's2' }] };

            it('a legacy stored row (no method id) exempts the method it names from the branch check', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash', ...limited })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 100 },
                ], [legacyRow({ payment_method: 'bKash' })]);

                // The method's current link, not the client-sent legacy account.
                expect(tender).toMatchObject({ methodId: 'pm-bkash', methodName: 'bKash', accountId: 'acc-bkash', mode: 'bkash' });
            });

            it("a legacy POS row 'BKASH' exempts the bKash method", async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash', ...limited })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'BKASH', paymentMethodId: 'pm-bkash', amount: 100 },
                ], [legacyRow({ payment_method: 'BKASH' })]);

                expect(tender).toMatchObject({ methodId: 'pm-bkash', accountId: 'acc-bkash' });
            });

            it("a legacy POS row 'NAGAD' exempts the Nagad method", async () => {
                const client = methodsDb([method({ id: 'pm-nagad', name: 'Nagad', account_id: 'acc-nagad', ...limited })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'NAGAD', paymentMethodId: 'pm-nagad', amount: 100 },
                ], [legacyRow({ payment_method: 'NAGAD' })]);

                expect(tender).toMatchObject({ methodId: 'pm-nagad', accountId: 'acc-nagad' });
            });

            it("a legacy POS row 'CASH' exempts the lowest-sorted method of type Cash", async () => {
                const client = methodsDb([
                    method({ id: 'pm-till-2', name: 'Till 2', type: 'Cash', sort_order: 2, account_id: 'acc-till-2', ...limited }),
                    method({ id: 'pm-till-1', name: 'Till 1', type: 'Cash', sort_order: 1, account_id: 'acc-till-1', ...limited }),
                ]);
                const stored = [legacyRow({ payment_method: 'CASH' })];

                const [first] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'CASH', paymentMethodId: 'pm-till-1', amount: 100 },
                ], stored);
                expect(first).toMatchObject({ methodId: 'pm-till-1', accountId: 'acc-till-1' });

                // The legacy row answers for the lowest-sorted Cash method only.
                await expect(resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'CASH', paymentMethodId: 'pm-till-2', amount: 100 },
                ], stored)).rejects.toThrow(BRANCH_REFUSAL);
            });

            it('a legacy row keeps its saved name, and the match ignores case', async () => {
                const client = methodsDb([method({ id: 'pm-wallet', name: 'Wallet One', account_id: 'acc-w', ...limited })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-wallet', amount: 100 },
                ], [legacyRow({ payment_method: 'Mobile Wallet', payment_method_name: 'WALLET one' })]);

                expect(tender).toMatchObject({ methodId: 'pm-wallet', methodName: 'WALLET one', accountId: 'acc-w' });
            });

            it('a legacy row naming a switched-off method still exempts it', async () => {
                const client = methodsDb([method({ id: 'pm-upay', name: 'Upay', account_id: 'acc-upay', is_active: false })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-upay', amount: 100 },
                ], [legacyRow({ payment_method: 'Mobile Wallet', payment_method_name: 'Upay' })]);

                expect(tender).toMatchObject({ methodId: 'pm-upay', accountId: 'acc-upay' });
            });

            it('a legacy row that matches no method exempts nothing', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash', ...limited })]);

                const attempt = resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 100 },
                ], [legacyRow({ payment_method: 'Rocket' })]);

                await expect(attempt).rejects.toThrow(new BadRequestException(BRANCH_REFUSAL));
            });

            it('a row with a method id keeps its stored account even beside a legacy row for the same method', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-new', ...limited })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 100 },
                ], [
                    legacyRow({ payment_method: 'bKash' }),
                    legacyRow({ payment_method: 'Mobile Wallet', payment_method_id: 'pm-bkash', payment_method_name: 'bKash', account_id: 'acc-saved' }),
                ]);

                expect(tender).toMatchObject({ accountId: 'acc-saved' });
            });

            it('no extra query when no stored row is legacy', async () => {
                const client = methodsDb([method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' })]);

                await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 100 },
                ], [{
                    payment_method: 'Mobile Wallet', payment_method_id: 'pm-bkash', payment_method_name: 'bKash',
                    account_id: 'acc-bkash', amount: new Prisma.Decimal(100),
                }]);

                expect(client.paymentMethod.findMany).toHaveBeenCalledTimes(1);
            });

            it('looks every legacy name up in one extra query', async () => {
                const client = methodsDb([
                    method({ id: 'pm-bkash', name: 'bKash', ...limited }),
                    method({ id: 'pm-nagad', name: 'Nagad', ...limited }),
                    method({ id: 'pm-till', name: 'Till', type: 'Cash', ...limited }),
                ]);

                await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'BKASH', paymentMethodId: 'pm-bkash', amount: 1 },
                    { paymentMethod: 'NAGAD', paymentMethodId: 'pm-nagad', amount: 1 },
                    { paymentMethod: 'CASH', paymentMethodId: 'pm-till', amount: 1 },
                ], [
                    legacyRow({ payment_method: 'BKASH' }),
                    legacyRow({ payment_method: 'NAGAD' }),
                    legacyRow({ payment_method: 'CASH' }),
                ]);

                expect(client.paymentMethod.findMany).toHaveBeenCalledTimes(2);
            });
        });

        it("matches POS's BKASH by name at the branch before tenant-wide", async () => {
            // Names are unique per tenant only case-sensitively, so "BKASH" (an
            // exact match, but limited to another branch) can sit beside "bKash".
            const rows = [
                method({ id: 'pm-upper', name: 'BKASH', account_id: 'acc-upper', all_branches: false, stores: [{ store_id: 's2' }] }),
                method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash', all_branches: false, stores: [{ store_id: 's1' }] }),
            ];

            const [atBranch] = await resolveTenders(methodsDb(rows) as any, 't1', 's1', [{ paymentMethod: 'BKASH', amount: 100 }]);
            expect(atBranch).toMatchObject({ paymentMethod: 'BKASH', methodId: 'pm-bkash', accountId: 'acc-bkash', mode: 'bkash' });

            // Nothing by that name at s3: today's tenant-wide exact-name match.
            const [tenantWide] = await resolveTenders(methodsDb(rows) as any, 't1', 's3', [{ paymentMethod: 'BKASH', amount: 100 }]);
            expect(tenantWide).toMatchObject({ methodId: 'pm-upper', accountId: 'acc-upper' });

            // The tenant-wide fallback is exact-name only, as resolvePaymentMethodAccountId was.
            const [none] = await resolveTenders(methodsDb(rows) as any, 't1', 's3', [{ paymentMethod: 'Bkash', amount: 100 }]);
            expect(none).toMatchObject({ methodId: null, accountId: null, mode: 'bkash' });
        });

        it('prefers the exact name when two methods at the branch differ only in case', async () => {
            const client = methodsDb([
                method({ id: 'pm-lower', name: 'bkash', sort_order: 0 }),
                method({ id: 'pm-exact', name: 'bKash', sort_order: 1 }),
            ]);

            const [tender] = await resolveTenders(client as any, 't1', 's1', [{ paymentMethod: 'bKash', amount: 10 }]);
            expect(tender.methodId).toBe('pm-exact');
        });

        it('leaves account null for an unknown name; mode comes from the name', async () => {
            const client = methodsDb([]);

            await expect(resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'Upay', amount: 50 },
                { paymentMethod: 'bKash', amount: 20 },
            ])).resolves.toEqual([
                { paymentMethod: 'Upay', methodId: null, methodName: null, accountId: null, mode: 'cash', amount: 50 },
                { paymentMethod: 'bKash', methodId: null, methodName: null, accountId: null, mode: 'bkash', amount: 20 },
            ]);
        });

        describe("an unlinked method's mode comes from its type, unless its name says bKash or Nagad", () => {
            // No account on any of these, so the mode alone decides where each posts.
            const modeOf = async (row: Partial<MethodRow> & Pick<MethodRow, 'id' | 'name'>, paymentMethod: string) => {
                const client = methodsDb([method(row)]);
                const [tender] = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod, paymentMethodId: row.id, amount: 100 },
                ]);
                return tender.mode;
            };

            it('an unlinked Bank method "DBBL" posts as bank', async () => {
                await expect(modeOf({ id: 'pm-dbbl', name: 'DBBL', type: 'Bank' }, 'Bank')).resolves.toBe('bank');
            });

            it('an unlinked wallet "Rocket" posts as bank', async () => {
                await expect(modeOf({ id: 'pm-rocket', name: 'Rocket', type: 'Mobile Wallet' }, 'Mobile Wallet')).resolves.toBe('bank');
            });

            it('an unlinked Card method "VISA" posts as bank', async () => {
                await expect(modeOf({ id: 'pm-visa', name: 'VISA', type: 'Card' }, 'Card')).resolves.toBe('bank');
            });

            it('an unlinked Cash method "Till 2" posts as cash', async () => {
                await expect(modeOf({ id: 'pm-till-2', name: 'Till 2', type: 'Cash' }, 'Cash')).resolves.toBe('cash');
            });

            it('an unlinked "bKash" of type Mobile Wallet posts as bkash, and "Nagad Merchant" as nagad', async () => {
                await expect(modeOf({ id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet' }, 'Mobile Wallet')).resolves.toBe('bkash');
                await expect(modeOf({ id: 'pm-nagad', name: 'Nagad Merchant', type: 'Mobile Wallet' }, 'Mobile Wallet')).resolves.toBe('nagad');
            });

            it('a kept tender and a legacy row follow the same rule', async () => {
                const client = methodsDb([
                    method({ id: 'pm-visa', name: 'VISA', type: 'Card' }),
                    method({ id: 'pm-rocket', name: 'Rocket', type: 'Mobile Wallet', all_branches: false, stores: [{ store_id: 's2' }] }),
                ]);
                const tenders = await resolveTenders(client as any, 't1', 's1', [
                    { paymentMethod: 'Card', paymentMethodId: 'pm-visa', amount: 100 },
                    { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-rocket', amount: 50 },
                ], [
                    { payment_method: 'Card', payment_method_id: 'pm-visa', payment_method_name: 'VISA', account_id: null, amount: new Prisma.Decimal(100) },
                    { payment_method: 'Mobile Wallet', payment_method_id: null, payment_method_name: 'Rocket', account_id: null, amount: new Prisma.Decimal(50) },
                ]);

                expect(tenders.map((t) => [t.methodName, t.mode])).toEqual([
                    ['VISA', 'bank'],
                    ['Rocket', 'bank'],
                ]);
            });

            it('a tender with no id matched by name to an unlinked method posts by the type it was sent with', async () => {
                const client = methodsDb([method({ id: 'pm-bank', name: 'Bank', type: 'Bank' })]);

                const [tender] = await resolveTenders(client as any, 't1', 's1', [{ paymentMethod: 'Bank', amount: 100 }]);

                expect(tender).toMatchObject({ methodId: 'pm-bank', accountId: null, mode: 'bank' });
            });
        });

        it('keeps input order and looks every method up in at most two queries', async () => {
            const client = methodsDb([
                method({ id: 'pm-cash', name: 'Cash', account_id: 'acc-cash' }),
                method({ id: 'pm-bank', name: 'Bank', account_id: 'acc-bank' }),
                method({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' }),
            ]);

            const tenders = await resolveTenders(client as any, 't1', 's1', [
                { paymentMethod: 'BKASH', amount: 1 },
                { paymentMethod: 'CASH', paymentMethodId: 'pm-cash', amount: 2 },
                { paymentMethod: 'CARD', amount: 3 },
                { paymentMethod: 'BANK', paymentMethodId: 'pm-bank', amount: 4 },
            ]);

            expect(tenders.map((t) => [t.paymentMethod, t.methodId, t.amount])).toEqual([
                ['BKASH', 'pm-bkash', 1],
                ['CASH', 'pm-cash', 2],
                ['CARD', null, 3],
                ['BANK', 'pm-bank', 4],
            ]);
            expect(client.paymentMethod.findMany.mock.calls.length).toBeLessThanOrEqual(2);
            expect(client.paymentMethod.findFirst).not.toHaveBeenCalled();
        });

        it('makes no query for no tenders', async () => {
            const client = methodsDb([]);
            await expect(resolveTenders(client as any, 't1', 's1', [])).resolves.toEqual([]);
            expect(client.paymentMethod.findMany).not.toHaveBeenCalled();
        });
    });

    describe('storedToTenderInputs()', () => {
        it('reads stored rows back as tender inputs', () => {
            expect(storedToTenderInputs([
                { payment_method: 'CASH', payment_method_id: 'pm-cash', payment_method_name: 'Cash', account_id: 'acc-cash', amount: new Prisma.Decimal('1000.50') },
                { payment_method: 'BKASH', payment_method_id: null, payment_method_name: null, account_id: null, amount: '20' },
            ])).toEqual([
                { paymentMethod: 'CASH', paymentMethodId: 'pm-cash', amount: 1000.5 },
                { paymentMethod: 'BKASH', paymentMethodId: null, amount: 20 },
            ]);
        });
    });

    describe('allocateTenders()', () => {
        const cash = resolved({ paymentMethod: 'CASH', methodId: 'pm-cash', accountId: 'acc-cash', mode: 'cash', amount: 1000 });
        const bkash = resolved({ paymentMethod: 'BKASH', methodId: 'pm-bkash', accountId: 'acc-bkash', mode: 'bkash', amount: 200 });

        it('caps at the amount and returns the tail', () => {
            expect(allocateTenders([cash, bkash], 1100)).toEqual({
                lines: [
                    { accountId: 'acc-cash', mode: 'cash', amount: 1000 },
                    { accountId: 'acc-bkash', mode: 'bkash', amount: 100 },
                ],
                rest: [{ ...bkash, amount: 100 }],
            });
        });

        it('pads a shortfall with a cash line', () => {
            expect(allocateTenders([{ ...cash, amount: 300 }], 500)).toEqual({
                lines: [
                    { accountId: 'acc-cash', mode: 'cash', amount: 300 },
                    { accountId: null, mode: 'cash', amount: 200 },
                ],
                rest: [],
            });
            expect(allocateTenders([], 50).lines).toEqual([{ accountId: null, mode: 'cash', amount: 50 }]);
        });

        it('rounds to two decimals', () => {
            const { lines, rest } = allocateTenders([
                { ...cash, amount: 0.1 },
                { ...bkash, amount: 0.2 },
            ], 0.3);
            expect(lines.map((l) => l.amount)).toEqual([0.1, 0.2]);
            expect(rest).toEqual([]);
        });
    });

    describe('sameTenders()', () => {
        it('true for the same tenders in another order', () => {
            expect(sameTenders(
                [
                    { methodId: 'pm-cash', paymentMethod: 'CASH', amount: 100 },
                    { methodId: null, paymentMethod: 'BKASH', amount: 50 },
                ],
                [
                    { methodId: null, paymentMethod: 'bKash', amount: 50.001 },
                    { methodId: 'pm-cash', paymentMethod: 'Cash', amount: 100 },
                ],
            )).toBe(true);
        });

        it('false when an amount or method differs', () => {
            const base = [
                { methodId: 'pm-cash', paymentMethod: 'CASH', amount: 100 },
                { methodId: 'pm-cash', paymentMethod: 'CASH', amount: 40 },
            ];
            expect(sameTenders(base, [base[0], { ...base[1], amount: 41 }])).toBe(false);
            expect(sameTenders(base, [base[0], { ...base[1], methodId: 'pm-bank' }])).toBe(false);
            expect(sameTenders(base, [base[0]])).toBe(false);
            // A multiset: one 100 cannot answer for two.
            expect(sameTenders(base, [base[0], base[0]])).toBe(false);
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
