import { syncPurchaseDate } from '../../../packages/database/prisma/sync-purchase-date';

/**
 * The SQL is the whole behaviour: a later prepare must not rewrite a date an
 * operator chose, and the column has to be NOT NULL before db push or Postgres
 * stamps every existing bill with the deploy clock.
 */
function fakeClient() {
    const calls: string[] = [];
    const client = {
        calls,
        $transaction: async (fn: (tx: { $executeRawUnsafe: (sql: string) => Promise<number> }) => Promise<number>) =>
            fn({
                $executeRawUnsafe: async (sql: string) => {
                    calls.push(sql.replace(/\s+/g, ' ').trim());
                    return 2;
                },
            }),
    };
    return client;
}

describe('syncPurchaseDate', () => {
    it('fills only NULL dates, then locks the column before db push', async () => {
        const client = fakeClient();
        const filled = await syncPurchaseDate(client as never);

        expect(filled).toBe(2);
        expect(client.calls[0]).toContain('LOCK TABLE "Purchase"');
        expect(client.calls[1]).toContain('ADD COLUMN IF NOT EXISTS "purchase_date"');
        expect(client.calls[2]).toBe(
            'UPDATE "Purchase" SET "purchase_date" = "created_at" WHERE "purchase_date" IS NULL',
        );
        expect(client.calls[3]).toContain('SET DEFAULT CURRENT_TIMESTAMP');
        expect(client.calls[4]).toContain('SET NOT NULL');
    });
});
