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
    printSaleReceipt,
    type PrintableSale,
    type SalePrintContext,
} from '@/lib/sale-print-actions';
import { useSalePrintPrefs } from './useSalePrintPrefs';

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
    const { t, locale } = useI18n();
    const invoiceHeader = usePrintHeader('SALES_INVOICE');
    // Its own template, so a shop can put a plainer letterhead on the copy a
    // rider carries than on the invoice the customer keeps.
    const challanHeader = usePrintHeader('DELIVERY_CHALLAN');
    const { paperSize, setPaperSize, skipPreview } = useSalePrintPrefs();

    /** The row currently being fetched, so its trigger can show a spinner. */
    const [busyId, setBusyId] = useState<string | null>(null);

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

    const withSale = useCallback(
        async (saleId: string, print: (sale: PrintableSale) => void | Promise<void>) => {
            setBusyId(saleId);
            try {
                const sale = await resolve(saleId);
                if (!sale) {
                    toast.error(t.sales.printMenu.loadFailed);
                    return;
                }
                await print(sale);
            } catch (error) {
                console.error('Failed to print sale document', error);
                toast.error(t.sales.printMenu.loadFailed);
            } finally {
                setBusyId(null);
            }
        },
        [resolve, t],
    );

    const printInvoice = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale) => printSaleInvoice(sale, size, ctx, skipPreview)),
        [withSale, ctx, skipPreview],
    );

    const printChallan = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale) => printSaleChallan(sale, size, ctx, skipPreview)),
        [withSale, ctx, skipPreview],
    );

    const printReceipt = useCallback(
        (saleId: string, size: PaperSize) =>
            withSale(saleId, (sale) => printSaleReceipt(sale, size, ctx, skipPreview)),
        [withSale, ctx, skipPreview],
    );

    return { paperSize, setPaperSize, busyId, printInvoice, printChallan, printReceipt };
}

/** Fetches the full sale — the list's `resolve`, where rows have no lines. */
export function fetchPrintableSale(saleId: string): Promise<PrintableSale | null> {
    return api.getSale(saleId).then((sale: any) => sale ?? null);
}
