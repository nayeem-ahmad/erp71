import {
    loadPostingSummaries,
    loadPostingSummary,
    NO_POSTING_EVENT,
} from './posting-status.util';

// Defaults each event's idempotency_key to a PRIMARY (keyless) key for its source
// unless the test supplies one, so existing cases keep working and a leg case can
// opt in with an explicit `:paid` suffix.
const dbWith = (events: Array<Record<string, unknown>>) => ({
    postingEvent: {
        findMany: jest.fn().mockResolvedValue(
            events.map((e) => ({ idempotency_key: `tenant-1:sale:${e.source_id}`, ...e })),
        ),
    },
}) as any;

describe('loadPostingSummaries', () => {
    it('reports a failed posting as "failed", not "skipped"', async () => {
        // The bug this util exists to fix. The old read path was
        // `voucher ? 'posted' : 'skipped'`, so a failed posting — a misconfigured
        // rule that threw — was indistinguishable from a deliberate no-op, and a
        // real accounting failure looked routine in the UI.
        const db = dbWith([
            {
                source_id: 'sale-1',
                status: 'failed',
                last_error: 'AUTO_POSTING_ACCOUNT_INVALID',
                voucher: null,
            },
        ]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1']);

        expect(summaries.get('sale-1')).toEqual({
            posting_status: 'failed',
            posting_error: 'AUTO_POSTING_ACCOUNT_INVALID',
            voucher_id: null,
            voucher_number: null,
            voucher_type: null,
        });
    });

    it('prefers the PRIMARY leg when a source has two events (partial credit sale)', async () => {
        // A partial credit sale posts a keyless receivable leg plus a ":paid" cash
        // leg. The sale's status/voucher must come from the primary (receivable),
        // regardless of the order the events come back in.
        const paidLeg = {
            source_id: 'sale-1', status: 'posted', last_error: null,
            idempotency_key: 'tenant-1:sale:sale-1:paid',
            voucher: { id: 'v-paid', voucher_number: 'CR-PAID', voucher_type: 'cash_receive' },
        };
        const primaryLeg = {
            source_id: 'sale-1', status: 'posted', last_error: null,
            idempotency_key: 'tenant-1:sale:sale-1',
            voucher: { id: 'v-credit', voucher_number: 'CR-CREDIT', voucher_type: 'cash_receive' },
        };

        for (const order of [[paidLeg, primaryLeg], [primaryLeg, paidLeg]]) {
            const summaries = await loadPostingSummaries(dbWith(order), 'tenant-1', 'sales', 'sale', ['sale-1']);
            expect(summaries.get('sale-1')?.voucher_id).toBe('v-credit');
        }
    });

    it('reports a pending posting as "pending", not "skipped"', async () => {
        const db = dbWith([
            { source_id: 'sale-1', status: 'pending', last_error: null, voucher: null },
        ]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1']);

        expect(summaries.get('sale-1')?.posting_status).toBe('pending');
    });

    it('distinguishes a genuine skip and surfaces why', async () => {
        const db = dbWith([
            {
                source_id: 'sale-1',
                status: 'skipped',
                last_error: 'POSTING_RULE_NOT_CONFIGURED',
                voucher: null,
            },
        ]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1']);

        expect(summaries.get('sale-1')?.posting_status).toBe('skipped');
        expect(summaries.get('sale-1')?.posting_error).toBe('POSTING_RULE_NOT_CONFIGURED');
    });

    it('returns the voucher for a posted event', async () => {
        const db = dbWith([
            {
                source_id: 'sale-1',
                status: 'posted',
                last_error: null,
                voucher: { id: 'v-1', voucher_number: 'CR-00001', voucher_type: 'cash_receive' },
            },
        ]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1']);

        expect(summaries.get('sale-1')).toEqual({
            posting_status: 'posted',
            posting_error: null,
            voucher_id: 'v-1',
            voucher_number: 'CR-00001',
            voucher_type: 'cash_receive',
        });
    });

    it('omits sources that have no posting event', async () => {
        const db = dbWith([]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1']);

        expect(summaries.has('sale-1')).toBe(false);
    });

    it('does not query when there are no sources', async () => {
        const db = dbWith([]);

        const summaries = await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', []);

        expect(summaries.size).toBe(0);
        expect(db.postingEvent.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to the tenant and source, matching the index', async () => {
        const db = dbWith([]);

        await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['sale-1', 'sale-2']);

        expect(db.postingEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                tenant_id: 'tenant-1',
                source_module: 'sales',
                source_type: 'sale',
                source_id: { in: ['sale-1', 'sale-2'] },
            },
        }));
    });

    it('fetches every source in one query, not one per row', async () => {
        const db = dbWith([]);

        await loadPostingSummaries(db, 'tenant-1', 'sales', 'sale', ['s-1', 's-2', 's-3']);

        expect(db.postingEvent.findMany).toHaveBeenCalledTimes(1);
    });
});

describe('loadPostingSummary', () => {
    it('falls back to skipped when no posting event exists', async () => {
        // Pre-auto-posting rows, and rows whose event voidAutoPostedVoucher removed.
        // Not truly "skipped", but indistinguishable after the fact — and it is what
        // these rows have always reported, so the failed-as-skipped fix does not
        // silently reclassify history.
        const db = dbWith([]);

        expect(await loadPostingSummary(db, 'tenant-1', 'sales', 'sale', 'sale-1'))
            .toEqual(NO_POSTING_EVENT);
    });

    it('returns the real status when an event exists', async () => {
        const db = dbWith([
            { source_id: 'sale-1', status: 'failed', last_error: 'BOOM', voucher: null },
        ]);

        const summary = await loadPostingSummary(db, 'tenant-1', 'sales', 'sale', 'sale-1');

        expect(summary.posting_status).toBe('failed');
        expect(summary.posting_error).toBe('BOOM');
    });
});
