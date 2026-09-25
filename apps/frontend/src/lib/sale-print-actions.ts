import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import { paymentInstrumentSummary } from '@/lib/payment-instrument';
import { printSalesInvoice, type PaperSize } from '@/lib/sales-invoice-printer';
import { printDeliveryChallan } from '@/lib/delivery-challan-printer';
import { printPOSReceipt } from '@/lib/pos-receipt-printer';
import { paperSizeLabel } from '@/lib/print';
import type { PrintPreviewOptions } from '@/lib/print';
import type { DeepPartial, PrintHeaderConfig } from '@/lib/print';

/** The three things a sale can be printed as. Mushak is a page, not a print. */
export type SaleDocument = 'invoice' | 'challan' | 'receipt';

/**
 * The shape this module needs off a sale to print it.
 *
 * Deliberately looser than the API's `Sale`: the list row, the detail screen's
 * cart state and the invoice endpoint each hold a slightly different object,
 * and every one of them can satisfy this. The alternative was three near-copies
 * of the mapping below, which is how the challan ends up with a price column on
 * one screen and not another.
 */
export interface PrintableSale {
    id: string;
    serial_number: string;
    reference_number?: string | null;
    created_at: string;
    sale_date?: string | null;
    total_amount: string;
    amount_paid: string;
    note?: string | null;
    customer?: { name?: string; phone?: string | null; address?: string | null } | null;
    items: {
        quantity: number;
        /** The list endpoint says `price_at_sale`; the cart says `price`. */
        price_at_sale?: string | number;
        price?: number;
        discount?: number;
        name?: string;
        product?: { name?: string; sku?: string | null } | null;
    }[];
    payments?: { payment_method?: string; method?: string; amount: string | number }[];
    /**
     * What the customer owed before this sale, as the sale endpoints report it.
     * Null for a walk-in or a cancelled sale, and then the invoice prints no
     * dues at all.
     */
    previous_due?: number | null;
}

/** Letterhead and labels the caller has already resolved from its hooks. */
export interface SalePrintContext {
    invoiceHeader: { companyName?: string; headerConfig?: DeepPartial<PrintHeaderConfig> };
    challanHeader: { companyName?: string; headerConfig?: DeepPartial<PrintHeaderConfig> };
    locale: string;
    /** `t.sales.challan` — the challan renders its own labels. */
    challanLabels: any;
    /** `t.sales.printMenu` — menu and preview wording. */
    menuLabels: any;
    unknownProductLabel: string;
}

function itemName(item: PrintableSale['items'][number], fallback: string): string {
    return item.name ?? item.product?.name ?? fallback;
}

function unitPrice(item: PrintableSale['items'][number]): number {
    if (typeof item.price === 'number') return item.price;
    const raw = item.price_at_sale;
    return typeof raw === 'number' ? raw : parseFloat(raw ?? '0') || 0;
}

function paymentMethod(p: NonNullable<PrintableSale['payments']>[number]): string {
    return p.method ?? p.payment_method ?? 'OTHER';
}

function paymentAmount(p: NonNullable<PrintableSale['payments']>[number]): number {
    return typeof p.amount === 'number' ? p.amount : parseFloat(p.amount) || 0;
}

/**
 * Builds the preview toolbar, or `undefined` to print straight away.
 *
 * `skipPreview` is the operator's standing answer; passing it through here
 * rather than at each call site is what keeps "skip" meaning the same thing on
 * all three screens.
 */
function previewFor(
    doc: SaleDocument,
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview: boolean,
): PrintPreviewOptions | undefined {
    if (skipPreview) return undefined;

    const copy = ctx.menuLabels.preview;
    const documentName =
        doc === 'invoice' ? copy.invoice : doc === 'challan' ? copy.challan : copy.receipt;

    return {
        title: copy.heading
            .replace('{document}', documentName)
            .replace('{size}', paperSizeLabel(size)),
        printLabel: copy.print,
        closeLabel: copy.close,
        skipLabel: copy.skip,
    };
}

/**
 * The sale's own invoice — the commercial document, prices and all.
 *
 * Totals are summed from the lines here rather than read off `total_amount`,
 * because a list row carries the stored total while the detail screen may hold
 * edited lines that have not been saved; taking the lines makes what prints
 * match what is on screen either way.
 */
export function printSaleInvoice(
    sale: PrintableSale,
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview = false,
): void {
    const items = sale.items.map((i) => ({
        name: itemName(i, ctx.unknownProductLabel),
        sku: i.product?.sku ?? undefined,
        quantity: i.quantity,
        unitPrice: unitPrice(i),
        discount: i.discount || 0,
    }));

    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity - (i.discount || 0), 0);
    const total = parseFloat(sale.total_amount) || subtotal;
    const payments = (sale.payments ?? []).map((p) => ({
        method: paymentMethod(p),
        amount: paymentAmount(p),
        reference: paymentInstrumentSummary(p as any),
    }));
    // The stored figure first: a sale brought in from another system can carry
    // what was paid with no payment rows behind it.
    const storedPaid = parseFloat(sale.amount_paid);
    const amountPaid = Number.isFinite(storedPaid)
        ? storedPaid
        : payments.reduce((sum, p) => sum + p.amount, 0);

    printSalesInvoice(
        {
            referenceNumber: sale.reference_number || sale.serial_number,
            date: formatDate(sale.sale_date ?? sale.created_at, ctx.locale),
            companyName: ctx.invoiceHeader.companyName,
            headerConfig: ctx.invoiceHeader.headerConfig,
            customerName: sale.customer?.name,
            customerPhone: sale.customer?.phone ?? undefined,
            items,
            payments,
            subtotal,
            // The difference between the lines and the stored total is whatever
            // invoice-level adjustment was applied; showing it as rounding is
            // closer than silently printing a total the lines do not sum to.
            rounding: Math.abs(total - subtotal) > 0.005 ? total - subtotal : undefined,
            total,
            amountPaid,
            previousDue: sale.previous_due,
            note: sale.note ?? undefined,
        },
        size,
        previewFor('invoice', size, ctx, skipPreview),
    );
}

/**
 * The rider's copy: the same goods with none of the money.
 *
 * Goes through `printDeliveryChallan`, which has no field to put a price in, so
 * this cannot leak one by omission the next time the invoice layout changes.
 */
export function printSaleChallan(
    sale: PrintableSale,
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview = false,
): void {
    printDeliveryChallan(
        {
            challanNumber: sale.reference_number || sale.serial_number,
            invoiceNumber: sale.serial_number,
            date: formatDate(sale.sale_date ?? sale.created_at, ctx.locale),
            companyName: ctx.challanHeader.companyName,
            headerConfig: ctx.challanHeader.headerConfig,
            customerName: sale.customer?.name,
            customerPhone: sale.customer?.phone ?? undefined,
            deliveryAddress: sale.customer?.address ?? undefined,
            items: sale.items.map((i) => ({
                name: itemName(i, ctx.unknownProductLabel),
                sku: i.product?.sku ?? undefined,
                quantity: i.quantity,
            })),
            note: sale.note ?? undefined,
            labels: ctx.challanLabels,
        },
        size,
        previewFor('challan', size, ctx, skipPreview),
    );
}

/** The thermal till receipt, with its QR code. */
export async function printSaleReceipt(
    sale: PrintableSale,
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview = false,
): Promise<void> {
    const items = sale.items.map((i) => ({
        name: itemName(i, ctx.unknownProductLabel),
        quantity: i.quantity,
        unitPrice: unitPrice(i),
    }));
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    await printPOSReceipt(
        {
            invoiceId: sale.id,
            serialNumber: sale.serial_number,
            storeName: ctx.invoiceHeader.companyName,
            headerConfig: ctx.invoiceHeader.headerConfig,
            date: formatDateTime(sale.sale_date ?? sale.created_at, ctx.locale),
            customerName: sale.customer?.name,
            items,
            payments: (sale.payments ?? []).map((p) => ({
                method: paymentMethod(p),
                amount: paymentAmount(p),
                reference: paymentInstrumentSummary(p as any),
            })),
            subtotal,
            tax: 0,
            total: parseFloat(sale.total_amount) || subtotal,
            amountPaid: parseFloat(sale.amount_paid) || 0,
            note: sale.note ?? undefined,
        },
        // A receipt on A4 wastes a page — the till roll is the sensible default
        // whatever the invoice is set to, unless a roll was already chosen.
        size === 'Thermal58' ? size : 'Thermal80',
        previewFor('receipt', size, ctx, skipPreview),
    );
}

/** Formatted total, for the confirmation copy a caller may want to show. */
export function saleTotalLabel(sale: PrintableSale, locale: string): string {
    return formatBDT(parseFloat(sale.total_amount) || 0, { locale });
}
