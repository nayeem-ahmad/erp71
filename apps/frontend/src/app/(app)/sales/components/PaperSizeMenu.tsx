'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronDown, Printer, Square, SquareCheck } from 'lucide-react';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';
import { usePrintDensity } from '@/lib/print/use-print-density';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/sales-invoice-printer';

interface PaperSizeMenuProps {
    /** The size the split button prints at when its main half is clicked. */
    paperSize: PaperSize;
    onPaperSizeChange: (size: PaperSize) => void;
    /** Called with the chosen size — the caller prints at it. */
    onPrint: (size: PaperSize) => void;
    /** Heading over the list. */
    label: string;
    /** Tooltip on the chevron — says what the button does, not what it lists. */
    triggerLabel?: string;
}

/**
 * The print split button: print at the current size, or pick another.
 *
 * The menu goes through `AnchoredDropdown` rather than being an `absolute`
 * child, because a sale's action row sits inside the entry layout's 320px
 * sidebar, which is `overflow-hidden`. An in-flow panel wider than that column
 * was clipped at its edge — the paper-size list came out with its left half cut
 * off, so "80mm Thermal" read as "m Thermal". A portalled panel has no ancestor
 * overflow to be clipped by.
 *
 * It aligns to the anchor's right edge: the panel is wider than the chevron it
 * hangs off, and this button sits at the right of a row, so growing leftwards
 * is what keeps it both on screen and under its trigger.
 *
 * The Compact switch under the sizes is the remembered setting every print
 * surface shares (see `usePrintDensity`); flipping it keeps the menu open.
 */
export default function PaperSizeMenu({
    paperSize,
    onPaperSizeChange,
    onPrint,
    label,
    triggerLabel = 'Choose paper size',
}: PaperSizeMenuProps) {
    const { t } = useI18n();
    const [density, setDensity] = usePrintDensity();
    const compact = density === 'compact';
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

    const choose = (size: PaperSize) => {
        onPaperSizeChange(size);
        setOpen(false);
        onPrint(size);
    };

    return (
        <div className="relative" ref={wrapRef}>
            <div className="flex items-center border rounded overflow-hidden">
                <button
                    type="button"
                    onClick={() => onPrint(paperSize)}
                    className="px-3 py-2 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 text-sm"
                >
                    <Printer className="w-4 h-4" />
                    {paperSize}
                </button>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="px-1.5 py-2 border-s text-gray-500 hover:bg-gray-50"
                    title={triggerLabel}
                    aria-haspopup="menu"
                    aria-expanded={open}
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            </div>
            {open ? (
                <AnchoredDropdown
                    anchorRef={wrapRef}
                    panelRef={panelRef}
                    matchAnchorWidth={false}
                    align="end"
                    role="menu"
                    aria-label={triggerLabel}
                    className="py-1"
                >
                    <p className="px-3 py-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        {label}
                    </p>
                    {PAPER_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            role="menuitem"
                            onClick={() => choose(size)}
                            className={`block w-full whitespace-nowrap text-start px-3 py-1.5 text-sm hover:bg-gray-50 ${
                                paperSize === size ? 'font-bold text-blue-600' : 'text-gray-700'
                            }`}
                        >
                            {paperSizeLabel(size)}
                        </button>
                    ))}
                    <div className="my-1 border-t" />
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={compact}
                        onClick={() => setDensity(compact ? 'normal' : 'compact')}
                        title={t.components.printWindow.compactHint}
                        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-start text-sm text-gray-700 hover:bg-gray-50"
                    >
                        {compact ? (
                            <SquareCheck className="h-4 w-4 text-blue-600" />
                        ) : (
                            <Square className="h-4 w-4 text-gray-400" />
                        )}
                        {t.components.printWindow.compact}
                    </button>
                </AnchoredDropdown>
            ) : null}
        </div>
    );
}
