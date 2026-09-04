'use client';

import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import RateHistory, { type RateHistoryType } from './RateHistory';

interface RateHistoryPopoverProps {
    productId: string;
    /** Named in the header, so the operator knows which product they opened. */
    productName?: string;
    type: RateHistoryType;
    partyId?: string;
    partyName?: string;
    /** Nodes that must not count as "outside" — the trigger button, typically. */
    anchorRefs?: React.RefObject<HTMLElement | null>[];
    /** Adopt a rate. Picking one closes the popover — the choice is made. */
    onPickRate?: (rate: number) => void;
    onClose: () => void;
}

const HEADINGS: Record<RateHistoryType, string> = {
    sale: 'Previous sale rates',
    purchase: 'Previous purchase rates',
};

/**
 * Previous rates for the staged product, hung directly under the entry bar's
 * product box.
 *
 * A popover rather than a centred modal: the rate is being decided in the box
 * three fields to the right, and a full-screen overlay both hid that row and
 * cost a dialog's worth of mounting before the first number appeared.
 */
export default function RateHistoryPopover({
    productId,
    productName,
    type,
    partyId,
    partyName,
    anchorRefs = [],
    onPickRate,
    onClose,
}: RateHistoryPopoverProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    const isInside = useCallback(
        (target: Node) =>
            !!panelRef.current?.contains(target)
            || anchorRefs.some((ref) => ref.current?.contains(target)),
        // Refs are stable; spreading the array would re-arm the listener each render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );
    useDismissOnClickOutside(true, isInside, onClose);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    // The party is the comparison basis — whose rates lead the list — so the
    // header says which one, not just the product.
    const subtitle = [productName, partyName].filter(Boolean).join(' · ');

    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-label={HEADINGS[type]}
            className="absolute top-full start-0 z-50 mt-1 w-[min(34rem,calc(100vw-1.5rem))] rounded border bg-white shadow-lg"
        >
            <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900">{HEADINGS[type]}</div>
                    {subtitle && <div className="truncate text-[11px] text-gray-400">{subtitle}</div>}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="-me-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
            <div className="max-h-72 overflow-y-auto px-3 py-2">
                <RateHistory
                    productId={productId}
                    type={type}
                    partyId={partyId}
                    hideHeading
                    onPickRate={
                        onPickRate
                            ? (rate) => {
                                  onPickRate(rate);
                                  onClose();
                              }
                            : undefined
                    }
                />
            </div>
        </div>
    );
}
