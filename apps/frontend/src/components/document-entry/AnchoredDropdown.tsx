'use client';

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
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
    right: number;
}

const ZERO_BOX: AnchorBox = { top: 0, left: 0, width: 0, bottom: 0, right: 0 };

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
    /**
     * Line the panel's right edge up with the anchor's, rather than its left.
     *
     * For a panel wider than what it hangs off — a menu under an icon button —
     * growing leftwards is what keeps it on screen and under its trigger. Only
     * a hint: a panel that would run off the left edge is clamped back.
     */
    align?: 'start' | 'end';
    className?: string;
    role?: string;
    'aria-label'?: string;
    /** For a `listbox` that holds several choices at once. */
    'aria-multiselectable'?: boolean;
    children: ReactNode;
}

/**
 * A dropdown panel rendered into `document.body` and pinned to its anchor.
 *
 * Entry screens hang their pickers over the line-items table, and an in-flow
 * `absolute` panel is at the mercy of everything above it: the table wrapper is
 * `overflow-hidden rounded bg-white`, which in WebKit gets its own compositing
 * layer and paints straight over a low-`z` sibling — the product list came out
 * sliced off at the table's top edge. Out in a portal the panel has no siblings
 * to lose to and no ancestor overflow to be clipped by, in any browser.
 *
 * **The panel sits on `z-dropdown` (65), above `modal` (60).** A portal escapes
 * ancestor clipping but not the stacking order, and these panels are opened
 * from controls *inside* modals — the task card's chips, the purchase entry
 * modals' product search. At `z-50` the panel painted under the modal layer:
 * mounted, visible, and unclickable, because every option row lost the hit test
 * to the modal sitting over it. That reads as "the dropdown does not respond",
 * which is exactly how it was reported. It stays below `toast` (70), which has
 * to clear an open picker.
 */
export default function AnchoredDropdown({
    anchorRef,
    panelRef,
    maxHeight = 320,
    matchAnchorWidth = true,
    align = 'start',
    className = '',
    role,
    'aria-label': ariaLabel,
    'aria-multiselectable': ariaMultiselectable,
    children,
}: AnchoredDropdownProps) {
    const [box, setBox] = useState<AnchorBox>(ZERO_BOX);
    const [mounted, setMounted] = useState(false);
    /**
     * The panel's own width, for a panel that is not matching the anchor's.
     * Unknown until it has rendered once, so the first paint positions from the
     * anchor and the measurement corrects it — the panel is only ever a few
     * pixels out for one frame, and never outside the viewport.
     */
    const [measuredWidth, setMeasuredWidth] = useState(0);
    const innerRef = useRef<HTMLDivElement | null>(null);

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
                && previous.right === rect.right
                ? previous
                : {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    bottom: rect.bottom,
                    right: rect.right,
                }
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

    // Only a panel sizing itself needs its own width known; one matching the
    // anchor already has it. Measured from the content box so the clamp is not
    // fighting the `maxWidth` it just applied.
    useLayoutEffect(() => {
        if (matchAnchorWidth) return;
        const panel = innerRef.current;
        if (!panel) return;
        const width = panel.scrollWidth;
        setMeasuredWidth((previous) => (previous === width ? previous : width));
    }, [matchAnchorWidth, children, box.width]);

    if (!mounted) return null;

    const viewportHeight = window.innerHeight;
    const roomBelow = viewportHeight - box.bottom - GAP - EDGE;
    const roomAbove = box.top - GAP - EDGE;
    const flipUp = roomBelow < MIN_ROOM_BELOW && roomAbove > roomBelow;

    const style: CSSProperties = flipUp
        ? { position: 'fixed', bottom: viewportHeight - box.top + GAP, maxHeight: Math.min(maxHeight, roomAbove) }
        : { position: 'fixed', top: box.bottom + GAP, maxHeight: Math.min(maxHeight, roomBelow) };

    if (matchAnchorWidth) style.width = box.width;
    else style.minWidth = box.width;

    // Horizontal placement. `align: 'end'` hangs the panel off the anchor's
    // right edge, which is what a menu wider than its trigger needs — an icon
    // button pinned near a panel's right edge would otherwise push its menu
    // off-screen. Either way the result is clamped into the viewport, so a
    // panel can never end up half outside it; `maxWidth` keeps a panel wider
    // than the whole viewport from reintroducing the overflow.
    const panelWidth = matchAnchorWidth
        ? box.width
        : Math.max(measuredWidth, box.width);
    const viewportWidth = window.innerWidth;

    if (panelWidth > 0) {
        const preferred = align === 'end' ? box.right - panelWidth : box.left;
        const maxLeft = viewportWidth - panelWidth - EDGE;
        style.left = Math.max(EDGE, Math.min(preferred, Math.max(EDGE, maxLeft)));
    } else {
        style.left = box.left;
    }
    style.maxWidth = viewportWidth - EDGE * 2;

    return createPortal(
        <div
            ref={(node) => {
                innerRef.current = node;
                // The owner's click-outside test needs this element too, so the
                // caller's ref is populated alongside our own.
                if (panelRef) panelRef.current = node;
            }}
            role={role}
            aria-label={ariaLabel}
            aria-multiselectable={ariaMultiselectable}
            style={style}
            className={`z-dropdown overflow-y-auto rounded border bg-white shadow-lg ${className}`}
        >
            {children}
        </div>,
        document.body,
    );
}
