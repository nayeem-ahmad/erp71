import type { BillScanResult } from '@erp71/shared-types';

/** The sessionStorage key a scanned bill waits under on its way to the purchase form. */
export const PURCHASE_DRAFT_KEY = 'erp71.billScan.purchaseDraft';

/** What the purchase form needs from a scan: the shape `usePurchaseEntry.loadPurchase` reads, plus the supplier to propose. */
export interface ScannedPurchaseDraft {
    /** For the banner: the bill number, or the vendor, or the date. */
    label: string;
    purchase: {
        items: Array<{ product_id: string; product: { name: string; unit_type?: string | null }; unit_cost: number; quantity: number }>;
        supplier_id?: string;
        supplier?: { id: string; name: string; phone?: string | null };
        tax_amount: number;
        discount_amount: number;
        freight_amount: number;
        notes: string;
    };
    /** A vendor the scan read but could not match: offered as a new supplier. */
    newSupplier?: { name: string; phone: string; email: string; address: string };
    unmatched: string[];
}

/**
 * The purchase the form should open with. Only lines matched to a product
 * become purchase lines — a line needs a product id — and the rest are named
 * in the notes so nothing on the paper is silently dropped.
 */
export function toPurchaseDraft(
    scan: BillScanResult,
    copy: { notes: string; unmatched: string },
): ScannedPurchaseDraft {
    const label = scan.billNumber ?? scan.vendorName ?? scan.billDate ?? '';
    const items = scan.lines
        .filter((line) => line.product)
        .map((line) => ({
            product_id: line.product!.id,
            product: { name: line.product!.name, unit_type: line.product!.unit_type ?? undefined },
            unit_cost: line.unitPrice ?? (line.lineTotal !== null && line.quantity ? line.lineTotal / line.quantity : 0),
            quantity: line.quantity,
        }));
    const unmatched = scan.lines.filter((line) => !line.product).map((line) => line.description);
    const notes = [
        copy.notes.replace('{bill}', label),
        unmatched.length ? copy.unmatched.replace('{items}', unmatched.join('; ')) : '',
    ]
        .filter(Boolean)
        .join(' ');

    return {
        label,
        purchase: {
            items,
            ...(scan.supplier ? { supplier_id: scan.supplier.id, supplier: scan.supplier } : {}),
            tax_amount: scan.tax ?? 0,
            discount_amount: scan.discount ?? 0,
            freight_amount: scan.freight ?? 0,
            notes: notes.slice(0, 1000),
        },
        ...(!scan.supplier && scan.vendorName
            ? { newSupplier: { name: scan.vendorName, phone: scan.vendorPhone ?? '', email: '', address: scan.vendorAddress ?? '' } }
            : {}),
        unmatched,
    };
}

export function savePurchaseDraft(draft: ScannedPurchaseDraft): void {
    try {
        window.sessionStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(draft));
    } catch {
        /* without storage the form just opens empty */
    }
}

/** Reads the draft once: it is removed as it is taken, so a reload does not refill the form. */
export function takePurchaseDraft(): ScannedPurchaseDraft | null {
    try {
        const raw = window.sessionStorage.getItem(PURCHASE_DRAFT_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(PURCHASE_DRAFT_KEY);
        const parsed = JSON.parse(raw) as ScannedPurchaseDraft;
        return parsed && Array.isArray(parsed.purchase?.items) ? parsed : null;
    } catch {
        return null;
    }
}
