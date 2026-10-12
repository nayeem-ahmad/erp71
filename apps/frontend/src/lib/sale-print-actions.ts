import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import { paymentInstrumentSummary } from '@/lib/payment-instrument';
import { invoiceQrDataUrl } from '@/lib/invoice-qr';
import { enteredBeforeVat, enteredUnitPrice } from '@/lib/sale-vat';
import { printSalesInvoice, printSalesInvoices, type InvoiceData, type PaperSize } from '@/lib/sales-invoice-printer';
import { printDeliveryChallan } from '@/lib/delivery-challan-printer';
import { printPOSReceipt } from '@/lib/pos-receipt-printer';
import { paperSizeLabel } from '@/lib/print';
import type { PrintPreviewOptions } from '@/lib/print';
import type { DeepPartial, PrintHeaderConfig } from '@/lib/print';
import type { InvoicePrintPrefs } from '@erp71/shared-types';

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
    customer?: { name?: string; phone?: string | null; address?: string | null; customer_code?: string | null } | null;
    items: {
        quantity: number;
        /** The list endpoint says `price_at_sale`; the cart says `price`. */
        price_at_sale?: string | number;
        price?: number;
        discount?: number;
        name?: string;
        product?: {
            name?: string;
            sku?: string | null;
            warranty_enabled?: boolean;
            warranty_duration_days?: number | null;
            vat_rate?: string | number | null;
            sd_rate?: string | number | null;
        } | null;
        /** The rates the stored line was taxed at (its snapshot). */
        vat_rate?: string | number | null;
        sd_rate?: string | number | null;
    }[];
    payments?: { payment_method?: string; method?: string; amount: string | number }[];
    /**
     * What the customer owed before this sale, as the sale endpoints report it.
     * Null for a walk-in or a cancelled sale, and then the invoice prints no
     * dues at all.
     */
    previous_due?: number | null;
    /**
     * Tax contained in the total, stored with the sale when it was posted. The
     * invoice reads it rather than working it out again from today's rates.
     */
    vat_amount?: string | number | null;
    sd_amount?: string | number | null;
    /** False when the sale was entered before VAT, with the tax added on top. */
    prices_include_vat?: boolean | null;
    /** The order the sale was raised from, when it was. */
    salesOrder?: { order_number?: string | null } | null;
    /** Name of the user who entered the sale, as the print endpoints resolve it. */
    prepared_by?: string | null;
    /** The employee the sale is credited to ("Sales By"). */
    salesRep?: { id?: string; name?: string | null } | null;
    /**
     * The branch the sale was rung up at. Its letterhead and name print on the
     * sale's documents, whatever branch the operator has selected now.
     */
    store_id?: string | null;
    store?: { id?: string; name?: string; address?: string | null } | null;
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
    /** The signed-in user printing, named on the detailed invoice's print line. */
    printedBy?: string;
    /** The printing member's invoice layout; the built-in one when omitted. */
    invoiceLayout?: InvoicePrintPrefs;
}

function itemName(item: PrintableSale['items'][number], fallback: string): string {
    return item.name ?? item.product?.name ?? fallback;
}

function unitPrice(item: PrintableSale['items'][number]): number {
    if (typeof item.price === 'number') return item.price;
    const raw = item.price_at_sale;
    return typeof raw === 'number' ? raw : parseFloat(raw ?? '0') || 0;
}

/** "6 months" for a product's warranty period; empty when it carries none. */
function warrantyLabel(product: PrintableSale['items'][number]['product']): string | undefined {
    const days = product?.warranty_duration_days;
    if (!product?.warranty_enabled || !days || days <= 0) return undefined;
    const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (days % 365 === 0) return plural(days / 365, 'year');
    if (days % 30 === 0) return plural(days / 30, 'month');
    return plural(days, 'day');
}

/** A stored decimal as a number, or undefined when the sale does not carry it. */
function storedAmount(value: string | number | null | undefined): number | undefined {
    if (value == null) return undefined;
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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
    /** A batch names its count instead of one document. */
    count?: number,
): PrintPreviewOptions | undefined {
    if (skipPreview) return undefined;

    const copy = ctx.menuLabels.preview;
    const documentName = count != null
        ? copy.invoices.replace('{count}', String(count))
        : doc === 'invoice' ? copy.invoice : doc === 'challan' ? copy.challan : copy.receipt;

    return {
        title: copy.heading
            .replace('{document}', documentName)
            .replace('{size}', paperSizeLabel(size)),
        printLabel: copy.print,
        closeLabel: copy.close,
        skipLabel: copy.skip,
    };
}

/** VAT plus SD stored with the sale, or undefined when it carries neither column. */
function taxInside(sale: PrintableSale): number | undefined {
    const vat = storedAmount(sale.vat_amount);
    const sd = storedAmount(sale.sd_amount);
    return vat === undefined && sd === undefined ? undefined : (vat ?? 0) + (sd ?? 0);
}

/**
 * The sale's own invoice — the commercial document, prices and all.
 *
 * Totals are summed from the lines here rather than read off `total_amount`,
 * because a list row carries the stored total while the detail screen may hold
 * edited lines that have not been saved; taking the lines makes what prints
 * match what is on screen either way.
 *
 * Shared with the batch printer so a row and a selection cannot drift.
 *
 * A sale entered before VAT (`prices_include_vat === false`) prints the way it
 * was entered: before-VAT unit prices, then the discount, the VAT added on top
 * and the total — the stored VAT, so the invoice agrees with its Mushak.
 */
export function saleToInvoiceData(sale: PrintableSale, ctx: SalePrintContext): InvoiceData {
    const beforeVat = enteredBeforeVat(sale);
    const items = sale.items.map((i) => ({
        name: itemName(i, ctx.unknownProductLabel),
        sku: i.product?.sku ?? undefined,
        quantity: i.quantity,
        // A stored line is VAT-inclusive; one entered before VAT is taken back
        // to its typed price. A cart line (`price`) already holds that price.
        unitPrice: beforeVat && typeof i.price !== 'number' ? enteredUnitPrice(i) : unitPrice(i),
        discount: i.discount || 0,
        warranty: warrantyLabel(i.product),
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

    // Entered before VAT: the stored VAT is added to the before-VAT lines, and
    // whatever is left between those and the total is the discount (or, above
    // it, an adjustment) — so the printed block always foots.
    const tax = taxInside(sale) ?? 0;
    const gap = Math.round((subtotal + tax - total) * 100) / 100;
    const amounts = beforeVat
        ? {
            discountAmount: gap > 0.005 ? gap : undefined,
            rounding: gap < -0.005 ? -gap : undefined,
            vat: tax > 0.005 ? tax : undefined,
            taxIncluded: undefined,
        }
        : {
            // The difference between the lines and the stored total is whatever
            // invoice-level adjustment was applied; showing it as rounding is
            // closer than silently printing a total the lines do not sum to.
            rounding: Math.abs(total - subtotal) > 0.005 ? total - subtotal : undefined,
            // Both stored columns, or neither: a sale carrying only one would read
            // as having no tax inside it rather than an unknown amount.
            taxIncluded: taxInside(sale),
        };

    return {
        referenceNumber: sale.reference_number || sale.serial_number,
        date: formatDate(sale.sale_date ?? sale.created_at, ctx.locale),
        companyName: ctx.invoiceHeader.companyName,
        storeName: sale.store?.name,
        companyAddress: sale.store?.address || undefined,
        headerConfig: ctx.invoiceHeader.headerConfig,
        customerName: sale.customer?.name,
        customerCode: sale.customer?.customer_code ?? undefined,
        customerPhone: sale.customer?.phone ?? undefined,
        shippingAddress: sale.customer?.address ?? undefined,
        orderNumber: sale.salesOrder?.order_number ?? undefined,
        preparedBy: sale.prepared_by ?? undefined,
        salesBy: sale.salesRep?.name ?? undefined,
        printedBy: ctx.printedBy,
        items,
        payments,
        subtotal,
        ...amounts,
        total,
        amountPaid,
        previousDue: sale.previous_due,
        note: sale.note ?? undefined,
    };
}

/**
 * The code the detailed layout prints, or nothing for any other layout — which
 * would not use it, and should not wait on it.
 */
async function qrFor(sale: PrintableSale, ctx: SalePrintContext): Promise<string | undefined> {
    return ctx.invoiceLayout?.layout === 'detailed' ? invoiceQrDataUrl(sale.id) : undefined;
}

export async function printSaleInvoice(
    sale: PrintableSale,
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview = false,
): Promise<void> {
    // Drawn before the window opens, so the page is complete when it appears.
    const qrDataUrl = await qrFor(sale, ctx);
    printSalesInvoice(
        { ...saleToInvoiceData(sale, ctx), qrDataUrl },
        size,
        previewFor('invoice', size, ctx, skipPreview),
        ctx.invoiceLayout,
    );
}

/**
 * The checked rows, as one print job. False when the browser blocked the window.
 *
 * `headerFor` gives each sale its own branch's letterhead, since a selection
 * can span branches; without it every sheet takes `ctx.invoiceHeader`.
 */
export async function printSaleInvoices(
    sales: PrintableSale[],
    size: PaperSize,
    ctx: SalePrintContext,
    skipPreview = false,
    headerFor: (sale: PrintableSale) => SalePrintContext['invoiceHeader'] = () => ctx.invoiceHeader,
): Promise<boolean> {
    const codes = await Promise.all(sales.map((sale) => qrFor(sale, ctx)));
    const opened = printSalesInvoices(
        sales.map((sale, i) => ({
            ...saleToInvoiceData(sale, { ...ctx, invoiceHeader: headerFor(sale) }),
            qrDataUrl: codes[i],
        })),
        size,
        previewFor('invoice', size, ctx, skipPreview, sales.length),
        ctx.invoiceLayout,
    );
    return opened != null;
}

/** The branch a sale was rung up at — whose letterhead its documents carry. */
export function saleStoreId(sale: PrintableSale): string | undefined {
    return sale.store_id ?? sale.store?.id ?? undefined;
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
            storeName: sale.store?.name,
            companyAddress: sale.store?.address || undefined,
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
            companyName: ctx.invoiceHeader.companyName,
            storeName: sale.store?.name,
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
