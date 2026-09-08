'use client';

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/** Space between the anchor and the panel. */
const GAP = 4;
/** Margin the panel keeps off the viewport edges. */
const EDGE = 8;
/** Below this much room under the anchor the panel flips above it. */
const MIN_ROOM_BELOW = 160;

interface AnchorBox {
    top: number;
    left: number;
    width: number;
    bottom: number;
}

const ZERO_BOX: AnchorBox = { top: 0, left: 0, width: 0, bottom: 0 };

interface AnchoredDropdownProps {
    /** The field the panel hangs off — usually the search input itself. */
    anchorRef: RefObject<HTMLElement | null>;
    /** Handed the panel element, so the owner's click-outside test can see it. */
    panelRef?: RefObject<HTMLDivElement | null>;
    /** Tallest the panel grows before it scrolls; trimmed to the room available. */
    maxHeight?: number;
    /**
     * Take the anchor's width. Off for panels with a width of their own, which
     * then only use the anchor's width as a floor.
     */
    matchAnchorWidth?: boolean;
    className?: string;
    role?: string;
    'aria-label'?: string;
    children: ReactNode;
}

/**
 * A dropdown panel rendered into `document.body` and pinned to its anchor.
 *
 * Entry screens hang their pickers over the line-items table, and an in-flow
 * `absolute` panel is at the mercy of everything above it: the table wrapper is
 * `overflow-hidden rounded bg-white`, which in WebKit gets its own compositing
 * layer and paints straight over a `z-50` sibling — the product list came out
 * sliced off at the table's top edge. Out in a portal the panel has no siblings
 * to lose to and no ancestor overflow to be clipped by, in any browser.
 */
export default function AnchoredDropdown({
    anchorRef,
    panelRef,
    maxHeight = 320,
    matchAnchorWidth = true,
    className = '',
    role,
    'aria-label': ariaLabel,
    children,
}: AnchoredDropdownProps) {
    const [box, setBox] = useState<AnchorBox>(ZERO_BOX);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    const measure = useCallback(() => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        setBox((previous) => (
            previous.top === rect.top
                && previous.left === rect.left
                && previous.width === rect.width
                && previous.bottom === rect.bottom
                ? previous
                : { top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom }
        ));
    }, [anchorRef]);

    useLayoutEffect(() => {
        measure();
        window.addEventListener('resize', measure);
        // Capture phase: the entry screen scrolls its item list, not the window.
        window.addEventListener('scroll', measure, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [measure]);

    if (!mounted) return null;

    const viewportHeight = window.innerHeight;
    const roomBelow = viewportHeight - box.bottom - GAP - EDGE;
    const roomAbove = box.top - GAP - EDGE;
    const flipUp = roomBelow < MIN_ROOM_BELOW && roomAbove > roomBelow;

    const style: CSSProperties = flipUp
        ? { position: 'fixed', left: box.left, bottom: viewportHeight - box.top + GAP, maxHeight: Math.min(maxHeight, roomAbove) }
        : { position: 'fixed', left: box.left, top: box.bottom + GAP, maxHeight: Math.min(maxHeight, roomBelow) };

    if (matchAnchorWidth) style.width = box.width;
    else style.minWidth = box.width;

    return createPortal(
        <div
            ref={panelRef}
            role={role}
            aria-label={ariaLabel}
            style={style}
            className={`z-50 overflow-y-auto rounded border bg-white shadow-lg ${className}`}
        >
            {children}
        </div>,
        document.body,
    );
}
