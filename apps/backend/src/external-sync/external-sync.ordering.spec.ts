import { SYNC_STEPS } from './external-sync.service';

/**
 * Within a chunk, purchases must be imported before sales.
 *
 * A replay starts from no stock, so a sale processed before the purchase that
 * stocked its product is short. With posting on that is fatal rather than
 * cosmetic: the stock movement throws, the whole sale is dropped, and its
 * customer payments still import — which is how one migration ended up with
 * 943 missing sales and 214 negative customer balances.
 */
describe('external-sync step order', () => {
    it('runs PURCHASES before SALES', () => {
        const order = [...SYNC_STEPS];
        expect(order.indexOf('PURCHASES')).toBeLessThan(order.indexOf('SALES'));
    });

    it('runs SALE_RETURNS after SALES, since a return needs its parent', () => {
        const order = [...SYNC_STEPS];
        expect(order.indexOf('SALE_RETURNS')).toBeGreaterThan(order.indexOf('SALES'));
    });

    it('runs MASTERS first, since every document references them', () => {
        expect([...SYNC_STEPS][0]).toBe('MASTERS');
    });
});
