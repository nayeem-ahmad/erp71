'use client';

import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { quotationQrDataUrl } from '@/lib/invoice-qr';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printSalesQuotation, type PrintableQuotation } from '@/lib/sales-quotation-printer';
import { useInvoicePrintPrefs } from './useInvoicePrintPrefs';
import { printedByName } from './useSalePrinting';

/**
 * Prints a quotation on the detailed design, shared by the quotations list and
 * the quotation's own page so the two print the same paper.
 *
 * Everything is resolved on the click, for the quotation in hand: its own
 * branch's letterhead (a proforma's from the Proforma Invoice template), the
 * member's invoice layout, who is printing and the QR code.
 */
export function useQuotationPrinting() {
    const { t, locale } = useI18n();
    const quoteHeader = usePrintHeader('QUOTE', { eager: false });
    const proformaHeader = usePrintHeader('PROFORMA_INVOICE', { eager: false });
    const { resolve: resolveLayout } = useInvoicePrintPrefs();
    /** The quotation being prepared for print, so its trigger can wait. */
    const [printingId, setPrintingId] = useState<string | null>(null);

    const printQuotation = useCallback(
        async (quote: PrintableQuotation) => {
            setPrintingId(quote.id);
            try {
                const header = quote.doc_kind === 'PROFORMA' ? proformaHeader : quoteHeader;
                // Each of these falls back rather than failing, so the quotation
                // always prints — at worst without a letterhead template or a code.
                const [letterhead, layout, printedBy, qrDataUrl] = await Promise.all([
                    header.resolve(quote.store_id ?? undefined),
                    resolveLayout(),
                    printedByName(),
                    quotationQrDataUrl(quote.id),
                ]);
                const opened = printSalesQuotation(
                    quote,
                    {
                        companyName: letterhead.companyName,
                        headerConfig: letterhead.headerConfig,
                        locale,
                        unknownProductLabel: t.shared.unknownProduct,
                        printedBy,
                        qrDataUrl,
                    },
                    layout,
                );
                if (!opened) toast.error(t.sales.printMenu.popupBlocked);
            } finally {
                setPrintingId(null);
            }
        },
        [quoteHeader, proformaHeader, resolveLayout, locale, t],
    );

    return { printQuotation, printingId };
}
