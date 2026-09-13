'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    PANEL_KEYBOARD_STEP,
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
 */
export function useFloatingPanel(storageKey: string, draggable: boolean) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState<PanelPoint | null>(null);
    const [dragging, setDragging] = useState(false);
    /** Where in the panel the pointer took hold, so it does not jump on grab. */
    const grabOffset = useRef<PanelPoint | null>(null);
    // Mirrors `position` for the handlers: an updater that also writes to
    // storage would write twice under StrictMode's double-invoked renders.
    const positionRef = useRef<PanelPoint | null>(null);

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

    // Restore. A window narrower than the one the position was saved in — a
    // laptop undocked from a monitor — would otherwise put the panel off
    // screen, where it can never be dragged back.
    useEffect(() => {
        if (!draggable) {
            applyPosition(null);
            return;
        }
        const stored = readPanelPosition(storageKey);
        if (!stored) return;
        const size = measure();
        applyPosition(size ? clampPanelPosition(stored, size, viewport()) : stored);
    }, [draggable, storageKey, applyPosition]);

    // The same hazard arriving the other way round: the window shrinking while
    // the panel is open.
    useEffect(() => {
        if (!draggable) return;
        const onResize = () => {
            const current = positionRef.current;
            const size = measure();
            if (!current || !size) return;
            applyPosition(clampPanelPosition(current, size, viewport()));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
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
        if (positionRef.current) writePanelPosition(storageKey, positionRef.current);
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
        applyPosition(next);
        writePanelPosition(storageKey, next);
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
