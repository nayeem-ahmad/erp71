'use client';

import { Printer, Truck } from 'lucide-react';
import { RowActionButton } from '@/components/table';
import { useI18n } from '@/lib/i18n';
import type { PaperSize } from '@/lib/sales-invoice-printer';

export interface SaleRowPrintButtonsProps {
    paperSize: PaperSize;
    onPrintInvoice: (size: PaperSize) => void;
    onPrintChallan: (size: PaperSize) => void;
    /** Spinner on both triggers while the caller fetches the sale it needs. */
    busy?: boolean;
}

/**
 * The two documents a sales row is printed as, one click each.
 *
 * These used to sit behind a split button with the paper sizes, the receipt,
 * the Mushak and the invoice page — which made the chalan, printed on every
 * delivery, a two-click menu scan. Invoice and chalan are the whole daily job,
 * so they get an icon apiece; everything rarer moved into the row's kebab, and
 * the paper size moved to the header's print settings, where it is set once per
 * counter rather than re-chosen on every row.
 *
 * No dropdown here at all, which is also why there is no `AnchoredDropdown`
 * clipping problem to solve inside the table's scroll container.
 */
export default function SaleRowPrintButtons({
    paperSize,
    onPrintInvoice,
    onPrintChallan,
    busy = false,
}: SaleRowPrintButtonsProps) {
    const { t } = useI18n();
    const copy = t.sales.printMenu;
    const pulse = busy ? 'animate-pulse' : undefined;

    return (
        <>
            <RowActionButton
                icon={<Printer className={pulse} />}
                label={copy.printInvoice}
                onClick={() => onPrintInvoice(paperSize)}
                disabled={busy}
            />
            <RowActionButton
                icon={<Truck className={pulse} />}
                label={t.sales.challan.action}
                onClick={() => onPrintChallan(paperSize)}
                disabled={busy}
            />
        </>
    );
}
