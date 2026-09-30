'use client';

import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { usePrintHeader } from '@/lib/print/use-print-header';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import {
    printPurchaseInvoiceFromRecord,
    type PurchasePrintContext,
} from '@/lib/purchase-print-actions';
import { useSalePrintPrefs } from './useSalePrintPrefs';

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
    const { paperSize, setPaperSize, skipPreview, setSkipPreview, density, setDensity } =
        useSalePrintPrefs();

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
                printPurchaseInvoiceFromRecord(data.purchase, size, ctx, skipPreview);
            } catch (error) {
                console.error('Failed to print purchase document', error);
                toast.error(t.purchases.printLoadFailed);
            } finally {
                setBusyId(null);
            }
        },
        [ctx, skipPreview, t],
    );

    return {
        paperSize,
        setPaperSize,
        skipPreview,
        setSkipPreview,
        density,
        setDensity,
        busyId,
        printInvoice,
    };
}
