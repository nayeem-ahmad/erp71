'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    PANEL_KEYBOARD_STEP,
    anchoredPanelPosition,
    clampPanelPosition,
    readPanelPosition,
    writePanelPosition,
    type PanelBox,
    type PanelPoint,
} from '@/lib/floating-panel-position';

/** Which way each arrow key moves a panel, in steps. */
const ARROW_STEPS: Record<string, PanelPoint> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

export interface FloatingPanelDragProps {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
}

// Placing a panel under its anchor has to happen before paint, or it flashes in
// its default corner first. The server has no layout to wait for.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The grip is a button, so pressing it must not be mistaken for pressing a control. */
export const DRAG_HANDLE_ATTR = 'data-panel-grip';

/**
 * Makes a `position: fixed` element movable, and remembers where it was left.
 *
 * Pointer events rather than mouse events, and a pointer capture rather than
 * window listeners: the first is what makes the panel draggable by touch as
 * well as by mouse, the second is what keeps a fast drag from being dropped
 * when the pointer outruns the handle.
 *
 * `position` stays null until someone moves the panel or a remembered position
 * comes back, which is what lets the default corner be plain CSS — nothing has
 * to measure the window to open the panel where it belongs.
 *
 * `getAnchor` names the control the panel opens from. When given, the panel
 * opens just below it every time instead of where it was last left — it reads
 * as dropping out of the thing that was pressed — and follows it on resize
 * until somebody drags it elsewhere. Nothing is remembered then: the next
 * opening belongs under the anchor again.
 */
export function useFloatingPanel(
    storageKey: string,
    draggable: boolean,
    getAnchor?: () => HTMLElement | null,
) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState<PanelPoint | null>(null);
    const [dragging, setDragging] = useState(false);
    /** Where in the panel the pointer took hold, so it does not jump on grab. */
    const grabOffset = useRef<PanelPoint | null>(null);
    // Mirrors `position` for the handlers: an updater that also writes to
    // storage would write twice under StrictMode's double-invoked renders.
    const positionRef = useRef<PanelPoint | null>(null);
    // A ref, so a caller passing an inline function does not re-place the
    // panel on every render.
    const getAnchorRef = useRef(getAnchor);
    getAnchorRef.current = getAnchor;
    /** True when the panel opened under its anchor, so there is nothing to remember. */
    const usesAnchorRef = useRef(false);
    /** True while the panel still sits where its anchor put it. */
    const anchoredRef = useRef(false);

    const applyPosition = useCallback((next: PanelPoint | null) => {
        positionRef.current = next;
        setPosition(next);
    }, []);

    const viewport = (): PanelBox => ({
        width: window.innerWidth,
        height: window.innerHeight,
    });

    const measure = (): PanelBox | null => {
        const rect = panelRef.current?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
    };

    const anchorPosition = (): PanelPoint | null => {
        const anchor = getAnchorRef.current?.();
        const size = measure();
        if (!anchor || !size) return null;
        return anchoredPanelPosition(anchor.getBoundingClientRect(), size, viewport(), {
            rtl: document.documentElement.dir === 'rtl',
        });
    };

    // Restore. A window narrower than the one the position was saved in — a
    // laptop undocked from a monitor — would otherwise put the panel off
    // screen, where it can never be dragged back.
    useIsomorphicLayoutEffect(() => {
        // No anchor on screen — a page without the header chip — falls back to
        // the remembered position, as if none had been asked for.
        const anchored = anchorPosition();
        usesAnchorRef.current = anchored !== null;
        anchoredRef.current = anchored !== null;
        if (anchored) {
            applyPosition(anchored);
            return;
        }
        if (!draggable) {
            applyPosition(null);
            return;
        }
        const stored = readPanelPosition(storageKey);
        if (!stored) return;
        const size = measure();
        applyPosition(size ? clampPanelPosition(stored, size, viewport()) : stored);
        // `anchorPosition` reads refs only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draggable, storageKey, applyPosition]);

    // The same hazard arriving the other way round: the window shrinking while
    // the panel is open.
    useEffect(() => {
        if (!draggable && !usesAnchorRef.current) return;
        const onResize = () => {
            if (anchoredRef.current) {
                const anchored = anchorPosition();
                if (anchored) {
                    applyPosition(anchored);
                    return;
                }
            }
            if (!draggable) return;
            const current = positionRef.current;
            const size = measure();
            if (!current || !size) return;
            applyPosition(clampPanelPosition(current, size, viewport()));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draggable, applyPosition]);

    const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
        if (!draggable || event.button !== 0) return;
        // The header carries buttons; pressing one of those is not a drag.
        if (
            (event.target as HTMLElement).closest(
                `button:not([${DRAG_HANDLE_ATTR}]), input, select, textarea, a`,
            )
        ) {
            return;
        }
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect) return;

        grabOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        anchoredRef.current = false;
        applyPosition({ x: rect.left, y: rect.top });
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        // Stops the drag from selecting the title text, and from scrolling the
        // page under a finger.
        event.preventDefault();
    };

    const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
        const offset = grabOffset.current;
        const size = measure();
        if (!offset || !size) return;
        applyPosition(
            clampPanelPosition(
                { x: event.clientX - offset.x, y: event.clientY - offset.y },
                size,
                viewport(),
            ),
        );
    };

    const endDrag = (event: React.PointerEvent<HTMLElement>) => {
        if (!grabOffset.current) return;
        grabOffset.current = null;
        setDragging(false);
        try {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        } catch {
            // The capture is already gone; nothing to release.
        }
        if (positionRef.current && !usesAnchorRef.current) {
            writePanelPosition(storageKey, positionRef.current);
        }
    };

    /** Arrow keys move it too — a panel only a pointer can move is a panel some people cannot move. */
    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (!draggable) return;
        const step = ARROW_STEPS[event.key];
        const rect = panelRef.current?.getBoundingClientRect();
        if (!step || !rect) return;
        event.preventDefault();

        const from = positionRef.current ?? { x: rect.left, y: rect.top };
        const next = clampPanelPosition(
            {
                x: from.x + step.x * PANEL_KEYBOARD_STEP,
                y: from.y + step.y * PANEL_KEYBOARD_STEP,
            },
            { width: rect.width, height: rect.height },
            viewport(),
        );
        anchoredRef.current = false;
        applyPosition(next);
        if (!usesAnchorRef.current) writePanelPosition(storageKey, next);
    };

    const dragProps: FloatingPanelDragProps = {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
    };

    return {
        panelRef,
        position,
        dragging,
        dragProps,
        onKeyDown,
        style: position ? { left: position.x, top: position.y } : undefined,
    };
}
