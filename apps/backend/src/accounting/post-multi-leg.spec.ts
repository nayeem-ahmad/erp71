import { BadRequestException } from '@nestjs/common';
import { postMultiLeg } from './posting.utils';

/**
 * Covers the N-leg posting path. `autoPostFromRules` is two-legged by
 * construction, so everything here — the balance check, per-leg party tagging,
 * dropping zero legs — is behaviour that has no equivalent to compare against.
 */
describe('postMultiLeg', () => {
    let tx: any;
    /** Every account that exists for this tenant in the test at hand. */
    let knownAccounts: Array<{ id: string; party_type: string | null }>;

    const account = (id: string, party_type: string | null = null) => ({ id, party_type });

    const baseInput = () => ({
        tx,
        tenantId: 'tenant-1',
        eventType: 'purchase' as const,
        sourceModule: 'imports',
        sourceType: 'import_shipment',
        sourceId: 'ship-1',
        legs: [
            { accountId: 'acc-inventory', debit: 1000 },
            { accountId: 'acc-transit', credit: 780 },
            { accountId: 'acc-duty', credit: 220 },
        ],
    });

    beforeEach(() => {
        knownAccounts = [account('acc-inventory'), account('acc-transit'), account('acc-duty')];
        tx = {
            postingEvent: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'event-1' }),
                update: jest.fn().mockResolvedValue({ id: 'event-1' }),
            },
            fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
            // Filters on the requested ids like the real query does. A mock
            // that returns a fixed list regardless would hand back accounts the
            // entry never named and trip the count check for the wrong reason.
            account: {
                findMany: jest.fn(({ where }: any) =>
                    Promise.resolve(
                        knownAccounts.filter((a) => where.id.in.includes(a.id)),
                    ),
                ),
            },
            voucherSequence: {
                upsert: jest.fn().mockResolvedValue({ next_number: 7 }),
                update: jest.fn().mockResolvedValue({}),
            },
            accountingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
            voucher: {
                create: jest.fn().mockResolvedValue({
                    id: 'voucher-1',
                    voucher_number: 'JV-00007',
                    voucher_type: 'journal',
                }),
            },
        };
    });

    const detailsOf = () => tx.voucher.create.mock.calls[0][0].data.details.create;

    it('writes one voucher detail per leg', async () => {
        const result = await postMultiLeg(baseInput());

        expect(result).toMatchObject({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00007',
        });

        const details = detailsOf();
        expect(details).toHaveLength(3);
        expect(details.map((d: any) => [d.account_id, Number(d.debit_amount), Number(d.credit_amount)])).toEqual([
            ['acc-inventory', 1000, 0],
            ['acc-transit', 0, 780],
            ['acc-duty', 0, 220],
        ]);
    });

    it('defaults to a journal voucher and honours an explicit type', async () => {
        await postMultiLeg(baseInput());
        expect(tx.voucher.create.mock.calls[0][0].data.voucher_type).toBe('journal');

        tx.voucher.create.mockClear();
        await postMultiLeg({ ...baseInput(), voucherType: 'bank_payment' });
        expect(tx.voucher.create.mock.calls[0][0].data.voucher_type).toBe('bank_payment');
    });

    it('marks the posting event posted and links the voucher', async () => {
        await postMultiLeg(baseInput());

        expect(tx.postingEvent.update).toHaveBeenLastCalledWith({
            where: { id: 'event-1' },
            data: { status: 'posted', voucher_id: 'voucher-1', last_error: null },
        });
    });

    describe('idempotency', () => {
        it('returns the existing voucher without posting again', async () => {
            tx.postingEvent.findUnique.mockResolvedValue({
                id: 'event-1',
                status: 'posted',
                voucher: { id: 'voucher-9', voucher_number: 'JV-00009', voucher_type: 'journal' },
            });

            const result = await postMultiLeg(baseInput());

            expect(result.voucherId).toBe('voucher-9');
            expect(tx.voucher.create).not.toHaveBeenCalled();
        });

        it('short-circuits even when the period has since been locked', async () => {
            tx.postingEvent.findUnique.mockResolvedValue({
                id: 'event-1',
                status: 'posted',
                voucher: { id: 'voucher-9', voucher_number: 'JV-00009', voucher_type: 'journal' },
            });
            tx.fiscalPeriod.findFirst.mockResolvedValue({ is_locked: true, period_label: 'FY25 Q1' });

            await expect(postMultiLeg(baseInput())).resolves.toMatchObject({ voucherId: 'voucher-9' });
        });

        it('retries a failed event rather than creating a second one', async () => {
            tx.postingEvent.findUnique.mockResolvedValue({ id: 'event-1', status: 'failed', voucher: null });

            await postMultiLeg(baseInput());

            expect(tx.postingEvent.create).not.toHaveBeenCalled();
            expect(tx.postingEvent.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) }),
            );
        });

        it('suffixes the key with legKey so a second posting off one source does not collide', async () => {
            await postMultiLeg({ ...baseInput(), legKey: 'duty' });

            expect(tx.postingEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        idempotency_key: 'tenant-1:purchase:ship-1:duty',
                    }),
                }),
            );
        });
    });

    describe('validation', () => {
        const expectFailure = async (input: any, code: string) => {
            await expect(postMultiLeg(input)).rejects.toThrow(BadRequestException);
            expect(tx.postingEvent.update).toHaveBeenCalledWith({
                where: { id: 'event-1' },
                data: { status: 'failed', last_error: code },
            });
            expect(tx.voucher.create).not.toHaveBeenCalled();
        };

        it('refuses an unbalanced entry', async () => {
            await expectFailure(
                {
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: 1000 },
                        { accountId: 'acc-transit', credit: 999 },
                    ],
                },
                'MULTI_LEG_UNBALANCED',
            );
        });

        it('accepts an entry that only balances in decimal, not in float', async () => {
            // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. Summing legs as
            // floats would reject this balanced entry.
            await expect(
                postMultiLeg({
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: 0.1 },
                        { accountId: 'acc-transit', debit: 0.2 },
                        { accountId: 'acc-duty', credit: 0.3 },
                    ],
                }),
            ).resolves.toMatchObject({ postingStatus: 'posted' });
        });

        it('refuses a single-leg entry', async () => {
            await expectFailure(
                { ...baseInput(), legs: [{ accountId: 'acc-inventory', debit: 100 }] },
                'MULTI_LEG_TOO_FEW_LEGS',
            );
        });

        it('refuses an entry that nets to zero', async () => {
            await expectFailure(
                {
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: 0, credit: 0 },
                        { accountId: 'acc-transit', debit: 0, credit: 0 },
                    ],
                },
                // Both legs drop as empty, so this fails on leg count first.
                'MULTI_LEG_TOO_FEW_LEGS',
            );
        });

        it('refuses a negative amount rather than treating it as the other side', async () => {
            await expectFailure(
                {
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: -100 },
                        { accountId: 'acc-transit', credit: -100 },
                    ],
                },
                'MULTI_LEG_NEGATIVE_AMOUNT',
            );
        });

        it('refuses a leg carrying both a debit and a credit', async () => {
            await expectFailure(
                {
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: 100, credit: 40 },
                        { accountId: 'acc-transit', credit: 60 },
                    ],
                },
                'MULTI_LEG_BOTH_SIDES',
            );
        });

        it('refuses an account that is not the tenant’s', async () => {
            // acc-duty belongs to somebody else, so the lookup simply does not
            // return it — the same shape as an id that does not exist.
            knownAccounts = knownAccounts.filter((a) => a.id !== 'acc-duty');
            await expectFailure(baseInput(), 'MULTI_LEG_ACCOUNT_INVALID');
        });

        it('refuses a posting into a locked fiscal period', async () => {
            tx.fiscalPeriod.findFirst.mockResolvedValue({ is_locked: true, period_label: 'FY25 Q1' });
            await expect(postMultiLeg(baseInput())).rejects.toThrow(/FISCAL_PERIOD_LOCKED/);
            // The guard runs before any event row is written.
            expect(tx.postingEvent.create).not.toHaveBeenCalled();
        });
    });

    describe('zero legs', () => {
        it('drops a leg that came to nothing instead of writing an empty line', async () => {
            await postMultiLeg({
                ...baseInput(),
                legs: [
                    { accountId: 'acc-inventory', debit: 1000 },
                    { accountId: 'acc-transit', credit: 1000 },
                    // An import cost the tenant did not incur on this shipment.
                    { accountId: 'acc-duty', credit: 0 },
                ],
            });

            expect(detailsOf()).toHaveLength(2);
        });
    });

    describe('party tagging', () => {
        beforeEach(() => {
            knownAccounts = [
                account('acc-inventory'),
                account('acc-payable', 'SUPPLIER'),
                account('acc-duty'),
            ];
        });

        const withParty = (leg: any) => ({
            ...baseInput(),
            legs: [
                { accountId: 'acc-inventory', debit: 1000 },
                { accountId: 'acc-duty', credit: 200 },
                { accountId: 'acc-payable', credit: 800, ...leg },
            ],
        });

        it('tags only the leg the caller named', async () => {
            await postMultiLeg(withParty({ partyType: 'SUPPLIER', partyId: 'sup-1' }));

            const details = detailsOf();
            expect(details[2]).toMatchObject({ party_type: 'SUPPLIER', party_id: 'sup-1' });
            expect(details[0].party_type).toBeUndefined();
            expect(details[1].party_type).toBeUndefined();
        });

        it('refuses a party named against a non-control account', async () => {
            // Silently dropping it would leave a control account whose balance
            // no longer decomposes into per-party ledgers, with nothing
            // reporting the fact.
            await expect(
                postMultiLeg({
                    ...baseInput(),
                    legs: [
                        { accountId: 'acc-inventory', debit: 1000, partyType: 'SUPPLIER', partyId: 'sup-1' },
                        { accountId: 'acc-payable', credit: 1000 },
                    ],
                }),
            ).rejects.toThrow(/MULTI_LEG_PARTY_ACCOUNT_MISMATCH/);
        });

        it('refuses a party id with no type, and a type with no id', async () => {
            await expect(postMultiLeg(withParty({ partyId: 'sup-1' }))).rejects.toThrow(
                /MULTI_LEG_PARTY_INCOMPLETE/,
            );
            await expect(postMultiLeg(withParty({ partyType: 'SUPPLIER' }))).rejects.toThrow(
                /MULTI_LEG_PARTY_INCOMPLETE/,
            );
        });
    });

    it('attributes to the branch when a store is given and to the company otherwise', async () => {
        await postMultiLeg({ ...baseInput(), storeId: 'store-1' });
        expect(tx.voucher.create.mock.calls[0][0].data).toMatchObject({
            store_id: 'store-1',
            attribution: 'BRANCH',
        });

        tx.voucher.create.mockClear();
        await postMultiLeg(baseInput());
        expect(tx.voucher.create.mock.calls[0][0].data).toMatchObject({
            store_id: null,
            attribution: 'COMPANY',
        });
    });
});
