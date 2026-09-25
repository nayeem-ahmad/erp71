'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Link2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';

function MenuItem({
    children,
    icon,
    danger = false,
    className = '',
    onClick,
}: {
    children: ReactNode;
    icon: ReactNode;
    danger?: boolean;
    className?: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors max-md:min-h-touch ${
                danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'
            } ${className}`}
        >
            {icon}
            <span className="min-w-0 flex-1 truncate">{children}</span>
        </button>
    );
}

/**
 * The task page's ⋯: what is worth a click but not worth a button in the
 * header. Copy link is a button of its own from `md` up and folds in here below
 * it, per §2.10 — secondary actions collapse into ⋯ on a phone rather than
 * wrapping the header to two rows.
 *
 * Keyboard behaviour follows the board's column menu: it opens on its first
 * item, the arrows move between items, and Escape hands focus back to ⋯.
 */
export default function TaskActionsMenu({
    taskKey,
    onCopyKey,
    onCopyLink,
    onOpenProject,
    onDelete,
}: {
    taskKey: string | null;
    onCopyKey: () => void;
    onCopyLink: () => void;
    /** Absent while the task's project is not known. */
    onOpenProject?: () => void;
    onDelete: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.task;

    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    const isInside = useCallback((target: Node) => Boolean(boxRef.current?.contains(target)), []);
    useDismissOnClickOutside(open, isInside, useCallback(() => setOpen(false), []));

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const items = () =>
        Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []).filter(
            (item) => item.offsetParent !== null || !item.closest('.md\\:hidden'),
        );

    useEffect(() => {
        if (open) items()[0]?.focus();
    }, [open]);

    const onArrowKey = (event: React.KeyboardEvent) => {
        const down = event.key === 'ArrowDown';
        const up = event.key === 'ArrowUp';
        if (!down && !up) return;
        event.preventDefault();
        const list = items();
        if (list.length === 0) return;
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = at === -1 ? (down ? 0 : list.length - 1) : (at + (down ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
    };

    /** Every item closes the menu: none of them leaves anything to do in it. */
    const pick = (action: () => void) => () => {
        setOpen(false);
        action();
    };

    return (
        <div ref={boxRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-label={m.moreActions}
                title={m.moreActions}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => setOpen((was) => !was)}
                className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white px-2 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 aria-expanded:bg-gray-100 max-md:min-h-touch max-md:min-w-touch"
            >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    role="menu"
                    aria-label={m.moreActions}
                    onKeyDown={onArrowKey}
                    // Pinned to the logical end, so under RTL it hangs off the
                    // side the ⋯ is on.
                    className="absolute end-0 top-full z-dropdown mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-0.5 rounded-lg border border-gray-200 bg-white p-1 text-start shadow-lg motion-safe:animate-board-menu-in"
                >
                    <MenuItem
                        icon={<Link2 className="h-4 w-4 text-gray-500" aria-hidden />}
                        onClick={pick(onCopyLink)}
                        className="md:hidden"
                    >
                        {m.copyLink}
                    </MenuItem>
                    {taskKey && (
                        <MenuItem icon={<Copy className="h-4 w-4 text-gray-500" aria-hidden />} onClick={pick(onCopyKey)}>
                            <span className="flex items-center justify-between gap-2">
                                {m.copyKey}
                                <span className="text-xs tabular-nums text-gray-400">{taskKey}</span>
                            </span>
                        </MenuItem>
                    )}
                    {onOpenProject && (
                        <MenuItem
                            icon={<ExternalLink className="h-4 w-4 text-gray-500" aria-hidden />}
                            onClick={pick(onOpenProject)}
                        >
                            {m.openProject}
                        </MenuItem>
                    )}
                    <div role="separator" className="my-1 h-px bg-gray-100" />
                    <MenuItem
                        icon={<Trash2 className="h-4 w-4" aria-hidden />}
                        danger
                        onClick={pick(onDelete)}
                    >
                        {m.deleteTask}…
                    </MenuItem>
                </div>
            )}
        </div>
    );
}
