import type { InvoicePrintPrefs } from '@erp71/shared-types';
import { formatDateTime } from '@/lib/format';
import { instrumentFromRecord, instrumentSummary } from '@/lib/payment-instrument';
import { paperSizeLabel } from '@/lib/print';
import type { DeepPartial, PrintHeaderConfig, PrintPreviewOptions } from '@/lib/print';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import {
    printPurchaseInvoice,
    type PurchaseInvoiceLabels,
} from '@/lib/purchase-invoice-printer';

/**
 * The shape this module needs off a purchase to print it.
 *
 * Matches GET /purchases/:id/invoice's `purchase` object, and is loose enough
 * that a list row with the same fields can satisfy it too.
 */
export interface PrintablePurchase {
    purchase_number: string;
    reference_number?: string | null;
    created_at: string;
    /** When the purchase happened. Absent on a row saved before the column existed. */
    purchase_date?: string | null;
    notes?: string | null;
    subtotal_amount: string | number;
    tax_amount?: string | number;
    discount_amount?: string | number;
    freight_amount?: string | number;
    total_amount: string | number;
    /** Paid so far, at entry and by later supplier payments. */
    paid_amount?: string | number;
    /** Who entered it, by name — GET /purchases/:id/invoice resolves it. */
    prepared_by?: string | null;
    store?: { name?: string | null } | null;
    supplier?: {
        name?: string;
        supplier_code?: string | null;
        phone?: string | null;
        address?: string | null;
    } | null;
    items: {
        quantity: number;
        unit_cost: string | number;
        product?: { name?: string; sku?: string | null } | null;
    }[];
    payments?: {
        payment_method?: string;
        amount: string | number;
        bank_name?: string | null;
        bank_branch?: string | null;
        bank_account_number?: string | null;
        reference_no?: string | null;
        instrument_date?: string | null;
    }[];
}

export interface PurchasePrintContext {
    header: { companyName?: string; headerConfig?: DeepPartial<PrintHeaderConfig> };
    locale: string;
    /** `t.purchases.invoice` */
    invoiceLabels: {
        purchaseReceipt: string;
        noSupplier: string;
        purchaseNo: string;
        item: string;
        qty: string;
        unitCost: string;
        lineTotal: string;
        subtotal: string;
        tax: string;
        freight: string;
        discount: string;
        total: string;
        paymentDetails: string;
        notePrefix: string;
        footer: string;
        unknownProduct: string;
    };
    /** `t.sales.printMenu` — preview toolbar wording is shared with sales. */
    menuLabels: {
        preview: {
            heading: string;
            print: string;
            close: string;
            skip: string;
        };
    };
    unknownProductLabel: string;
    supplierLabel: string;
    dateLabel: string;
    branchLabel: string;
    /**
     * The printing member's invoice layout. Detailed prints the receipt on the
     * detailed invoice's design; the built-in layout when omitted.
     */
    invoiceLayout?: InvoicePrintPrefs;
    /** The signed-in user printing, named on the detailed layout's print line. */
    printedBy?: string;
    /** A code that opens the purchase in the app; the detailed layout prints it. */
    qrDataUrl?: string;
}

function money(value: string | number | undefined): number {
    if (typeof value === 'number') return value;
    return parseFloat(value ?? '0') || 0;
}

function labelsFor(ctx: PurchasePrintContext, companyName: string): PurchaseInvoiceLabels {
    const inv = ctx.invoiceLabels;
    return {
        docTitle: inv.purchaseReceipt,
        supplier: ctx.supplierLabel,
        noSupplier: inv.noSupplier,
        purchaseNo: inv.purchaseNo,
        date: ctx.dateLabel,
        branch: ctx.branchLabel,
        item: inv.item,
        qty: inv.qty,
        unitCost: inv.unitCost,
        lineTotal: inv.lineTotal,
        subtotal: inv.subtotal,
        tax: inv.tax,
        freight: inv.freight,
        discount: inv.discount,
        total: inv.total,
        payment: inv.paymentDetails,
        notePrefix: inv.notePrefix,
        footer: inv.footer.replace('{businessName}', companyName),
    };
}

function previewFor(
    size: PaperSize,
    ctx: PurchasePrintContext,
    skipPreview: boolean,
): PrintPreviewOptions | undefined {
    if (skipPreview) return undefined;

    const copy = ctx.menuLabels.preview;
    return {
        title: copy.heading
            .replace('{document}', ctx.invoiceLabels.purchaseReceipt)
            .replace('{size}', paperSizeLabel(size)),
        printLabel: copy.print,
        closeLabel: copy.close,
        skipLabel: copy.skip,
    };
}

export function printPurchaseInvoiceFromRecord(
    purchase: PrintablePurchase,
    size: PaperSize,
    ctx: PurchasePrintContext,
    skipPreview = false,
): void {
    const companyName = ctx.header.companyName || 'RETAIL STORE';
    const tax = money(purchase.tax_amount);
    const discount = money(purchase.discount_amount);
    const freight = money(purchase.freight_amount);
    const paid = purchase.paid_amount === undefined ? undefined : money(purchase.paid_amount);

    printPurchaseInvoice(
        {
            purchaseNumber: purchase.purchase_number,
            referenceNumber: purchase.reference_number,
            date: formatDateTime(purchase.purchase_date || purchase.created_at, ctx.locale),
            companyName: ctx.header.companyName,
            headerConfig: ctx.header.headerConfig,
            supplierName: purchase.supplier?.name,
            supplierCode: purchase.supplier?.supplier_code ?? undefined,
            supplierPhone: purchase.supplier?.phone ?? undefined,
            supplierAddress: purchase.supplier?.address ?? undefined,
            storeName: purchase.store?.name ?? undefined,
            preparedBy: purchase.prepared_by ?? undefined,
            printedBy: ctx.printedBy,
            qrDataUrl: ctx.qrDataUrl,
            items: purchase.items.map((item) => ({
                name: item.product?.name ?? ctx.unknownProductLabel,
                sku: item.product?.sku ?? undefined,
                quantity: item.quantity,
                unitCost: money(item.unit_cost),
            })),
            payments: (purchase.payments ?? []).map((p) => ({
                method: p.payment_method ?? 'OTHER',
                amount: money(p.amount),
                reference: instrumentSummary(instrumentFromRecord(p)) || undefined,
            })),
            subtotal: money(purchase.subtotal_amount),
            tax: tax || undefined,
            discount: discount || undefined,
            freight: freight || undefined,
            total: money(purchase.total_amount),
            amountPaid: paid,
            note: purchase.notes ?? undefined,
            labels: labelsFor(ctx, companyName),
        },
        size,
        previewFor(size, ctx, skipPreview),
        ctx.invoiceLayout,
    );
}
