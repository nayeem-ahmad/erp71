import { useEffect } from 'react';

/**
 * True when the event target is inside app chrome that initiates navigation.
 * Skipping these on pointer-down avoids setState races that abort Next.js
 * client-side route transitions (seen on /sales/new sidebar clicks).
 */
export function isAppNavigationTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest('aside, nav, a[href]');
}

/**
 * Attach a document mousedown listener only while `active`, closing/dismissing
 * when the pointer lands outside `isInside`. Navigation targets are ignored.
 */
export function useDismissOnClickOutside(
    active: boolean,
    isInside: (target: Node) => boolean,
    onDismiss: () => void,
) {
    useEffect(() => {
        if (!active) return;

        function handlePointerDown(event: MouseEvent) {
            if (isAppNavigationTarget(event.target)) return;
            const target = event.target as Node;
            if (isInside(target)) return;
            onDismiss();
        }

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [active, isInside, onDismiss]);
}