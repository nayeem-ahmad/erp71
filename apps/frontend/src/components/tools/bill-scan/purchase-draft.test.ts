import type { BillScanResult } from '@erp71/shared-types';
import { savePurchaseDraft, takePurchaseDraft, toPurchaseDraft } from './purchase-draft';

const scan: BillScanResult = {
    target: 'purchase',
    vendorName: 'Rahim Traders',
    vendorPhone: '01711000000',
    vendorAddress: null,
    billNumber: 'M-55',
    billDate: '2026-11-20',
    lines: [
        { description: 'Teer Oil 5L', quantity: 2, unitPrice: 900, lineTotal: 1800, product: { id: 'p1', name: 'Teer Soyabean Oil 5 Ltr' } },
        { description: 'Mystery item', quantity: 1, unitPrice: 50, lineTotal: 50, product: null },
    ],
    subtotal: 1850,
    discount: 50,
    tax: null,
    freight: 100,
    total: 1900,
    summary: null,
    supplier: null,
    credits_used: 3.1,
    credits_estimate: { expected: 3.2, max: 4.6 },
};

const copy = { notes: 'Scanned bill {bill}.', unmatched: 'Not matched: {items}' };

describe('toPurchaseDraft', () => {
    it('puts matched lines on the purchase and names the rest in the notes', () => {
        const draft = toPurchaseDraft(scan, copy);
        expect(draft.purchase.items).toEqual([
            { product_id: 'p1', product: { name: 'Teer Soyabean Oil 5 Ltr', unit_type: undefined }, unit_cost: 900, quantity: 2 },
        ]);
        expect(draft.purchase.notes).toBe('Scanned bill M-55. Not matched: Mystery item');
        expect(draft.purchase).toMatchObject({ discount_amount: 50, freight_amount: 100, tax_amount: 0 });
        expect(draft.unmatched).toEqual(['Mystery item']);
    });

    it('offers an unmatched vendor as a new supplier, and a matched one as itself', () => {
        expect(toPurchaseDraft(scan, copy).newSupplier).toMatchObject({ name: 'Rahim Traders', phone: '01711000000' });
        const matched = toPurchaseDraft({ ...scan, supplier: { id: 's1', name: 'Rahim Traders' } }, copy);
        expect(matched.newSupplier).toBeUndefined();
        expect(matched.purchase.supplier_id).toBe('s1');
    });

    it('is taken from storage once', () => {
        savePurchaseDraft(toPurchaseDraft(scan, copy));
        expect(takePurchaseDraft()?.label).toBe('M-55');
        expect(takePurchaseDraft()).toBeNull();
    });
});
