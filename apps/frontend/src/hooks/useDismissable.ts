'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a floating panel (dropdown, popover, sheet) when the user clicks
 * outside of `ref`'s element or presses Escape.
 *
 * The outside-click listener is attached on the next tick (setTimeout 0) so
 * the same click/mousedown event that opened the panel doesn't immediately
 * close it again. `onClose` is held in a ref so callers may pass a fresh
 * inline closure each render without tearing the listeners down.
 */
export function useDismissable(
    ref: RefObject<HTMLElement | null>,
    onClose: () => void,
    enabled: boolean = true,
): void {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!enabled) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current();
        };
        const onPointer = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                onCloseRef.current();
            }
        };

        window.addEventListener('keydown', onKey);
        const id = window.setTimeout(() => document.addEventListener('mousedown', onPointer), 0);

        return () => {
            window.removeEventListener('keydown', onKey);
            window.clearTimeout(id);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [enabled, ref]);
}
