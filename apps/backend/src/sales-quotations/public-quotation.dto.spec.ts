import { toPublicQuotation } from './public-quotation.dto';

/**
 * This DTO is the boundary between a tenant's internal record and a page any
 * stranger with a link can open. The key-set assertions below are the point of
 * the file: they pin the exact output key set, so widening the allow-list in
 * `toPublicQuotation` fails here and has to be argued for. A new column on
 * Quotation on its own does not fail this test and is not meant to — the
 * allow-list means it never reaches the output at all. The `row()` fixture
 * carries internal ids and planning fields precisely to prove that.
 */
describe('toPublicQuotation', () => {
    const row = () => ({
        id: 'quote-1',
        tenant_id: 'tenant-1',
        store_id: 'store-1',
        customer_id: 'cust-1',
        quote_number: 'Q-1001',
        total_amount: '15000.00',
        status: 'SENT',
        valid_until: new Date('2026-09-01'),
        version: 2,
        original_quote_id: 'quote-0',
        notes: 'Delivery within 7 days',
        created_at: new Date('2026-08-01'),
        share_token: 'secret-token',
        share_token_at: new Date('2026-08-02'),
        customer: { id: 'cust-1', name: 'Rahim Traders', phone: '01710000000', email: 'a@b.com' },
        items: [
            {
                id: 'item-1',
                quotation_id: 'quote-1',
                product_id: 'prod-1',
                quantity: 3,
                unit_price: '5000.00',
                product: {
                    id: 'prod-1',
                    name: 'Ceiling Fan',
                    sku: 'CF-01',
                    price: '5200.00',
                    reorder_level: 4,
                    safety_stock: 2,
                    lead_time_days: 14,
                    tenant_id: 'tenant-1',
                },
            },
        ],
        store: { id: 'store-1', name: 'Main Branch' },
    });

    it('exposes exactly the agreed top-level keys', () => {
        expect(Object.keys(toPublicQuotation(row())).sort()).toEqual(
            [
                'created_at',
                'customer_name',
                'items',
                'notes',
                'quote_number',
                'seller_name',
                'status',
                'total_amount',
                'valid_until',
                'version',
            ].sort(),
        );
    });

    it('exposes exactly the agreed line-item keys', () => {
        expect(Object.keys(toPublicQuotation(row()).items[0]).sort()).toEqual(
            ['line_total', 'product_name', 'quantity', 'unit_price'].sort(),
        );
    });

    it('never leaks the share token', () => {
        expect(JSON.stringify(toPublicQuotation(row()))).not.toContain('secret-token');
    });

    it('never leaks internal identifiers', () => {
        const json = JSON.stringify(toPublicQuotation(row()));
        for (const secret of ['tenant-1', 'store-1', 'cust-1', 'prod-1', 'quote-1', 'quote-0']) {
            expect(json).not.toContain(secret);
        }
    });

    it('never leaks internal product planning fields', () => {
        const json = JSON.stringify(toPublicQuotation(row()));
        expect(json).not.toContain('reorder_level');
        expect(json).not.toContain('safety_stock');
        expect(json).not.toContain('lead_time_days');
    });

    it('computes the line total from quantity and unit price', () => {
        expect(toPublicQuotation(row()).items[0]).toMatchObject({
            product_name: 'Ceiling Fan',
            quantity: 3,
            unit_price: 5000,
            line_total: 15000,
        });
    });

    it('falls back to a placeholder when the quotation has no customer', () => {
        const anonymous = { ...row(), customer: null };
        expect(toPublicQuotation(anonymous).customer_name).toBe('');
    });
});
