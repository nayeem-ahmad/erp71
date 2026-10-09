import { useEffect, type RefObject } from 'react';

/**
 * While a navigation drawer is open on a phone: focus its first control, keep
 * Tab inside it, and close it on Escape. Does nothing without `onClose` (the
 * desktop sidebar is not a dialog).
 */
export function useDrawerFocusTrap(
    ref: RefObject<HTMLElement | null>,
    isOpen: boolean,
    onClose: (() => void) | undefined,
) {
    useEffect(() => {
        if (!isOpen || !onClose) return;

        const aside = ref.current;
        if (!aside) return;

        const focusableSelector = 'a[href], button:not([disabled]), select, textarea, input:not([disabled])';
        const getFocusable = () =>
            Array.from(aside.querySelectorAll<HTMLElement>(focusableSelector)).filter(
                (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
            );

        const focusable = getFocusable();
        focusable[0]?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            const items = getFocusable();
            if (items.length === 0) return;

            const first = items[0];
            const last = items[items.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [ref, isOpen, onClose]);
}
