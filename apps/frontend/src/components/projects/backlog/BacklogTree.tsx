'use client';

import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Layers, ListTodo, Plus, SquareCheck } from 'lucide-react';
import { Input, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { EPIC_STATUS_TONE } from '@/components/projects/ProjectEpicsCard';
import { useI18n } from '@/lib/i18n';
import {
    NO_EPIC_GROUP,
    UNPLANNED_GROUP,
    assigneeNameOf,
    isTaskDone,
    type BacklogTree as Tree,
    type EpicNode,
    type StoryNode,
    type TaskNode,
} from './backlog-tree';

const STORY_STATUS_TONE: Record<string, StatusBadgeTone> = {
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

/**
 * The epic's colour down the left edge of its whole block, so every story and
 * task under it reads as part of it without a chip on each row. Whole class
 * strings, for the reason `LABEL_CLASS` gives.
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
const INDENT = ['ps-2', 'ps-5 md:ps-8', 'ps-8 md:ps-14'] as const;

export interface BacklogTreeProps {
    tree: Tree;
    expanded: Set<string>;
    onToggle: (id: string) => void;
    onOpenEpic: (epicId: string) => void;
    onOpenStory: (storyId: string) => void;
    onOpenTask: (taskId: string) => void;
    /** Resolves once saved; a rejection leaves the text in the box to retry. */
    onAddStory: (epicId: string | null, title: string) => Promise<void>;
    onAddTask: (storyId: string | null, title: string) => Promise<void>;
    /** Hides the inline composers for a viewer who may only read. */
    canEdit: boolean;
    /** While filtering, an empty "No epic" group is noise rather than a place to write. */
    filtering?: boolean;
}

/**
 * Epic → story → task as one indented tree, each level collapsible, each parent
 * carrying the rollup of what is under it.
 *
 * Rows only; data, filters and what "open" means belong to the page. ARIA tree
 * semantics so a screen reader announces level and expanded state rather than a
 * flat run of links.
 */
export default function BacklogTree({
    tree,
    expanded,
    onToggle,
    onOpenEpic,
    onOpenStory,
    onOpenTask,
    onAddStory,
    onAddTask,
    canEdit,
    filtering = false,
}: BacklogTreeProps) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const renderTask = (node: TaskNode, level: number) => {
        const task = node.task;
        const assignee = assigneeNameOf(task);
        const done = isTaskDone(task);
        return (
            <Row
                key={node.id}
                level={level}
                icon={<SquareCheck className={`h-4 w-4 ${done ? 'text-emerald-600' : 'text-gray-400'}`} aria-hidden />}
                code={task.key}
                title={task.title}
                muted={done}
                onOpen={() => onOpenTask(task.id)}
                status={
                    task.status ? (
                        <StatusBadge tone={TASK_CATEGORY_TONE[task.status.category] ?? 'neutral'}>
                            {task.status.name}
                        </StatusBadge>
                    ) : null
                }
                meta={
                    <>
                        {task._count?.subtasks ? (
                            <span>{fmt(m.backlog.subtasks, { count: task._count.subtasks })}</span>
                        ) : null}
                        {task.estimate_hours != null || task.logged_hours > 0 ? (
                            <span>
                                {fmt(m.backlog.hours, {
                                    logged: hours(task.logged_hours),
                                    estimate: task.estimate_hours == null ? '—' : hours(task.estimate_hours),
                                })}
                            </span>
                        ) : null}
                    </>
                }
                assignee={assignee ?? m.backlog.unassigned}
                assigneeMissing={!assignee}
            />
        );
    };

    const renderStory = (node: StoryNode, level: number) => {
        const story = node.story;
        const open = expanded.has(node.id);
        return (
            <div key={node.id} role="none">
                <Row
                    level={level}
                    expanded={open}
                    onToggle={() => onToggle(node.id)}
                    icon={<BookOpen className="h-4 w-4 text-blue-600" aria-hidden />}
                    code={story.code}
                    title={story.title}
                    muted={story.status === 'DONE'}
                    onOpen={() => onOpenStory(story.id)}
                    status={
                        <StatusBadge tone={STORY_STATUS_TONE[story.status] ?? 'neutral'}>
                            {m.stories.statuses[story.status as keyof typeof m.stories.statuses] ?? story.status}
                        </StatusBadge>
                    }
                    progress={node.rollup.taskCount > 0 ? node.rollup.percent : null}
                    meta={
                        <>
                            <span>
                                {fmt(m.stories.taskProgress, {
                                    done: node.rollup.doneTaskCount,
                                    total: node.rollup.taskCount,
                                })}
                            </span>
                            {story.story_points != null ? (
                                <span>{fmt(m.stories.pointsShort, { points: story.story_points })}</span>
                            ) : null}
                        </>
                    }
                />
                {open ? (
                    <div role="group">
                        {node.tasks.map((task) => renderTask(task, level + 1))}
                        {canEdit ? (
                            <InlineAdd
                                level={level + 1}
                                label={m.backlog.addTask}
                                placeholder={m.stories.taskPlaceholder}
                                onSubmit={(title) => onAddTask(story.id, title)}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    };

    const renderEpic = (node: EpicNode) => {
        const epic = node.epic;
        const open = expanded.has(node.id);
        const rollup = node.rollup;
        return (
            <div
                key={node.id}
                role="none"
                className={`border-s-4 ${EPIC_EDGE[epic.color] ?? EPIC_EDGE.GRAY}`}
            >
                <Row
                    level={0}
                    strong
                    expanded={open}
                    onToggle={() => onToggle(node.id)}
                    icon={<Layers className="h-4 w-4 text-gray-600" aria-hidden />}
                    code={epic.code}
                    title={epic.title}
                    muted={epic.status === 'DONE' || epic.status === 'CANCELLED'}
                    onOpen={() => onOpenEpic(epic.id)}
                    status={
                        <StatusBadge tone={EPIC_STATUS_TONE[epic.status] ?? 'neutral'}>
                            {m.epics.statuses[epic.status as keyof typeof m.epics.statuses] ?? epic.status}
                        </StatusBadge>
                    }
                    progress={rollup.storyCount > 0 ? rollup.percent : null}
                    meta={
                        <>
                            <span>
                                {fmt(m.epics.storyProgress, {
                                    done: rollup.doneStoryCount,
                                    total: rollup.storyCount,
                                })}
                            </span>
                            {rollup.points > 0 ? (
                                <span>
                                    {fmt(m.epics.pointsProgress, { done: rollup.donePoints, total: rollup.points })}
                                </span>
                            ) : null}
                        </>
                    }
                />
                {open ? (
                    <div role="group">
                        {node.stories.map((story) => renderStory(story, 1))}
                        {canEdit ? (
                            <InlineAdd
                                level={1}
                                label={m.backlog.addStory}
                                placeholder={m.epics.storyPlaceholder}
                                onSubmit={(title) => onAddStory(epic.id, title)}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    };

    const noEpicOpen = expanded.has(NO_EPIC_GROUP);
    const unplannedOpen = expanded.has(UNPLANNED_GROUP);

    return (
        <div role="tree" aria-label={m.backlog.title} className="divide-y divide-gray-100">
            {tree.epics.map(renderEpic)}

            {tree.noEpic.length > 0 || (canEdit && !filtering) ? (
                <div role="none" className="border-s-4 border-s-transparent">
                    <GroupHeader
                        label={m.backlog.noEpic}
                        count={tree.noEpic.length}
                        expanded={noEpicOpen}
                        onToggle={() => onToggle(NO_EPIC_GROUP)}
                    />
                    {noEpicOpen ? (
                        <div role="group">
                            {tree.noEpic.map((story) => renderStory(story, 1))}
                            {canEdit ? (
                                <InlineAdd
                                    level={1}
                                    label={m.backlog.addStory}
                                    placeholder={m.epics.storyPlaceholder}
                                    onSubmit={(title) => onAddStory(null, title)}
                                />
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {tree.unplanned.length > 0 ? (
                <div role="none" className="border-s-4 border-s-transparent">
                    <GroupHeader
                        label={m.backlog.unplanned}
                        count={tree.unplanned.length}
                        expanded={unplannedOpen}
                        onToggle={() => onToggle(UNPLANNED_GROUP)}
                        icon={<ListTodo className="h-4 w-4 text-gray-400" aria-hidden />}
                    />
                    {unplannedOpen ? (
                        <div role="group">{tree.unplanned.map((task) => renderTask(task, 1))}</div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function hours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Chevron({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
    const { t } = useI18n();
    const Icon = expanded ? ChevronDown : ChevronRight;
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? t.projects.backlog.collapseRow : t.projects.backlog.expandRow}
            className="flex min-h-touch w-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:min-h-8 md:w-6"
        >
            <Icon className="h-4 w-4" aria-hidden />
        </button>
    );
}

function Row({
    level,
    strong = false,
    expanded,
    onToggle,
    icon,
    code,
    title,
    muted = false,
    onOpen,
    status,
    progress = null,
    meta,
    assignee,
    assigneeMissing = false,
}: {
    level: number;
    strong?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
    icon: ReactNode;
    code: string;
    title: string;
    muted?: boolean;
    onOpen: () => void;
    status: ReactNode;
    progress?: number | null;
    meta?: ReactNode;
    assignee?: string;
    assigneeMissing?: boolean;
}) {
    return (
        <div
            role="treeitem"
            aria-selected={false}
            aria-level={level + 1}
            aria-expanded={onToggle ? Boolean(expanded) : undefined}
            className={`flex min-h-touch items-center gap-2 pe-2 hover:bg-gray-50 md:min-h-10 ${INDENT[level] ?? INDENT[2]} ${strong ? 'bg-gray-50/60' : ''}`}
        >
            {onToggle ? (
                <Chevron expanded={Boolean(expanded)} onToggle={onToggle} />
            ) : (
                <span className="w-8 shrink-0 md:w-6" aria-hidden />
            )}
            <span className="shrink-0">{icon}</span>
            <button
                type="button"
                onClick={onOpen}
                className="flex min-w-0 flex-1 items-baseline gap-2 text-start"
            >
                {/* The ID yields to the title on a phone; the panel still shows it. */}
                <span className="hidden shrink-0 font-mono text-xs text-gray-500 sm:inline">{code}</span>
                <span
                    className={`truncate text-sm ${strong ? 'font-semibold' : ''} ${muted ? 'text-gray-500 line-through decoration-gray-300' : 'text-gray-900'} hover:text-blue-600`}
                >
                    {title}
                </span>
            </button>
            {/* Fixed-width slots, so every level's numbers line up in columns
                however long its counts or its status name. */}
            <span className="hidden w-44 shrink-0 items-center justify-end gap-3 text-xs text-gray-500 lg:flex">
                {meta}
            </span>
            <span className="hidden w-32 shrink-0 items-center md:flex">
                {progress != null ? (
                    <span className="flex w-full items-center gap-2" title={`${progress}%`}>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                            <span className="block h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
                        </span>
                        <span className="w-9 text-end text-xs tabular-nums text-gray-500">{progress}%</span>
                    </span>
                ) : assignee !== undefined ? (
                    <span className={`truncate text-xs ${assigneeMissing ? 'text-gray-400' : 'text-gray-700'}`}>
                        {assignee}
                    </span>
                ) : null}
            </span>
            <span className="flex shrink-0 justify-end md:w-24">{status}</span>
        </div>
    );
}

function GroupHeader({
    label,
    count,
    expanded,
    onToggle,
    icon,
}: {
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    icon?: ReactNode;
}) {
    return (
        <div
            role="treeitem"
            aria-selected={false}
            aria-level={1}
            aria-expanded={expanded}
            className={`flex min-h-touch items-center gap-2 bg-gray-50/60 pe-2 md:min-h-10 ${INDENT[0]}`}
        >
            <Chevron expanded={expanded} onToggle={onToggle} />
            {icon ?? <Layers className="h-4 w-4 text-gray-400" aria-hidden />}
            <button type="button" onClick={onToggle} className="flex-1 text-start text-sm font-semibold text-gray-600">
                {label}
                <span className="ms-2 text-xs font-normal text-gray-400">{count}</span>
            </button>
        </div>
    );
}

/**
 * "+ Add story" at the foot of a group. Enter saves and keeps the box open for
 * the next one — writing out a backlog is several titles in a row, not one —
 * and Escape puts it away.
 */
function InlineAdd({
    level,
    label,
    placeholder,
    onSubmit,
}: {
    level: number;
    label: string;
    placeholder: string;
    onSubmit: (title: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        const title = value.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
            await onSubmit(title);
            setValue('');
        } catch {
            // The page has already said why; the text stays for another try.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div role="none" className={`flex min-h-touch items-center gap-2 pe-2 md:min-h-9 ${INDENT[level] ?? INDENT[2]}`}>
            <span className="w-8 shrink-0 md:w-6" aria-hidden />
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
                    onClick={() => setOpen(true)}
                    className="flex min-h-touch items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 md:min-h-8"
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {label}
                </button>
            )}
        </div>
    );
}
