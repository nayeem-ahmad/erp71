'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Eye, FileCheck, Printer, Receipt, Square, SquareCheck, Truck } from 'lucide-react';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { usePrintDensity } from '@/lib/print/use-print-density';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/sales-invoice-printer';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';

export interface SalePrintMenuProps {
    /** Which sale the "other documents" entries point at. */
    saleId: string;
    paperSize: PaperSize;
    onPaperSizeChange: (size: PaperSize) => void;
    /** Print the invoice at this size. */
    onPrintInvoice: (size: PaperSize) => void;
    onPrintChallan: (size: PaperSize) => void;
    onPrintReceipt: (size: PaperSize) => void;
    /**
     * Icon-only, for a table row where the label would not fit. The split
     * button still prints on the main half; only the wording is dropped.
     */
    compact?: boolean;
    /** Spinner on the trigger while the caller fetches the sale it needs. */
    busy?: boolean;
    /** Mushak is a statutory form with no shop-configurable layout — hide it
     *  where the document is not VAT-bearing. */
    showMushak?: boolean;
}

/**
 * Everything a sale can be printed as, behind one split button.
 *
 * The main half prints the invoice at the remembered size, which is the answer
 * nearly every time; the chevron opens the rest — the other paper sizes, the
 * challan, the till receipt, the Mushak 6.3 and the on-screen invoice page.
 * Grouping them here is what lets the sales list carry all six actions without
 * six icons in the row, and it means the three screens that print a sale cannot
 * drift apart in what they offer.
 *
 * Under the sizes sits the Compact switch. It is a setting, not a print — it
 * keeps the menu open so a size can be picked next — and it is the same
 * remembered answer the print window's own switch and the sales list's print
 * settings show, so the three always agree.
 *
 * The panel goes through `AnchoredDropdown` rather than being an `absolute`
 * child: on the detail screen this button sits inside the entry layout's 320px
 * `overflow-hidden` sidebar, where an in-flow panel wider than the column gets
 * clipped at its edge. In a table row the same applies to the scroll container.
 */
export default function SalePrintMenu({
    saleId,
    paperSize,
    onPaperSizeChange,
    onPrintInvoice,
    onPrintChallan,
    onPrintReceipt,
    compact = false,
    busy = false,
    showMushak = true,
}: SalePrintMenuProps) {
    const { t } = useI18n();
    const copy = t.sales.printMenu;
    const [density, setDensity] = usePrintDensity();
    // Not `compact` — that prop already means the icon-only trigger.
    const printsCompact = density === 'compact';
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // The panel is portalled out of the wrapper, so the click-outside test has
    // to count it as "inside" or choosing a size would dismiss the menu first.
    const isInside = useCallback(
        (target: Node) =>
            !!wrapRef.current?.contains(target) || !!panelRef.current?.contains(target),
        [],
    );
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    const chooseSize = (size: PaperSize) => {
        onPaperSizeChange(size);
        setOpen(false);
        onPrintInvoice(size);
    };

    const run = (action: (size: PaperSize) => void) => {
        setOpen(false);
        action(paperSize);
    };

    const itemClass =
        'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-start text-sm text-gray-700 hover:bg-gray-50 min-h-touch sm:min-h-0';
    const headingClass =
        'px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400';

    return (
        <div className="relative" ref={wrapRef}>
            <div className="flex items-center overflow-hidden rounded border">
                <button
                    type="button"
                    onClick={() => onPrintInvoice(paperSize)}
                    disabled={busy}
                    className={`flex items-center gap-1.5 text-gray-700 hover:bg-gray-50 disabled:text-gray-300 ${
                        compact ? 'px-2 py-1.5' : 'px-3 py-2 text-sm'
                    }`}
                    title={copy.printInvoice}
                >
                    <Printer className={`${busy ? 'animate-pulse' : ''} h-4 w-4`} />
                    {!compact && paperSize}
                </button>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="border-s px-1.5 py-2 text-gray-500 hover:bg-gray-50"
                    title={copy.trigger}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={copy.trigger}
                >
                    <ChevronDown className="h-4 w-4" />
                </button>
            </div>

            {open ? (
                <AnchoredDropdown
                    anchorRef={wrapRef}
                    panelRef={panelRef}
                    matchAnchorWidth={false}
                    align="end"
                    role="menu"
                    aria-label={copy.trigger}
                    className="py-1"
                >
                    <p className={headingClass}>{copy.printInvoice}</p>
                    {PAPER_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            role="menuitem"
                            onClick={() => chooseSize(size)}
                            className={`${itemClass} ${
                                paperSize === size ? 'font-semibold text-blue-600' : ''
                            }`}
                        >
                            {paperSizeLabel(size)}
                        </button>
                    ))}
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={printsCompact}
                        onClick={() => setDensity(printsCompact ? 'normal' : 'compact')}
                        title={t.components.printWindow.compactHint}
                        className={itemClass}
                    >
                        {printsCompact ? (
                            <SquareCheck className="h-4 w-4 text-blue-600" />
                        ) : (
                            <Square className="h-4 w-4 text-gray-400" />
                        )}
                        {t.components.printWindow.compact}
                    </button>

                    <div className="my-1 border-t" />
                    <p className={headingClass}>{copy.otherDocuments}</p>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => run(onPrintChallan)}
                        className={itemClass}
                    >
                        <Truck className="h-4 w-4 text-gray-400" />
                        {t.sales.challan.action}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => run(onPrintReceipt)}
                        className={itemClass}
                    >
                        <Receipt className="h-4 w-4 text-gray-400" />
                        {copy.posReceipt}
                    </button>
                    {showMushak && (
                        <Link
                            href={routes.sales.mushak(saleId)}
                            role="menuitem"
                            onClick={() => setOpen(false)}
                            className={itemClass}
                        >
                            <FileCheck className="h-4 w-4 text-gray-400" />
                            {copy.mushak}
                        </Link>
                    )}

                    <div className="my-1 border-t" />
                    <Link
                        href={routes.sales.invoice(saleId)}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className={itemClass}
                    >
                        <Eye className="h-4 w-4 text-gray-400" />
                        {copy.openInvoicePage}
                    </Link>
                </AnchoredDropdown>
            ) : null}
        </div>
    );
}
