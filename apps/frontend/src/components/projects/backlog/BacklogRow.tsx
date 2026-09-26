'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    FolderKanban,
    GripVertical,
    Layers,
    ListTodo,
    MoveRight,
    Plus,
    SquareCheck,
} from 'lucide-react';
import { Input, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import ChipPopover, { type ChipOption } from '@/components/projects/ChipPopover';
import { EPIC_STATUSES, EPIC_STATUS_TONE } from '@/components/projects/EpicFormModal';
import { useI18n } from '@/lib/i18n';
import { assigneeNameOf, isTaskDone } from './backlog-tree';
import { isItem, type DropMode, type VisibleRow } from './backlog-rows';
import type { ColumnOption, MemberOption } from './use-backlog-options';

export const STORY_STATUS_TONE: Record<string, StatusBadgeTone> = {
    BACKLOG: 'neutral',
    READY: 'info',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

const TASK_CATEGORY_TONE: Record<string, StatusBadgeTone> = {
    TODO: 'neutral',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const POINTS = [0, 1, 2, 3, 5, 8, 13, 21];

/**
 * The epic's colour down the leading edge of its whole block, so every story
 * and task under it reads as part of it. Whole class strings, for the reason
 * `LABEL_CLASS` gives.
 */
const EPIC_EDGE: Record<string, string> = {
    GRAY: 'border-s-gray-400',
    BLUE: 'border-s-blue-500',
    EMERALD: 'border-s-emerald-500',
    AMBER: 'border-s-amber-500',
    RED: 'border-s-red-500',
    PURPLE: 'border-s-purple-500',
};

/** Indent per level. Tighter on a phone, where the title needs the width. */
const INDENT = ['ps-1', 'ps-4 md:ps-7', 'ps-7 md:ps-12', 'ps-10 md:ps-16'] as const;

/** One inline edit from a row's chips. */
export type RowEdit =
    | { field: 'status'; value: string }
    | { field: 'priority'; value: string }
    | { field: 'points'; value: number | null }
    | { field: 'assignee'; value: string };

export interface BacklogRowProps {
    row: VisibleRow;
    focused: boolean;
    selected: boolean;
    dropMode: DropMode | null;
    /** The keyboard hint's row: the one tab lands on. */
    tabStop: boolean;
    canEdit: boolean;
    onToggle: (row: VisibleRow) => void;
    onOpen: (row: VisibleRow) => void;
    onSelect: (row: VisibleRow, extend: boolean) => void;
    onFocusRow: (key: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>, row: VisibleRow) => void;
    onEdit: (row: VisibleRow, edit: RowEdit) => void;
    moveTargets: (row: VisibleRow) => ChipOption[];
    onMoveTo: (row: VisibleRow, parentId: string | null) => void;
    onAdd: (row: VisibleRow, title: string) => Promise<void>;
    columnsOf: (projectId: string) => ColumnOption[] | null;
    membersOf: (projectId: string) => MemberOption[] | null;
    wantOptions: (projectId: string, what: 'columns' | 'members') => void;
}

export default function BacklogRow(props: BacklogRowProps) {
    const { row } = props;
    if (row.kind === 'addStory' || row.kind === 'addTask') return <AddRow {...props} />;
    return <ItemRow {...props} />;
}

function ItemRow({
    row,
    focused,
    selected,
    dropMode,
    tabStop,
    canEdit,
    onToggle,
    onOpen,
    onSelect,
    onFocusRow,
    onKeyDown,
    onEdit,
    moveTargets,
    onMoveTo,
    columnsOf,
    membersOf,
    wantOptions,
}: BacklogRowProps) {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const item = isItem(row);

    const draggable = useDraggable({ id: row.key, disabled: !item || !canEdit });
    const droppable = useDroppable({ id: row.key });
    const setRef = (node: HTMLElement | null) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
    };

    const heading = !item;
    const described = describe(row);
    const { code, muted, icon } = described;
    const title =
        row.kind === 'noEpic' ? m.backlog.noEpic : row.kind === 'unplanned' ? m.backlog.unplanned : described.title;
    const edgeClass = row.edge ? (EPIC_EDGE[row.edge] ?? EPIC_EDGE.GRAY) : 'border-s-transparent';

    return (
        <div
            ref={setRef}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.expandable ? row.expanded : undefined}
            aria-selected={selected}
            tabIndex={tabStop ? 0 : -1}
            data-row-key={row.key}
            onFocus={(event) => {
                if (event.target === event.currentTarget) onFocusRow(row.key);
            }}
            onKeyDown={(event) => onKeyDown(event, row)}
            className={`relative flex min-h-touch items-center gap-1.5 border-s-4 pe-2 outline-none md:min-h-10 ${edgeClass} ${
                INDENT[row.depth] ?? INDENT[3]
            } ${heading || row.kind === 'epic' ? 'bg-gray-50/60' : 'bg-white'} ${
                selected ? 'bg-blue-50' : 'hover:bg-gray-50'
            } ${focused ? 'ring-2 ring-inset ring-blue-600/40' : ''} ${draggable.isDragging ? 'opacity-40' : ''} ${
                dropMode === 'into' ? 'bg-blue-50 ring-2 ring-inset ring-blue-600' : ''
            }`}
        >
            {dropMode === 'before' || dropMode === 'after' ? (
                <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-0 h-0.5 bg-blue-600 ${dropMode === 'before' ? 'top-0' : 'bottom-0'}`}
                />
            ) : null}

            {item && canEdit ? (
                <button
                    type="button"
                    {...draggable.listeners}
                    {...draggable.attributes}
                    // After the spread: dnd-kit makes the handle a tab stop, but
                    // the row is the keyboard's unit here (Alt+arrows move it).
                    tabIndex={-1}
                    aria-label={m.backlog.dragHandle}
                    className="flex min-h-touch w-5 shrink-0 cursor-grab touch-none items-center justify-center text-gray-300 hover:text-gray-500 active:cursor-grabbing md:min-h-8"
                >
                    <GripVertical className="h-4 w-4" aria-hidden />
                </button>
            ) : (
                <span className="w-5 shrink-0" aria-hidden />
            )}

            {item ? (
                <input
                    type="checkbox"
                    tabIndex={-1}
                    checked={selected}
                    aria-label={fmt(m.backlog.select, { title: `${code} ${title}` })}
                    onChange={(event) =>
                        onSelect(row, (event.nativeEvent as MouseEvent).shiftKey === true)
                    }
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600/20"
                />
            ) : null}

            {row.expandable ? (
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onToggle(row)}
                    aria-label={row.expanded ? m.backlog.collapseRow : m.backlog.expandRow}
                    className="flex min-h-touch w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:min-h-8 md:w-6"
                >
                    {row.expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
            ) : (
                <span className="w-7 shrink-0 md:w-6" aria-hidden />
            )}

            <span className="shrink-0">{icon}</span>

            <button
                type="button"
                tabIndex={-1}
                onClick={() => (heading ? onToggle(row) : onOpen(row))}
                className="flex min-w-0 flex-1 items-baseline gap-2 text-start"
            >
                {code ? (
                    <span className="hidden shrink-0 font-mono text-xs text-gray-500 sm:inline">{code}</span>
                ) : null}
                <span
                    className={`truncate text-sm ${heading || row.kind === 'epic' ? 'font-semibold' : ''} ${
                        muted ? 'text-gray-500 line-through decoration-gray-300' : heading ? 'text-gray-700' : 'text-gray-900'
                    } hover:text-blue-600`}
                >
                    {title}
                </span>
                {heading && row.count !== undefined ? (
                    <span className="text-xs font-normal text-gray-400">{row.count}</span>
                ) : null}
            </button>

            {item ? (
                <>
                    {/* Fixed-width slots, so every level's numbers line up in
                        columns however long its counts or its status name. */}
                    <span className="hidden w-60 shrink-0 items-center justify-end gap-2 whitespace-nowrap text-xs text-gray-500 lg:flex">
                        <Meta row={row} canEdit={canEdit} onEdit={onEdit} />
                    </span>
                    <span className="hidden w-32 shrink-0 items-center md:flex">
                        <Progress
                            row={row}
                            canEdit={canEdit}
                            onEdit={onEdit}
                            membersOf={membersOf}
                            wantOptions={wantOptions}
                        />
                    </span>
                    <span className="flex shrink-0 justify-end whitespace-nowrap md:w-32">
                        <StatusChip row={row} canEdit={canEdit} onEdit={onEdit} columnsOf={columnsOf} wantOptions={wantOptions} />
                    </span>
                    {canEdit && row.kind !== 'epic' ? (
                        <span className="hidden shrink-0 sm:inline-flex">
                            <ChipPopover
                                label={fmt(m.backlog.moveToLabel, { title: code || title })}
                                value={row.parentId ?? ''}
                                display={<MoveRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />}
                                options={moveTargets(row)}
                                filterable
                                emptyLabel={row.kind === 'story' ? m.backlog.noEpic : m.backlog.noStory}
                                onPick={(value) => onMoveTo(row, value || null)}
                                variant="field"
                            />
                        </span>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}

function describe(row: VisibleRow): { code: string; title: string; muted: boolean; icon: ReactNode } {
    if (row.kind === 'project' && row.project) {
        return {
            code: row.project.code,
            title: row.project.name,
            muted: false,
            icon: <FolderKanban className="h-4 w-4 text-gray-500" aria-hidden />,
        };
    }
    if (row.kind === 'epic' && row.epic) {
        const epic = row.epic.epic;
        return {
            code: epic.code,
            title: epic.title,
            muted: epic.status === 'DONE' || epic.status === 'CANCELLED',
            icon: <Layers className="h-4 w-4 text-gray-600" aria-hidden />,
        };
    }
    if (row.kind === 'story' && row.story) {
        const story = row.story.story;
        return {
            code: story.code,
            title: story.title,
            muted: story.status === 'DONE',
            icon: <BookOpen className="h-4 w-4 text-blue-600" aria-hidden />,
        };
    }
    if (row.kind === 'task' && row.task) {
        const task = row.task.task;
        const done = isTaskDone(task);
        return {
            code: task.key,
            title: task.title,
            muted: done,
            icon: <SquareCheck className={`h-4 w-4 ${done ? 'text-emerald-600' : 'text-gray-400'}`} aria-hidden />,
        };
    }
    return {
        code: '',
        title: '',
        muted: false,
        icon:
            row.kind === 'unplanned' ? (
                <ListTodo className="h-4 w-4 text-gray-400" aria-hidden />
            ) : (
                <Layers className="h-4 w-4 text-gray-400" aria-hidden />
            ),
    };
}

/** Counts and sizes: the columns that say how big a row is and how far along. */
function Meta({ row, canEdit, onEdit }: { row: VisibleRow; canEdit: boolean; onEdit: BacklogRowProps['onEdit'] }) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    if (row.kind === 'epic' && row.epic) {
        const rollup = row.epic.rollup;
        return (
            <>
                <span>{fmt(m.epics.storyProgress, { done: rollup.doneStoryCount, total: rollup.storyCount })}</span>
                {rollup.points > 0 ? (
                    <span>{fmt(m.epics.pointsProgress, { done: rollup.donePoints, total: rollup.points })}</span>
                ) : null}
                <PriorityChip row={row} value={row.epic.epic.priority} canEdit={canEdit} onEdit={onEdit} />
            </>
        );
    }
    if (row.kind === 'story' && row.story) {
        const story = row.story.story;
        return (
            <>
                <span>
                    {fmt(m.stories.taskProgress, {
                        done: row.story.rollup.doneTaskCount,
                        total: row.story.rollup.taskCount,
                    })}
                </span>
                {canEdit ? (
                    <ChipPopover
                        variant="field"
                        label={fmt(m.backlog.pointsOf, { title: story.code })}
                        value={story.story_points == null ? '' : String(story.story_points)}
                        display={
                            story.story_points == null ? (
                                <span className="text-xs text-gray-400">{m.backlog.noPoints}</span>
                            ) : (
                                <span className="text-xs">{fmt(m.stories.pointsShort, { points: story.story_points })}</span>
                            )
                        }
                        tone={story.story_points == null ? 'muted' : 'default'}
                        options={POINTS.map((points) => ({ value: String(points), label: String(points) }))}
                        emptyLabel={m.backlog.noPoints}
                        onPick={(value) => onEdit(row, { field: 'points', value: value === '' ? null : Number(value) })}
                    />
                ) : story.story_points != null ? (
                    <span>{fmt(m.stories.pointsShort, { points: story.story_points })}</span>
                ) : null}
                <PriorityChip row={row} value={story.priority} canEdit={canEdit} onEdit={onEdit} />
            </>
        );
    }
    if (row.kind === 'task' && row.task) {
        const task = row.task.task;
        return (
            <>
                {task._count?.subtasks ? <span>{fmt(m.backlog.subtasks, { count: task._count.subtasks })}</span> : null}
                {task.estimate_hours != null || task.logged_hours > 0 ? (
                    <span>
                        {fmt(m.backlog.hours, {
                            logged: hours(task.logged_hours),
                            estimate: task.estimate_hours == null ? '—' : hours(task.estimate_hours),
                        })}
                    </span>
                ) : null}
                <PriorityChip row={row} value={task.priority} canEdit={canEdit} onEdit={onEdit} />
            </>
        );
    }
    return null;
}

function PriorityChip({
    row,
    value,
    canEdit,
    onEdit,
}: {
    row: VisibleRow;
    value: string;
    canEdit: boolean;
    onEdit: BacklogRowProps['onEdit'];
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const label = m.priority[value as keyof typeof m.priority] ?? value;
    const tone = value === 'URGENT' || value === 'HIGH' ? 'warning' : 'muted';
    if (!canEdit) return <span>{label}</span>;
    return (
        <ChipPopover
            variant="field"
            label={fmt(m.backlog.priorityOf, { title: describe(row).code })}
            value={value}
            display={<span className="text-xs">{label}</span>}
            tone={tone}
            options={PRIORITIES.map((priority) => ({ value: priority, label: m.priority[priority] }))}
            onPick={(next) => next && next !== value && onEdit(row, { field: 'priority', value: next })}
        />
    );
}

/** The bar for epics and stories; for a task, who holds it. */
function Progress({
    row,
    canEdit,
    onEdit,
    membersOf,
    wantOptions,
}: {
    row: VisibleRow;
    canEdit: boolean;
    onEdit: BacklogRowProps['onEdit'];
    membersOf: BacklogRowProps['membersOf'];
    wantOptions: BacklogRowProps['wantOptions'];
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const percent =
        row.kind === 'epic' && row.epic && row.epic.rollup.storyCount > 0
            ? row.epic.rollup.percent
            : row.kind === 'story' && row.story && row.story.rollup.taskCount > 0
              ? row.story.rollup.percent
              : null;
    if (percent !== null) {
        return (
            <span className="flex w-full items-center gap-2" title={`${percent}%`}>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                    <span className="block h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                </span>
                <span className="w-9 text-end text-xs tabular-nums text-gray-500">{percent}%</span>
            </span>
        );
    }
    if (row.kind !== 'task' || !row.task) return null;

    const task = row.task.task;
    const name = assigneeNameOf(task);
    if (!canEdit) {
        return (
            <span className={`truncate text-xs ${name ? 'text-gray-700' : 'text-gray-400'}`}>
                {name ?? m.backlog.unassigned}
            </span>
        );
    }
    const current = task.assignee ? `user:${task.assignee.id}` : task.assigneeEmployee ? `employee:${task.assigneeEmployee.id}` : '';
    const members = membersOf(row.projectId);
    const options: ChipOption[] = [...(members ?? [])];
    // The current holder stays pickable even before the roster arrives, or when
    // they have since left the team.
    if (current && name && !options.some((option) => option.value === current)) {
        options.unshift({ value: current, label: name });
    }
    return (
        <ChipPopover
            variant="field"
            label={fmt(m.backlog.assigneeOf, { title: task.key })}
            value={current}
            display={<span className="truncate text-xs">{name ?? m.backlog.unassigned}</span>}
            tone={name ? 'default' : 'muted'}
            options={options}
            filterable
            emptyLabel={m.backlog.unassigned}
            note={members === null ? t.common.loading : m.backlog.noTeam}
            onOpen={() => wantOptions(row.projectId, 'members')}
            onPick={(value) => value !== current && onEdit(row, { field: 'assignee', value })}
        />
    );
}

function StatusChip({
    row,
    canEdit,
    onEdit,
    columnsOf,
    wantOptions,
}: {
    row: VisibleRow;
    canEdit: boolean;
    onEdit: BacklogRowProps['onEdit'];
    columnsOf: BacklogRowProps['columnsOf'];
    wantOptions: BacklogRowProps['wantOptions'];
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    if (row.kind === 'epic' && row.epic) {
        const status = row.epic.epic.status;
        const badge = (
            <StatusBadge className="whitespace-nowrap" tone={EPIC_STATUS_TONE[status] ?? 'neutral'}>
                {m.epics.statuses[status as keyof typeof m.epics.statuses] ?? status}
            </StatusBadge>
        );
        if (!canEdit) return badge;
        return (
            <ChipPopover
                variant="field"
                label={fmt(m.backlog.statusOf, { title: row.epic.epic.code })}
                value={status}
                display={badge}
                options={EPIC_STATUSES.map((value) => ({ value, label: m.epics.statuses[value] }))}
                onPick={(value) => value && value !== status && onEdit(row, { field: 'status', value })}
            />
        );
    }

    if (row.kind === 'story' && row.story) {
        const story = row.story.story;
        const badge = (
            <StatusBadge className="whitespace-nowrap" tone={STORY_STATUS_TONE[story.status] ?? 'neutral'}>
                {m.stories.statuses[story.status as keyof typeof m.stories.statuses] ?? story.status}
            </StatusBadge>
        );
        // Once work has started the status follows the tasks, and there is
        // nothing a person could pick that the server would accept.
        const hasTasks = row.story.rollup.taskCount > 0;
        const locked = hasTasks && (story.status === 'IN_PROGRESS' || story.status === 'DONE');
        if (!canEdit || locked) return <span title={hasTasks ? m.stories.statusDerived : undefined}>{badge}</span>;
        const options = (hasTasks ? (['BACKLOG', 'READY'] as const) : (['BACKLOG', 'READY', 'IN_PROGRESS', 'DONE'] as const)).map(
            (value) => ({ value, label: m.stories.statuses[value] }),
        );
        return (
            <ChipPopover
                variant="field"
                label={fmt(m.backlog.statusOf, { title: story.code })}
                value={story.status}
                display={badge}
                options={options}
                footer={hasTasks ? m.stories.statusDerived : undefined}
                onPick={(value) => value && value !== story.status && onEdit(row, { field: 'status', value })}
            />
        );
    }

    if (row.kind === 'task' && row.task) {
        const task = row.task.task;
        if (!task.status) return null;
        const badge = (
            <StatusBadge className="whitespace-nowrap" tone={TASK_CATEGORY_TONE[task.status.category] ?? 'neutral'}>{task.status.name}</StatusBadge>
        );
        if (!canEdit) return badge;
        const columns = columnsOf(row.projectId);
        const options: ChipOption[] = (columns ?? [task.status]).map((column) => ({
            value: column.id,
            label: column.name,
        }));
        return (
            <ChipPopover
                variant="field"
                label={fmt(m.backlog.statusOf, { title: task.key })}
                value={task.status.id}
                display={badge}
                options={options}
                onOpen={() => wantOptions(row.projectId, 'columns')}
                onPick={(value) => value && value !== task.status?.id && onEdit(row, { field: 'status', value })}
            />
        );
    }
    return null;
}

function hours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * "+ Add story" at the foot of a group. Enter saves and keeps the box open for
 * the next one — writing out a backlog is several titles in a row, not one —
 * and Escape puts it away.
 */
function AddRow({ row, onAdd, canEdit, onKeyDown, tabStop, onFocusRow, focused, dropMode }: BacklogRowProps) {
    const { t } = useI18n();
    const m = t.projects;
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    // A drop target too: "last in this group" is the easiest place to aim.
    const droppable = useDroppable({ id: row.key });
    if (!canEdit) return null;

    const isStory = row.kind === 'addStory';
    const label = isStory ? m.backlog.addStory : m.backlog.addTask;
    const placeholder = isStory ? m.epics.storyPlaceholder : m.stories.taskPlaceholder;
    const edgeClass = row.edge ? (EPIC_EDGE[row.edge] ?? EPIC_EDGE.GRAY) : 'border-s-transparent';

    const submit = async () => {
        const title = value.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
            await onAdd(row, title);
            setValue('');
        } catch {
            // The page has already said why; the text stays for another try.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            ref={droppable.setNodeRef}
            role="none"
            data-row-key={row.key}
            className={`flex min-h-touch items-center gap-2 border-s-4 pe-2 md:min-h-9 ${edgeClass} ${INDENT[row.depth] ?? INDENT[3]} ${
                dropMode ? 'bg-blue-50 ring-2 ring-inset ring-blue-600' : ''
            }`}
        >
            {/* Gutter for the handle, checkbox and chevron the item rows carry. */}
            <span className="w-16 shrink-0" aria-hidden />
            {open ? (
                <Input
                    autoFocus
                    value={value}
                    disabled={busy}
                    placeholder={placeholder}
                    aria-label={label}
                    maxLength={300}
                    className="max-w-xl"
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            void submit();
                        } else if (event.key === 'Escape') {
                            setOpen(false);
                            setValue('');
                        }
                    }}
                    onBlur={() => {
                        if (!value.trim() && !busy) setOpen(false);
                    }}
                />
            ) : (
                <button
                    type="button"
                    tabIndex={tabStop ? 0 : -1}
                    data-row-key={row.key}
                    onFocus={() => onFocusRow(row.key)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') return;
                        onKeyDown(event, row);
                    }}
                    onClick={() => setOpen(true)}
                    className={`flex min-h-touch items-center gap-1 rounded text-xs font-medium text-gray-500 outline-none hover:text-blue-600 md:min-h-8 ${
                        focused ? 'ring-2 ring-blue-600/40' : ''
                    }`}
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {label}
                </button>
            )}
        </div>
    );
}
