import { ExternalSyncService } from './external-sync.service';
import { DIZI_CASHIER_DEFINITION } from './provider-adapter';

const DIZI_MAPPERS = DIZI_CASHIER_DEFINITION.mappers;

/**
 * A dry run previews an import without writing anything. Because nothing is
 * written, no mapping rows are created either — so the in-memory party map
 * stays empty for the whole run by construction.
 *
 * That made every dry run report a PARTY_UNRESOLVED skip for every payment:
 * one live preview produced 1,673 "customer is not in the imported list"
 * warnings for an import that was in fact completely healthy. The preview is
 * meant to tell the tenant what a real run would do, so a warning that only
 * a dry run can produce is noise that hides the real findings — the 500-entry
 * warning cap meant genuine problems were crowded out entirely.
 */
describe('external-sync dry run', () => {
    const connection = {
        id: 'conn-1',
        tenant_id: 'tenant-1',
        provider: 'DIZI_CASHIER',
        document_prefix: 'DZ-',
        post_impacts: false,
    };

    const window = { from: '2026-06-16', to: '2026-09-14' };

    function emptyStats() {
        const tally = () => ({ created: 0, updated: 0, skipped: 0 });
        return {
            products: tally(),
            customers: tally(),
            suppliers: tally(),
            sales: tally(),
            purchases: tally(),
            customerPayments: tally(),
            supplierPayments: tally(),
            saleReturns: tally(),
        } as any;
    }

    const PAYMENT_ROW = {
        Id: 'pay-1',
        TraderId: 'trader-1',
        Amount: 250,
        Date: '2026-09-02T00:00:00',
        SlipNo: 'PS-1',
        TransactionNo: null,
        MethodName: 'Cash',
        Narration: null,
        IsDeleted: false,
    };

    function makeService() {
        const db = {
            externalSyncMapping: {
                findMany: jest.fn(async () => []),
                upsert: jest.fn(async () => ({})),
                deleteMany: jest.fn(async () => ({ count: 0 })),
            },
        } as any;
        return new ExternalSyncService(db, {} as any);
    }

    it('does not warn that a party is unresolved when nothing was written', async () => {
        const service = makeService();
        const warnings: any[] = [];
        const stats = emptyStats();
        const client = { fetchPayments: jest.fn(async () => [PAYMENT_ROW]) } as any;

        await (service as any).syncPaymentsWindow(
            connection,
            client,
            window,
            'CUSTOMER',
            new Map<string, string>(), // empty: a dry run writes no mappings
            stats,
            warnings,
            true,
            DIZI_MAPPERS,
        );

        expect(warnings.filter((w) => w.code === 'PARTY_UNRESOLVED')).toHaveLength(0);
    });

    it('counts the payment as importable rather than skipped', async () => {
        const service = makeService();
        const stats = emptyStats();
        const client = { fetchPayments: jest.fn(async () => [PAYMENT_ROW]) } as any;

        await (service as any).syncPaymentsWindow(
            connection,
            client,
            window,
            'CUSTOMER',
            new Map<string, string>(),
            stats,
            [],
            true,
            DIZI_MAPPERS,
        );

        expect(stats.customerPayments.created).toBe(1);
        expect(stats.customerPayments.skipped).toBe(0);
    });

    it('still warns about an unresolved party on a real run', async () => {
        const service = makeService();
        const warnings: any[] = [];
        const stats = emptyStats();
        const client = { fetchPayments: jest.fn(async () => [PAYMENT_ROW]) } as any;

        await (service as any).syncPaymentsWindow(
            connection,
            client,
            window,
            'CUSTOMER',
            new Map<string, string>(),
            stats,
            warnings,
            false,
            DIZI_MAPPERS,
        );

        expect(warnings.filter((w) => w.code === 'PARTY_UNRESOLVED')).toHaveLength(1);
        expect(stats.customerPayments.skipped).toBe(1);
    });

    /**
     * A payment whose party genuinely has no id is unresolvable in any run,
     * so that warning is real information even in a preview.
     */
    it('still warns in a dry run when the row carries no party id at all', async () => {
        const service = makeService();
        const warnings: any[] = [];
        const stats = emptyStats();
        const client = { fetchPayments: jest.fn(async () => [{ ...PAYMENT_ROW, TraderId: null }]) } as any;

        await (service as any).syncPaymentsWindow(
            connection,
            client,
            window,
            'CUSTOMER',
            new Map<string, string>(),
            stats,
            warnings,
            true,
            DIZI_MAPPERS,
        );

        expect(warnings.filter((w) => w.code === 'PARTY_UNRESOLVED')).toHaveLength(1);
    });
});
