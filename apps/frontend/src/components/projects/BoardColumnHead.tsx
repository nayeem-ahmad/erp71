'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    ArrowLeftRight,
    ArrowLeft,
    ArrowRight,
    CheckSquare,
    GripVertical,
    MoreHorizontal,
    Pencil,
    SortAsc,
} from 'lucide-react';
import { Input, StatusBadge } from '@/components/ui';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';
import { CARD_SORTS, type CardSort } from './board-tasks';
import type { BoardView } from './board-view';
import { tintOf } from './board-view';

export interface ColumnTarget {
    id: string;
    name: string;
}

interface BoardColumnHeadProps {
    columnId: string;
    name: string;
    category: string;
    view: BoardView;
    /** Cards in the column ignoring filters — what a WIP limit is judged on. */
    held: number;
    /** Cards actually on screen, which is what the column's card actions act on. */
    shown: number;
    wipLimit?: number | null;
    overWip: boolean;
    /** Hours left across the column, already summed. Zero hides the figure. */
    remaining: number;
    remainingLabel: string;
    dragging: boolean;
    busy: boolean;
    onRename: (name: string) => void;
    onMoveLeft?: () => void;
    onMoveRight?: () => void;
    onSort: (by: CardSort) => void;
    /** The other columns on the board, for "move all cards to". */
    targets: ColumnTarget[];
    onMoveAllCards: (targetId: string) => void;
    onSelectAll: () => void;
    onPointerDownHead: (e: React.PointerEvent) => void;
    onPointerDownHandle: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
}

/**
 * A column's head: what it is called, how full it is, and everything you can do
 * to the column itself.
 *
 * All three of those used to be unreachable from the board. A column could only
 * be renamed on a settings page, only be reordered by editing a number there,
 * and its cards could only be moved one drag at a time. So: the name is an
 * inline field (double-click, or Rename in the menu), the head is the grip a
 * column is dragged by, and the `…` menu holds the bulk actions that would
 * otherwise be dozens of drags.
 *
 * The menu is a plain popover rather than nested submenus. "Sort cards" and
 * "Move all cards to" are both lists, and a flat list of eight items that can
 * be tabbed through beats two submenus that cannot be opened by keyboard.
 */
export default function BoardColumnHead({
    columnId,
    name,
    category,
    view,
    held,
    shown,
    wipLimit,
    overWip,
    remaining,
    remainingLabel,
    dragging,
    busy,
    onRename,
    onMoveLeft,
    onMoveRight,
    onSort,
    targets,
    onMoveAllCards,
    onSelectAll,
    onPointerDownHead,
    onPointerDownHandle,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: Readonly<BoardColumnHeadProps>) {
    const { t } = useI18n();
    const m = t.projects.boards;

    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(name);
    const tint = tintOf(view, category);

    const startRename = () => {
        setDraft(name);
        setRenaming(true);
    };

    const commitRename = () => {
        setRenaming(false);
        const next = draft.trim();
        // An empty name is a slip, not an instruction, and a name that did not
        // change is not a rename — neither is worth a request.
        if (!next || next === name) return;
        onRename(next);
    };

    if (renaming) {
        return (
            <div className="border-b border-gray-200 bg-white/70 px-2 py-1.5">
                <Input
                    autoFocus
                    aria-label={`${m.renameColumn} — ${name}`}
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            commitRename();
                        }
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            setRenaming(false);
                        }
                    }}
                />
            </div>
        );
    }

    return (
        <div
            // A mouse can pick the column up anywhere on its head; touch has to
            // come through the grip, or the board could not be scrolled by
            // finger. Same rule as a card, for the same reason.
            onPointerDown={onPointerDownHead}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            className={`flex items-center justify-between gap-1 border-b border-gray-200 bg-white/70 px-2 py-2 md:cursor-grab ${
                dragging ? 'opacity-50' : ''
            }`}
        >
            <span className="flex min-w-0 items-center gap-1">
                <button
                    type="button"
                    aria-label={`${m.dragColumn} — ${name}`}
                    tabIndex={-1}
                    onPointerDown={onPointerDownHandle}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    className="-ms-1 max-md:min-h-touch touch-none px-0.5 text-gray-300 transition-opacity hover:text-gray-500 md:opacity-0 md:group-hover/column:opacity-100"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                {view.columnTint === 'category' && (
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tint.dot}`} />
                )}
                {/* Double-click to rename, as a spreadsheet tab or a Trello
                    list does — the menu's Rename is the discoverable path to
                    the same field, not the only one. */}
                <span
                    role="button"
                    tabIndex={0}
                    title={m.renameColumn}
                    onDoubleClick={startRename}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'F2') startRename();
                    }}
                    className="truncate rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                    {name}
                </span>
            </span>

            <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500">
                {wipLimit ? (
                    <StatusBadge
                        tone={overWip ? 'danger' : 'neutral'}
                        aria-label={
                            overWip
                                ? t.projects.columns.overLimit.replace('{name}', name)
                                : undefined
                        }
                    >
                        {held}/{wipLimit}
                    </StatusBadge>
                ) : (
                    <span
                        className={`rounded-full px-1.5 py-0.5 font-medium transition-colors ${tint.chip}`}
                    >
                        {shown}
                    </span>
                )}
                {remaining > 0 ? `${remaining}${remainingLabel}` : ''}

                <ColumnMenu
                    columnName={name}
                    columnId={columnId}
                    busy={busy}
                    hasCards={shown > 0}
                    onRename={startRename}
                    onMoveLeft={onMoveLeft}
                    onMoveRight={onMoveRight}
                    onSort={onSort}
                    targets={targets}
                    onMoveAllCards={onMoveAllCards}
                    onSelectAll={onSelectAll}
                />
            </span>
        </div>
    );
}

function ColumnMenu({
    columnId,
    columnName,
    busy,
    hasCards,
    onRename,
    onMoveLeft,
    onMoveRight,
    onSort,
    targets,
    onMoveAllCards,
    onSelectAll,
}: Readonly<{
    columnId: string;
    columnName: string;
    busy: boolean;
    hasCards: boolean;
    onRename: () => void;
    onMoveLeft?: () => void;
    onMoveRight?: () => void;
    onSort: (by: CardSort) => void;
    targets: ColumnTarget[];
    onMoveAllCards: (targetId: string) => void;
    onSelectAll: () => void;
}>) {
    const { t } = useI18n();
    const m = t.projects.boards;

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
            // Focus goes back to the control that opened the menu, or a
            // keyboard user is left at the top of the document.
            triggerRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    /** The items an arrow key can reach: everything but the disabled ones. */
    const reachable = () =>
        Array.from(
            panelRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not([disabled])',
            ) ?? [],
        );

    // Opens on its first item, and moves between them with the arrows. A
    // `role="menu"` promises both; leaving that promise half-kept would read
    // worse to a screen reader than not claiming to be a menu at all.
    useEffect(() => {
        if (open) reachable()[0]?.focus();
    }, [open]);

    const onArrowKey = (event: React.KeyboardEvent) => {
        const down = event.key === 'ArrowDown';
        const up = event.key === 'ArrowUp';
        if (!down && !up) return;

        event.preventDefault();
        const items = reachable();
        if (items.length === 0) return;

        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            at === -1
                ? down
                    ? 0
                    : items.length - 1
                : (at + (down ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
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
                aria-label={`${m.columnActions} — ${columnName}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                disabled={busy}
                // Stopped before it reaches the head, or opening the menu would
                // arm a column drag.
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setOpen((was) => !was)}
                className="max-md:min-h-touch max-md:min-w-touch rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
            >
                <MoreHorizontal className="h-4 w-4" />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    role="menu"
                    aria-label={`${m.columnActions} — ${columnName}`}
                    onKeyDown={onArrowKey}
                    // The panel hangs inside the column head, which arms a drag
                    // on pointer-down and captures the pointer — and a captured
                    // pointer retargets the click that follows. Without this,
                    // picking a menu item would be a click the head swallowed.
                    onPointerDown={(event) => event.stopPropagation()}
                    // Pinned to the logical end edge so it hangs off the correct
                    // side under RTL, where the column head reads right to left.
                    className="absolute end-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] space-y-1 rounded-lg border border-gray-200 bg-white p-1 text-start shadow-lg motion-safe:animate-board-menu-in"
                >
                    <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={pick(onRename)}>
                        {m.renameColumn}
                    </MenuItem>
                    <MenuItem
                        icon={<ArrowLeft className="h-3.5 w-3.5" />}
                        disabled={!onMoveLeft}
                        onClick={pick(() => onMoveLeft?.())}
                    >
                        {m.moveColumnLeft}
                    </MenuItem>
                    <MenuItem
                        icon={<ArrowRight className="h-3.5 w-3.5" />}
                        disabled={!onMoveRight}
                        onClick={pick(() => onMoveRight?.())}
                    >
                        {m.moveColumnRight}
                    </MenuItem>

                    <MenuGroup icon={<SortAsc className="h-3.5 w-3.5" />} label={m.sortCards}>
                        {CARD_SORTS.map((key) => (
                            <MenuItem
                                key={key}
                                nested
                                disabled={!hasCards}
                                onClick={pick(() => onSort(key))}
                            >
                                {m.sortBy[key]}
                            </MenuItem>
                        ))}
                    </MenuGroup>

                    <MenuGroup
                        icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                        label={m.moveAllCards}
                    >
                        {targets.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-gray-400">{m.noOtherColumn}</p>
                        ) : (
                            <div className="max-h-40 overflow-y-auto">
                                {targets.map((target) => (
                                    <MenuItem
                                        key={target.id}
                                        nested
                                        disabled={!hasCards || target.id === columnId}
                                        onClick={pick(() => onMoveAllCards(target.id))}
                                    >
                                        {target.name}
                                    </MenuItem>
                                ))}
                            </div>
                        )}
                    </MenuGroup>

                    <MenuItem
                        icon={<CheckSquare className="h-3.5 w-3.5" />}
                        disabled={!hasCards}
                        onClick={pick(onSelectAll)}
                    >
                        {m.selectAllCards}
                    </MenuItem>
                </div>
            )}
        </div>
    );
}

function MenuItem({
    children,
    icon,
    nested = false,
    disabled = false,
    onClick,
}: Readonly<{
    children: React.ReactNode;
    icon?: React.ReactNode;
    /** Indents an item that belongs to the group above it. */
    nested?: boolean;
    disabled?: boolean;
    onClick: () => void;
}>) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={onClick}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent max-md:min-h-touch ${
                nested ? 'ps-7' : ''
            }`}
        >
            {icon}
            <span className="truncate">{children}</span>
        </button>
    );
}

function MenuGroup({
    label,
    icon,
    children,
}: Readonly<{ label: string; icon: React.ReactNode; children: React.ReactNode }>) {
    return (
        <div className="border-t border-gray-100 pt-1">
            <p className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-gray-500">
                {icon}
                {label}
            </p>
            {children}
        </div>
    );
}
