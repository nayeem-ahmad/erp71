'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ModalShellSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * `dialog` is the centred card every modal in the app has always been.
 * `drawer` slides the same panel in from the inline edge and runs the full
 * height, for a surface you read *beside* the list that opened it rather than
 * on top of it — the lead's activity timeline opened from a row of the
 * activities list, say, where the point is to keep the list in view.
 */
type ModalShellVariant = 'dialog' | 'drawer';

const SIZE_CLASS: Record<ModalShellSize, string> = {
    sm: 'sm:max-w-lg',
    md: 'sm:max-w-2xl',
    lg: 'sm:max-w-3xl',
    xl: 'sm:max-w-4xl',
    '2xl': 'sm:max-w-5xl',
};

/**
 * Where the panel sits above `sm`. Below it the two variants are deliberately
 * identical: a side drawer on a 360px phone is a full-screen panel that
 * arrived sideways, which is the bottom sheet with worse ergonomics.
 */
const WRAPPER_CLASS: Record<ModalShellVariant, string> = {
    dialog: 'items-end justify-center sm:items-center sm:p-4',
    drawer: 'items-end justify-center sm:items-stretch sm:justify-end',
};

const PANEL_CLASS: Record<ModalShellVariant, string> = {
    dialog: 'max-h-[95vh] rounded-t-xl sm:max-h-[90vh] sm:rounded-xl',
    /*
     * Full height against the inline edge, so only the side facing the page is
     * rounded. `--drawer-from` is what keeps the slide honest in Arabic and
     * Urdu: `translateX` is physical (docs/rtl-guidelines.md), and nothing else
     * declares that property, so the RTL override is a plain variable swap
     * rather than two competing `animate-*` classes racing on specificity.
     */
    drawer:
        'max-h-[95vh] rounded-t-xl sm:h-full sm:max-h-full sm:rounded-none sm:rounded-s-xl'
        + ' rtl:[--drawer-from:-100%] sm:motion-safe:animate-drawer-in',
};

/**
 * How deep in the render tree a shell sits: 1 for a modal opened from a page,
 * 2 for one opened from inside that modal. The activities drawer holds a panel
 * with its own edit and complete dialogs, and every shell listens on
 * `document`, so without this a single Escape would close the dialog *and* the
 * drawer behind it.
 *
 * Deliberately not mount order — React runs a child's effects before its
 * parent's, so a nested pair mounted in one commit registers innermost-first
 * and the stack reads upside down.
 */
const ModalDepthContext = createContext(0);

type ShellEntry = { depth: number };

const openShells: ShellEntry[] = [];

/**
 * The deepest open shell, and among equals the most recently opened — two
 * unnested modals are siblings, so nesting cannot separate them and the newer
 * one is the one in front.
 */
function isTopmost(entry: ShellEntry): boolean {
    let top: ShellEntry | null = null;
    for (const shell of openShells) {
        if (!top || shell.depth >= top.depth) top = shell;
    }
    return top === entry;
}

type ModalShellProps = {
    children: ReactNode;
    size?: ModalShellSize;
    variant?: ModalShellVariant;
    className?: string;
    onBackdropClick?: () => void;
    /**
     * Whether a click on the backdrop dismisses the modal. Escape closes it
     * either way — reaching for Escape is deliberate in a way a stray click
     * beside the panel is not.
     *
     * Set it false on anything holding typed work: a task being filed, a card
     * being edited. Losing a half-written description to a mis-aimed click is
     * the one dismissal nobody ever meant, and there is a Cancel button two
     * inches away for the times they do.
     */
    dismissOnBackdrop?: boolean;
};

export default function ModalShell({
    children,
    size = 'sm',
    variant = 'dialog',
    className = '',
    onBackdropClick,
    dismissOnBackdrop = true,
}: ModalShellProps) {
    const depth = useContext(ModalDepthContext) + 1;
    const entryRef = useRef<ShellEntry>({ depth });

    // Registered whether or not this shell can be dismissed, so a modal that
    // refuses Escape swallows it rather than letting it reach its parent.
    useEffect(() => {
        const entry = entryRef.current;
        openShells.push(entry);
        return () => {
            const at = openShells.lastIndexOf(entry);
            if (at !== -1) openShells.splice(at, 1);
        };
    }, []);

    useEffect(() => {
        if (!onBackdropClick) return;
        const entry = entryRef.current;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (!isTopmost(entry)) return;
            onBackdropClick();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onBackdropClick]);

    /*
     * A shell opened from inside another one sits on a backdrop that is already
     * dimmed and already blurred, so it adds a light scrim instead of a second
     * full one — two `bg-black/50` layers put the page at 75% black and blur the
     * blur, which is how the edit dialog over the activities drawer looked.
     */
    const backdropClass = depth > 1 ? 'bg-black/20' : 'bg-black/50 backdrop-blur-sm';

    /**
     * Whether the press that produced the next click landed on the backdrop.
     *
     * A drag that starts inside the panel and releases past its edge — selecting
     * a line of a description, overshooting a slider — fires `click` on the
     * backdrop, and closing there threw away the edit the drag was part of. Only
     * a press *and* a release on the backdrop counts as clicking outside.
     *
     * Starts true so a click synthesised without a press still dismisses.
     */
    const pressedBackdrop = useRef(true);

    return (
        <div
            className={`fixed inset-0 z-modal flex p-0 ${backdropClass} ${WRAPPER_CLASS[variant]}`}
            onMouseDown={(event) => {
                pressedBackdrop.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
                const outside = pressedBackdrop.current && event.target === event.currentTarget;
                pressedBackdrop.current = true;
                if (outside && dismissOnBackdrop) onBackdropClick?.();
            }}
            role="presentation"
        >
            <div
                className={`flex w-full flex-col overflow-hidden bg-white shadow-2xl ${PANEL_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <ModalDepthContext.Provider value={depth}>{children}</ModalDepthContext.Provider>
            </div>
        </div>
    );
}

type ModalHeaderProps = {
    title: ReactNode;
    subtitle?: ReactNode;
    onClose?: () => void;
    closeLabel?: string;
    className?: string;
    children?: ReactNode;
};

export function ModalHeader({
    title,
    subtitle,
    onClose,
    closeLabel = 'Close',
    className = '',
    children,
}: ModalHeaderProps) {
    return (
        <div
            className={`px-4 py-3 border-b border-gray-100 flex items-center justify-between ${className}`}
        >
            {/* Takes the spare width so a title that is itself a control — an
                inline-editable heading, say — fills the header rather than
                sitting in a column the width of its own text. */}
            <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {subtitle ? <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
                {children}
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={closeLabel}
                        className="p-2 rounded-md text-gray-400 hover:bg-gray-100"
                    >
                        <X className="w-5 h-5" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

type ModalFooterProps = {
    children: ReactNode;
    className?: string;
};

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
    return (
        <div
            className={`px-4 py-3 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white ${className}`}
        >
            {children}
        </div>
    );
}
