'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    TouchSensor,
    closestCenter,
    pointerWithin,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ChipOption } from '@/components/projects/ChipPopover';
import BacklogRow, { type RowEdit } from './BacklogRow';
import {
    dropModeFor,
    isItem,
    resolveDrop,
    stepMove,
    type BacklogMove,
    type DropMode,
    type VisibleRow,
} from './backlog-rows';
import type { ColumnOption, MemberOption } from './use-backlog-options';

export interface BacklogTreeProps {
    rows: VisibleRow[];
    selected: Set<string>;
    canEdit: boolean;
    onToggle: (row: VisibleRow) => void;
    onOpen: (row: VisibleRow) => void;
    onSelect: (row: VisibleRow, extend: boolean) => void;
    onMove: (move: BacklogMove) => void;
    onEdit: (row: VisibleRow, edit: RowEdit) => void;
    moveTargets: (row: VisibleRow) => ChipOption[];
    onMoveTo: (row: VisibleRow, parentId: string | null) => void;
    onAdd: (row: VisibleRow, title: string) => Promise<void>;
    columnsOf: (projectId: string) => ColumnOption[] | null;
    membersOf: (projectId: string) => MemberOption[] | null;
    wantOptions: (projectId: string, what: 'columns' | 'members') => void;
}

/**
 * Pointer first, centre as the fallback: rows are thin and stacked, so "the
 * row under the pointer" is the right answer whenever there is one, and only
 * a pointer that has left the list entirely needs the nearest row instead.
 */
const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : closestCenter(args);
};

/**
 * The Backlog as an ARIA tree of flat rows, with the three ways to rearrange
 * it: drag a row by its handle, pick a new parent from its "Move to" chip, or
 * Alt+↑/↓ from the keyboard. All three produce the same `BacklogMove`, so the
 * page has one write path for them.
 *
 * Keyboard, per the WAI-ARIA tree pattern: ↑/↓ move between rows, → opens a
 * row (or steps into it), ← closes it (or steps out to its parent), Home/End
 * jump, Enter opens the row's editor, Space selects. One row is the tab stop.
 */
export default function BacklogTree(props: BacklogTreeProps) {
    const { rows, selected, canEdit, onToggle, onOpen, onSelect, onMove } = props;
    const { t } = useI18n();
    const m = t.projects;
    const container = useRef<HTMLDivElement>(null);

    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [preview, setPreview] = useState<{ overKey: string; mode: DropMode } | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        // A press-and-hold on a phone, so a drag does not steal the scroll.
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    );

    const tabStopKey = rows.some((row) => row.key === focusedKey) ? focusedKey : (rows[0]?.key ?? null);

    const focusRow = (key: string | undefined) => {
        if (!key) return;
        setFocusedKey(key);
        const node = container.current?.querySelector<HTMLElement>(`[data-row-key="${key}"][tabindex]`);
        node?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, row: VisibleRow) => {
        // Keys typed into a chip's filter box or an inline composer are theirs.
        if (event.target !== event.currentTarget) return;
        const index = rows.findIndex((candidate) => candidate.key === row.key);

        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            if (!canEdit) return;
            const move = stepMove(rows, row.key, event.key === 'ArrowUp' ? -1 : 1);
            if (move) onMove(move);
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusRow(rows[index + 1]?.key);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusRow(rows[index - 1]?.key);
                break;
            case 'Home':
                event.preventDefault();
                focusRow(rows[0]?.key);
                break;
            case 'End':
                event.preventDefault();
                focusRow(rows[rows.length - 1]?.key);
                break;
            case 'ArrowRight':
                event.preventDefault();
                if (row.expandable && !row.expanded) onToggle(row);
                else if (row.expanded) focusRow(rows[index + 1]?.key);
                break;
            case 'ArrowLeft':
                event.preventDefault();
                if (row.expandable && row.expanded) onToggle(row);
                else focusRow(row.parentKey ?? undefined);
                break;
            case 'Enter':
                event.preventDefault();
                if (isItem(row)) onOpen(row);
                else if (row.expandable) onToggle(row);
                break;
            case ' ':
                if (isItem(row)) {
                    event.preventDefault();
                    onSelect(row, event.shiftKey);
                }
                break;
            default:
        }
    };

    const reset = () => {
        setActiveKey(null);
        setPreview(null);
    };

    const onDragStart = (event: DragStartEvent) => setActiveKey(String(event.active.id));

    const onDragOver = (event: DragOverEvent) => {
        if (!event.over) {
            setPreview(null);
            return;
        }
        const overKey = String(event.over.id);
        const move = resolveDrop(rows, String(event.active.id), overKey);
        const overRow = rows.find((row) => row.key === overKey);
        setPreview(move && overRow ? { overKey, mode: dropModeFor(move, overRow) } : null);
    };

    const onDragEnd = (event: DragEndEvent) => {
        const move = event.over ? resolveDrop(rows, String(event.active.id), String(event.over.id)) : null;
        reset();
        if (move) onMove(move);
    };

    const activeRow = activeKey ? rows.find((row) => row.key === activeKey) : undefined;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={reset}
        >
            <div
                ref={container}
                role="tree"
                aria-label={m.backlog.title}
                aria-multiselectable
                className="divide-y divide-gray-100"
            >
                {rows.map((row) => (
                    <BacklogRow
                        key={row.key}
                        row={row}
                        focused={focusedKey === row.key}
                        selected={selected.has(row.key)}
                        dropMode={preview?.overKey === row.key ? preview.mode : null}
                        tabStop={tabStopKey === row.key}
                        canEdit={canEdit}
                        onToggle={onToggle}
                        onOpen={onOpen}
                        onSelect={onSelect}
                        onFocusRow={setFocusedKey}
                        onKeyDown={onKeyDown}
                        onEdit={props.onEdit}
                        moveTargets={props.moveTargets}
                        onMoveTo={props.onMoveTo}
                        onAdd={props.onAdd}
                        columnsOf={props.columnsOf}
                        membersOf={props.membersOf}
                        wantOptions={props.wantOptions}
                    />
                ))}
            </div>
            <DragOverlay dropAnimation={null}>
                {activeRow ? <DragGhost row={activeRow} /> : null}
            </DragOverlay>
        </DndContext>
    );
}

/** What follows the pointer: the row's ID and title, not a copy of the whole row. */
function DragGhost({ row }: { row: VisibleRow }) {
    const code = row.epic?.epic.code ?? row.story?.story.code ?? row.task?.task.key ?? '';
    const title = row.epic?.epic.title ?? row.story?.story.title ?? row.task?.task.title ?? '';
    return (
        <div className="flex max-w-md items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm shadow-lg">
            <GripVertical className="h-4 w-4 text-gray-400" aria-hidden />
            <span className="font-mono text-xs text-gray-500">{code}</span>
            <span className="truncate text-gray-900">{title}</span>
        </div>
    );
}
