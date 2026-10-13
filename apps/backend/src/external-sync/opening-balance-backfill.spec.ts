import { BadRequestException } from '@nestjs/common';
import { postImportedOpenings } from './opening-balance-backfill';

const postPartyOpeningBalance: jest.Mock = jest.fn(async () => ({ postingStatus: 'posted', voucherId: 'v-1' }));

jest.mock('../accounting/party-opening-balance.posting', () => ({
    postPartyOpeningBalance: (...args: any[]) => postPartyOpeningBalance(...args),
}));

const OPENED = new Date('2025-01-01T00:00:00.000Z');
const NOTE = 'Opening balance imported from EXPRESS_RETAIL_PRO';

function makeDb({ postedIds = [] as string[] } = {}) {
    const tx = { marker: 'tx' };
    return {
        tx,
        customerCreditTransaction: {
            findMany: jest.fn(async () => [
                { id: 'c-1', customer_id: 'cust-1', amount: 8685, created_at: OPENED, store_id: 'store-1', notes: NOTE },
                { id: 'c-2', customer_id: 'cust-2', amount: -40, created_at: OPENED, store_id: 'store-1', notes: NOTE },
            ]),
        },
        supplierCreditTransaction: {
            findMany: jest.fn(async () => [
                { id: 's-1', supplier_id: 'sup-1', amount: 548425, created_at: OPENED, store_id: null, notes: NOTE },
            ]),
        },
        postingEvent: {
            findMany: jest.fn(async () => postedIds.map((source_id) => ({ source_id }))),
        },
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as any;
}

beforeEach(() => postPartyOpeningBalance.mockClear());

describe('postImportedOpenings', () => {
    it('finds the openings an import wrote, by their note, for one tenant', async () => {
        const db = makeDb();
        await postImportedOpenings(db, { tenantId: 't1', dryRun: false });

        const where = { tenant_id: 't1', type: 'ADJUSTMENT', notes: { startsWith: 'Opening balance imported from ' } };
        expect(db.customerCreditTransaction.findMany.mock.calls[0][0].where).toEqual(where);
        expect(db.supplierCreditTransaction.findMany.mock.calls[0][0].where).toEqual(where);
    });

    it('posts each opening as the importer now does, one transaction per row', async () => {
        const db = makeDb();
        const report = await postImportedOpenings(db, { tenantId: 't1', dryRun: false });

        expect(db.$transaction).toHaveBeenCalledTimes(3);
        expect(postPartyOpeningBalance).toHaveBeenCalledWith({
            tx: db.tx,
            tenantId: 't1',
            party: 'CUSTOMER',
            partyId: 'cust-1',
            amount: 8685,
            date: OPENED,
            sourceModule: 'external-sync',
            sourceId: 'c-1',
            storeId: 'store-1',
            description: NOTE,
        });
        expect(postPartyOpeningBalance).toHaveBeenCalledWith(expect.objectContaining({
            party: 'SUPPLIER', partyId: 'sup-1', amount: 548425, sourceId: 's-1', storeId: undefined,
        }));
        expect(report.posted.map((row) => row.rowId)).toEqual(['c-1', 'c-2', 's-1']);
    });

    it('leaves alone an opening that already has its voucher', async () => {
        const db = makeDb({ postedIds: ['c-1'] });
        const report = await postImportedOpenings(db, { tenantId: 't1', dryRun: false });

        expect(db.postingEvent.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 't1',
            event_type: 'party_opening_balance',
            status: 'posted',
            voucher_id: { not: null },
        });
        expect(postPartyOpeningBalance.mock.calls.map(([input]) => input.sourceId)).toEqual(['c-2', 's-1']);
        expect(report.alreadyPosted).toBe(1);
    });

    it('rolls every posting back on a dry run, reporting what would post', async () => {
        const db = makeDb();
        const committed: string[] = [];
        db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            const result = await fn(db.tx);
            committed.push('commit');
            return result;
        });

        const report = await postImportedOpenings(db, { tenantId: 't1', dryRun: true });

        // Posted for real, so a locked month or a missing account shows up in
        // the preview, but never committed.
        expect(postPartyOpeningBalance).toHaveBeenCalledTimes(3);
        expect(committed).toEqual([]);
        expect(report.posted.map((row) => row.rowId)).toEqual(['c-1', 'c-2', 's-1']);
        expect(report.failed).toEqual([]);
    });

    it('reports an opening dated into a locked month and carries on', async () => {
        postPartyOpeningBalance.mockRejectedValueOnce(
            new BadRequestException('FISCAL_PERIOD_LOCKED: Jan 2025 is locked and cannot accept new postings'),
        );
        const report = await postImportedOpenings(makeDb(), { tenantId: 't1', dryRun: false });

        expect(report.locked.map((row) => row.rowId)).toEqual(['c-1']);
        expect(report.posted.map((row) => row.rowId)).toEqual(['c-2', 's-1']);
    });

    it('reports a workspace with no control account as skipped', async () => {
        postPartyOpeningBalance.mockResolvedValueOnce({ postingStatus: 'skipped' });
        const report = await postImportedOpenings(makeDb(), { tenantId: 't1', dryRun: false });

        expect(report.skipped.map((row) => row.rowId)).toEqual(['c-1']);
    });

    it('reports any other failure with its reason and carries on', async () => {
        postPartyOpeningBalance.mockRejectedValueOnce(new BadRequestException('Account "Opening Balance Equity" is not set up'));
        const report = await postImportedOpenings(makeDb(), { tenantId: 't1', dryRun: false });

        expect(report.failed).toEqual([
            expect.objectContaining({ rowId: 'c-1', error: 'Account "Opening Balance Equity" is not set up' }),
        ]);
        expect(report.posted).toHaveLength(2);
    });
});
