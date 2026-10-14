'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Ban, Copy, Eye, FileCheck, MoreHorizontal, Receipt, Undo2 } from 'lucide-react';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import type { PaperSize } from '@/lib/sales-invoice-printer';

interface SaleRowOverflowMenuProps {
    saleId: string;
    /** Cancel is hidden without the grant, and absent on an already-void entry. */
    onCancel?: () => void;
    /**
     * Offer Sales Return and Exchange against this sale. Off for a draft or a
     * cancelled sale and without CREATE_RETURN — the API refuses all three.
     */
    canReturn?: boolean;
    /** The size the occasional documents print at — the counter's remembered one. */
    paperSize: PaperSize;
    onPrintReceipt: (size: PaperSize) => void;
    /**
     * Mushak 6.3 is a statutory form with no shop-configurable layout — hide it
     * where the document is not VAT-bearing.
     */
    showMushak?: boolean;
    /**
     * Accessible name for the trigger. Deliberately not "Actions": the table's
     * own column-header control already carries that name, and two buttons
     * answering to it makes the row menu unaddressable.
     */
    label: string;
}

/**
 * The secondary row actions, behind a kebab.
 *
 * Duplicate and Cancel live here rather than inline because the actions column
 * already carries view, print, edit and delete; a sixth and seventh icon pushed
 * the column past its width on a laptop and started truncating the totals
 * beside it. Everything reachable here is also reachable from the sale itself.
 *
 * The till receipt, the Mushak 6.3 and the on-screen invoice page joined them
 * when the row's print split button was unpacked into two plain icons. Invoice
 * and chalan are printed on nearly every sale and earn their own icon; these
 * three are occasional, so a menu is the right cost for them.
 */
export default function SaleRowOverflowMenu({
    saleId,
    onCancel,
    canReturn = false,
    label,
    paperSize,
    onPrintReceipt,
    showMushak = true,
}: SaleRowOverflowMenuProps) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const isInside = useCallback(
        (target: Node) =>
            !!wrapRef.current?.contains(target) || !!panelRef.current?.contains(target),
        [],
    );
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    const itemClass =
        'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-start text-sm text-gray-700 hover:bg-gray-50 min-h-touch sm:min-h-0';

    return (
        <div className="relative" ref={wrapRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <MoreHorizontal className="h-4 w-4" />
            </button>

            {open ? (
                <AnchoredDropdown
                    anchorRef={wrapRef}
                    panelRef={panelRef}
                    matchAnchorWidth={false}
                    align="end"
                    role="menu"
                    aria-label={label}
                    className="py-1"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false);
                            onPrintReceipt(paperSize);
                        }}
                        className={itemClass}
                    >
                        <Receipt className="h-4 w-4 text-gray-400" />
                        {t.sales.printMenu.posReceipt}
                    </button>
                    {showMushak && (
                        <Link
                            href={routes.sales.mushak(saleId)}
                            role="menuitem"
                            onClick={() => setOpen(false)}
                            className={itemClass}
                        >
                            <FileCheck className="h-4 w-4 text-gray-400" />
                            {t.sales.printMenu.mushak}
                        </Link>
                    )}
                    <Link
                        href={routes.sales.invoice(saleId)}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className={itemClass}
                    >
                        <Eye className="h-4 w-4 text-gray-400" />
                        {t.sales.printMenu.openInvoicePage}
                    </Link>

                    <div className="my-1 border-t" />

                    <Link
                        href={`/sales/new?duplicate=${saleId}`}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className={itemClass}
                    >
                        <Copy className="h-4 w-4 text-gray-400" />
                        {t.common.duplicate}
                    </Link>
                    {/* Both entry screens load the sale from `saleId`, so the
                        counter never retypes the invoice number it clicked on. */}
                    {canReturn && (
                        <>
                            <Link
                                href={`${routes.sales.returnNew}?saleId=${saleId}`}
                                role="menuitem"
                                onClick={() => setOpen(false)}
                                className={itemClass}
                            >
                                <Undo2 className="h-4 w-4 text-gray-400" />
                                {t.sales.printMenu.salesReturn}
                            </Link>
                            <Link
                                href={`${routes.sales.exchangeNew}?saleId=${saleId}`}
                                role="menuitem"
                                onClick={() => setOpen(false)}
                                className={itemClass}
                            >
                                <ArrowLeftRight className="h-4 w-4 text-gray-400" />
                                {t.sales.printMenu.exchange}
                            </Link>
                        </>
                    )}
                    {onCancel && (
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                onCancel();
                            }}
                            className={`${itemClass} text-red-600 hover:bg-red-50`}
                        >
                            <Ban className="h-4 w-4" />
                            {t.entryCancellation.action}
                        </button>
                    )}
                </AnchoredDropdown>
            ) : null}
        </div>
    );
}
