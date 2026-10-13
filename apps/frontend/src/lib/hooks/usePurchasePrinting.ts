'use client';

import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { purchaseQrDataUrl } from '@/lib/invoice-qr';
import { isThermalPaper } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import {
    printPurchaseInvoiceFromRecord,
    type PurchasePrintContext,
} from '@/lib/purchase-print-actions';
import { useSalePrintPrefs } from './useSalePrintPrefs';
import { useInvoicePrintPrefs } from './useInvoicePrintPrefs';
import { printedByName } from './useSalePrinting';

/**
 * Wires the purchases-list print button to the printer, with letterhead and
 * labels already resolved.
 *
 * Paper size, skip-preview and compact ride on the same device prefs as sales:
 * the printer next to this browser is one printer, and the counter should not
 * restate the size for every document family.
 */
export function usePurchasePrinting() {
    const { t, locale } = useI18n();
    const header = usePrintHeader('PURCHASE_INVOICE');
    const { paperSize, setPaperSize, skipPreview, setSkipPreview, density, setDensity, typeScale, setTypeScale } =
        useSalePrintPrefs();
    // The member's sales invoice layout: a member on the detailed invoice gets
    // the purchase receipt on the same design.
    const { resolve: resolveInvoiceLayout } = useInvoicePrintPrefs();

    const [busyId, setBusyId] = useState<string | null>(null);

    const ctx: PurchasePrintContext = useMemo(
        () => ({
            header,
            locale,
            invoiceLabels: t.purchases.invoice,
            menuLabels: t.sales.printMenu,
            unknownProductLabel: t.purchases.invoice.unknownProduct,
            supplierLabel: t.purchases.columns.supplier,
            dateLabel: t.common.date,
            branchLabel: t.common.branch,
        }),
        [header, locale, t],
    );

    const printInvoice = useCallback(
        async (purchaseId: string, size: PaperSize) => {
            setBusyId(purchaseId);
            try {
                const data: any = await api.getPurchaseInvoice(purchaseId);
                if (!data?.purchase) {
                    toast.error(t.purchases.printLoadFailed);
                    return;
                }
                // The purchase's own branch letterhead, not the one resolved on mount.
                const storeId = data.purchase.store_id ?? data.purchase.store?.id ?? undefined;
                const [purchaseHeader, invoiceLayout, printedBy] = await Promise.all([
                    header.resolve(storeId),
                    resolveInvoiceLayout(),
                    printedByName(),
                ]);
                // Only the detailed design prints the code, so only it waits on one.
                const qrDataUrl = !isThermalPaper(size) && invoiceLayout.layout === 'detailed'
                    ? await purchaseQrDataUrl(purchaseId)
                    : undefined;
                printPurchaseInvoiceFromRecord(
                    data.purchase,
                    size,
                    { ...ctx, header: purchaseHeader, invoiceLayout, printedBy, qrDataUrl },
                    skipPreview,
                );
            } catch (error) {
                console.error('Failed to print purchase document', error);
                toast.error(t.purchases.printLoadFailed);
            } finally {
                setBusyId(null);
            }
        },
        [ctx, header, resolveInvoiceLayout, skipPreview, t],
    );

    return {
        paperSize,
        setPaperSize,
        skipPreview,
        setSkipPreview,
        density,
        setDensity,
        typeScale,
        setTypeScale,
        busyId,
        printInvoice,
    };
}
