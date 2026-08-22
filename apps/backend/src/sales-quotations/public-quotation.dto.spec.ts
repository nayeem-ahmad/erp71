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
                // Proforma commercial terms. Present on every document so the
                // page does not have to branch on their existence; null on an
                // ordinary quote. `exchange_rate` is deliberately absent — it is
                // the seller's own translation, not the buyer's business.
                'doc_kind',
                'currency',
                'incoterm',
                'port_of_loading',
                'port_of_discharge',
                'payment_terms',
                'advance_percent',
                'advance_amount',
                'delivery_lead_time_days',
                'country_of_origin',
                'beneficiary_bank',
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
        const result = toPublicQuotation(row());
        const json = JSON.stringify(result);
        expect(json).not.toContain('reorder_level');
        expect(json).not.toContain('safety_stock');
        // Matched as a whole JSON key, not as a substring: the buyer-facing
        // `delivery_lead_time_days` legitimately contains these characters, and
        // what must not escape is the *product's* replenishment lead time.
        expect(json).not.toContain('"lead_time_days"');
        expect(result.delivery_lead_time_days).toBeNull();
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

    describe('proforma terms', () => {
        const proforma = () => ({
            ...row(),
            doc_kind: 'PROFORMA',
            currency: 'USD',
            exchange_rate: '121.500000',
            incoterm: 'CFR',
            port_of_loading: 'Shanghai',
            port_of_discharge: 'Chattogram',
            payment_terms: '30% advance, 70% against BL copy',
            advance_percent: '30.00',
            delivery_lead_time_days: 45,
            country_of_origin: 'China',
        });

        const bank = () => ({
            bank_name: 'City Bank PLC',
            bank_branch: 'Gulshan',
            bank_account_name: 'Rahim Traders',
            bank_account_number: '1402340091001',
            bank_routing_number: '225261726',
            bank_swift_code: 'CIBLBDDH',
        });

        it('defaults an ordinary quote to QUOTE in BDT with no terms', () => {
            const result = toPublicQuotation(row());
            expect(result.doc_kind).toBe('QUOTE');
            expect(result.currency).toBe('BDT');
            expect(result.incoterm).toBeNull();
            expect(result.advance_amount).toBeNull();
            expect(result.beneficiary_bank).toBeNull();
        });

        it('carries the commercial terms through', () => {
            expect(toPublicQuotation(proforma())).toMatchObject({
                doc_kind: 'PROFORMA',
                currency: 'USD',
                incoterm: 'CFR',
                port_of_loading: 'Shanghai',
                port_of_discharge: 'Chattogram',
                payment_terms: '30% advance, 70% against BL copy',
                advance_percent: 30,
                delivery_lead_time_days: 45,
                country_of_origin: 'China',
            });
        });

        it('never exposes the seller exchange rate', () => {
            const json = JSON.stringify(toPublicQuotation(proforma(), bank()));
            expect(json).not.toContain('exchange_rate');
            expect(json).not.toContain('121.5');
        });

        it('computes the advance amount in the document currency', () => {
            // 15,000 USD at 30% — stated in USD, because that is the currency
            // the buyer is being asked to remit in.
            expect(toPublicQuotation(proforma()).advance_amount).toBe(4500);
        });

        it('rounds the advance to two decimals rather than compounding the fraction', () => {
            const odd = { ...proforma(), total_amount: '1000.55', advance_percent: '33.33' };
            expect(toPublicQuotation(odd).advance_amount).toBe(333.48);
        });

        it('includes the beneficiary bank when one is configured', () => {
            expect(toPublicQuotation(proforma(), bank()).beneficiary_bank).toEqual({
                bank_name: 'City Bank PLC',
                bank_branch: 'Gulshan',
                account_name: 'Rahim Traders',
                account_number: '1402340091001',
                routing_number: '225261726',
                swift_code: 'CIBLBDDH',
            });
        });

        it('shows a partially filled bank rather than hiding it', () => {
            // A domestic seller has no SWIFT code and should not lose the panel
            // over it.
            const partial = { ...bank(), bank_swift_code: null, bank_routing_number: null };
            const result = toPublicQuotation(proforma(), partial);
            expect(result.beneficiary_bank).toMatchObject({
                bank_name: 'City Bank PLC',
                swift_code: null,
            });
        });

        it('treats an all-blank bank row as not configured', () => {
            const blank = {
                bank_name: '',
                bank_branch: null,
                bank_account_name: '   ',
                bank_account_number: null,
                bank_routing_number: null,
                bank_swift_code: null,
            };
            expect(toPublicQuotation(proforma(), blank).beneficiary_bank).toBeNull();
        });

        it('keeps the key set stable whether or not a bank is passed', () => {
            expect(Object.keys(toPublicQuotation(proforma())).sort()).toEqual(
                Object.keys(toPublicQuotation(proforma(), bank())).sort(),
            );
        });
    });
});
