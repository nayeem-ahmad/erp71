'use client';

import { ChevronDown, ChevronUp, GripHorizontal, X } from 'lucide-react';
import { DRAG_HANDLE_ATTR, useFloatingPanel } from '@/hooks/useFloatingPanel';
import { useIsMdUp } from '@/hooks/useMediaQuery';

interface Props {
    /** Names the remembered position. One key per panel, stable across releases. */
    storageKey: string;
    /**
     * The control the panel opens from. Given one, it opens just below it —
     * on a phone too, across the full width — rather than where it was left.
     */
    anchor?: () => HTMLElement | null;
    title: string;
    /** Sits in the header beside the title, so it survives a collapse. */
    headerAccessory?: React.ReactNode;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    /** Omitted when the panel may not be dismissed — a running clock, say. */
    onClose?: () => void;
    labels: {
        move: string;
        collapse: string;
        expand: string;
        close: string;
    };
    children: React.ReactNode;
}

const headerButtonClass =
    'flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 md:min-h-0 md:min-w-0 md:p-1';

/**
 * A panel that floats over the page, can be dragged anywhere in the window, and
 * opens where it was last left.
 *
 * Below `md` it docks to the bottom of the screen at full width instead: a
 * free-floating card on a 360px screen covers whatever is under it wherever it
 * is put, and there is nowhere to put it that is out of the way. Dragging is
 * off there for the same reason — the position it would remember is one no
 * phone screen has room for.
 *
 * The whole header drags, but the grip inside it is a real button: a surface
 * only a pointer can move is one some people cannot move at all, and a focused
 * grip takes the arrow keys.
 */
export default function FloatingPanel({
    storageKey,
    anchor,
    title,
    headerAccessory,
    collapsed = false,
    onToggleCollapse,
    onClose,
    labels,
    children,
}: Props) {
    const isMdUp = useIsMdUp();
    const { panelRef, position, dragging, dragProps, onKeyDown, style } = useFloatingPanel(
        storageKey,
        isMdUp,
        anchor,
    );

    return (
        <section
            ref={panelRef}
            aria-label={title}
            style={isMdUp ? style : position ? { top: position.y } : undefined}
            // Deliberately below the modal layer, the mobile nav drawer and its
            // scrim: a panel that floats over everything is a panel that floats
            // over the dialog asking whether to keep both entries.
            className={`fixed z-20 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ${
                isMdUp
                    ? `w-[24rem] ${position ? '' : 'bottom-3 end-3'}`
                    : `inset-x-2 ${position ? '' : 'bottom-safe'}`
            }`}
        >
            <header
                {...(isMdUp ? dragProps : {})}
                className={`flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-2 py-1.5 ${
                    isMdUp ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
                }`}
            >
                {isMdUp ? (
                    <button
                        type="button"
                        {...{ [DRAG_HANDLE_ATTR]: '' }}
                        onKeyDown={onKeyDown}
                        aria-label={labels.move}
                        title={labels.move}
                        className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                        <GripHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
                <h2 className="truncate text-xs font-semibold text-gray-700">{title}</h2>
                <div className="ms-auto flex items-center gap-1">
                    {headerAccessory}
                    {onToggleCollapse ? (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={collapsed ? labels.expand : labels.collapse}
                            title={collapsed ? labels.expand : labels.collapse}
                            aria-expanded={!collapsed}
                            className={headerButtonClass}
                        >
                            {collapsed ? (
                                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                            ) : (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            )}
                        </button>
                    ) : null}
                    {onClose ? (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={labels.close}
                            title={labels.close}
                            className={headerButtonClass}
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
            </header>

            {collapsed ? null : (
                // Capped so the panel can never eat the screen it floats over —
                // tighter on a phone, where it is docked across the full width.
                <div className="max-h-[60vh] overflow-y-auto p-3 md:max-h-[70vh]">{children}</div>
            )}
        </section>
    );
}
