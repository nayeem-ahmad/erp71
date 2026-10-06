'use client';

import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import {
    printSaleChallan,
    printSaleInvoice,
    printSaleInvoices,
    printSaleReceipt,
    saleStoreId,
    type PrintableSale,
    type SalePrintContext,
} from '@/lib/sale-print-actions';
import { useSalePrintPrefs } from './useSalePrintPrefs';
import { useInvoicePrintPrefs } from './useInvoicePrintPrefs';

/**
 * Wires the print menu to the printers, with the letterhead and labels already
 * resolved.
 *
 * `resolve` is how a caller says where the sale data comes from. The detail
 * screen hands back what is on screen, so an edited line prints as edited; the
 * list hands back a fetch, because a list row carries no line items and
 * printing one would produce an invoice with no goods on it.
 */
export interface UseSalePrintingOptions {
    resolve: (saleId: string) => PrintableSale | null | Promise<PrintableSale | null>;
}

export function useSalePrinting({ resolve }: UseSalePrintingOptions) {
    const { t, locale, fmt } = useI18n();
    const invoiceHeader = usePrintHeader('SALES_INVOICE');
    // Its own template, so a shop can put a plainer letterhead on the copy a
    // rider carries than on the invoice the customer keeps.
    const challanHeader = usePrintHeader('DELIVERY_CHALLAN');
    const { paperSize, setPaperSize, skipPreview, setSkipPreview, density, setDensity } =
        useSalePrintPrefs();
    const { resolve: resolveInvoiceLayout } = useInvoicePrintPrefs();

    /** The row currently being fetched, so its trigger can show a spinner. */
    const [busyId, setBusyId] = useState<string | null>(null);
    /** A bulk print is in flight — one request for the whole selection. */
    const [batchBusy, setBatchBusy] = useState(false);

    const ctx: SalePrintContext = useMemo(
        () => ({
            invoiceHeader,
            challanHeader,
            locale,
            challanLabels: t.sales.challan,
            menuLabels: t.sales.printMenu,
            unknownProductLabel: t.shared.unknownProduct,
        }),
        [invoiceHeader, challanHeader, locale, t],
    );

    /**
     * Loads the sale, then resolves both letterheads for the sale's own store —
     * never the headers resolved on mount, which belong to no store. Reprinting
     * a Dhanmondi sale while the switcher is on Gulshan still prints Dhanmondi
     * paper.
     */
    const withSale = useCallback(
        async (
            saleId: string,
            print: (sale: PrintableSale, ctx: SalePrintContext) => void | Promise<void>,
        ) => {
            setBusyId(saleId);
            try {
                const sale = await resolve(saleId);
                if (!sale) {
                    toast.error(t.sales.printMenu.loadFailed);
                    return;
                }
                const storeId = saleStoreId(sale);
                const [invoice, challan, invoiceLayout, printedBy] = await Promise.all([
                    invoiceHeader.resolve(storeId),
                    challanHeader.resolve(storeId),
                    // The member's own layout, waited on so the first print
                    // after a page load is not the built-in one by accident.
                    resolveInvoiceLayout(),
                    printedByName(),
                ]);
                await print(sale, { ...ctx, invoiceHeader: invoice, challanHeader: challan, invoiceLayout, printedBy });
            } catch (error) {
                console.error('Failed to print sale document', error);
                toast.error(t.sales.printMenu.loadFailed);
            } finally {
                setBusyId(null);
            }
        },
        [resolve, t, ctx, invoiceHeader, challanHeader, resolveInvoiceLayout],
    );

    const printInvoice = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale, saleCtx) => printSaleInvoice(sale, size, saleCtx, skipPreview)),
        [withSale, skipPreview],
    );

    const printChallan = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale, saleCtx) => printSaleChallan(sale, size, saleCtx, skipPreview)),
        [withSale, skipPreview],
    );

    const printReceipt = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale, saleCtx) => printSaleReceipt(sale, size, saleCtx, skipPreview)),
        [withSale, skipPreview],
    );

    /**
     * The checked rows as one print job: one request for the sales, then one
     * letterhead per branch among them — never one per sale.
     */
    const printInvoices = useCallback(
        async (ids: string[]) => {
            const unique = [...new Set(ids.filter(Boolean))];
            if (unique.length === 0) return;

            setBatchBusy(true);
            try {
                const sales = await api.printSalesBatch(unique);
                const loaded: PrintableSale[] = Array.isArray(sales) ? sales : [];
                if (loaded.length === 0) {
                    toast.error(t.sales.printMenu.bulkFailed);
                    return;
                }
                const loadedIds = new Set(loaded.map((sale) => sale.id));
                const skipped = unique.filter((id) => !loadedIds.has(id)).length;
                if (skipped > 0) {
                    toast.info(fmt(t.sales.printMenu.bulkPartial, { skipped, total: unique.length }));
                }

                const storeIds = [...new Set(loaded.map(saleStoreId))];
                const [headers, invoiceLayout, printedBy] = await Promise.all([
                    Promise.all(storeIds.map((storeId) => invoiceHeader.resolve(storeId))),
                    resolveInvoiceLayout(),
                    printedByName(),
                ]);
                const headerByStore = new Map(storeIds.map((storeId, i) => [storeId, headers[i]]));

                const opened = await printSaleInvoices(
                    loaded,
                    paperSize,
                    { ...ctx, invoiceLayout, printedBy },
                    skipPreview,
                    (sale) => headerByStore.get(saleStoreId(sale)) ?? ctx.invoiceHeader,
                );
                if (!opened) toast.error(t.sales.printMenu.popupBlocked);
            } catch (error) {
                console.error('Failed to print invoices', error);
                toast.error(t.sales.printMenu.bulkFailed);
            } finally {
                setBatchBusy(false);
            }
        },
        [paperSize, ctx, skipPreview, t, fmt, invoiceHeader, resolveInvoiceLayout],
    );

    // `skipPreview` is passed back out so a screen can offer it as a setting
    // rather than leaving the preview popup's own checkbox as the only way to
    // turn it off — one that is unreachable once it has been used.
    return {
        paperSize,
        setPaperSize,
        skipPreview,
        setSkipPreview,
        density,
        setDensity,
        busyId,
        batchBusy,
        printInvoice,
        printChallan,
        printReceipt,
        printInvoices,
    };
}

/**
 * The signed-in user's name, for "Printed … by …" on the invoice. Read from
 * the cached profile, so it costs no request after the first; a print never
 * waits on it failing — the line just goes without a name.
 */
async function printedByName(): Promise<string | undefined> {
    try {
        const me: any = await api.getCurrentUser();
        return me?.name?.trim() || me?.email || undefined;
    } catch {
        return undefined;
    }
}

/** Fetches the full sale — the list's `resolve`, where rows have no lines. */
export function fetchPrintableSale(saleId: string): Promise<PrintableSale | null> {
    return api.getSale(saleId).then((sale: any) => sale ?? null);
}
