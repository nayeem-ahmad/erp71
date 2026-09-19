'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Input } from '@/components/ui';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { projectDotClass } from './hour-log-day';
import type { CaptureTask } from './TimeTrackerForm';

export interface TaskPickerLabels {
    /** Caption for the box itself, for screen readers. */
    task: string;
    search: string;
    noTasks: string;
    noMatches: string;
    clear: string;
    loading: string;
}

interface Props {
    labels: TaskPickerLabels;
    tasks: CaptureTask[];
    loading?: boolean;
    value: string;
    onChange: (taskId: string) => void;
    /** Shown beside a title when the list spans projects and codes disambiguate. */
    showProject?: boolean;
}

/** Case-insensitive substring over the title and, when shown, the project code. */
function matches(task: CaptureTask, query: string, showProject: boolean): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    if (task.title.toLowerCase().includes(needle)) return true;
    if (!showProject) return false;
    const project = task.project;
    return Boolean(
        project &&
            (project.code.toLowerCase().includes(needle) ||
                project.name.toLowerCase().includes(needle)),
    );
}

/**
 * The tracker's task box: type to narrow, click or Enter to pick.
 *
 * A `<select>` cannot be searched, and the list it stood in front of is now
 * everything on your plate across every project rather than one project's
 * tasks — a hundred options deep in places, which is not a list anybody scrolls
 * to find a task they can name. The dropdown renders inline, below the input
 * and inside the panel's own flow, because a popover positioned against the
 * viewport is clipped by the panel's scroll box; the same reason the tag picker
 * beside it is inline.
 */
export default function TaskPicker({
    labels,
    tasks,
    loading = false,
    value,
    onChange,
    showProject = false,
}: Props) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const selected = tasks.find((task) => task.id === value) ?? null;

    const filtered = useMemo(
        () => tasks.filter((task) => matches(task, query, showProject)),
        [tasks, query, showProject],
    );

    useDismissOnClickOutside(
        open,
        (target) => Boolean(rootRef.current?.contains(target)),
        () => setOpen(false),
    );

    // A narrowed list renumbers itself, so the highlight goes back to the top
    // rather than pointing past the end of what is now on screen.
    useEffect(() => setActive(0), [query, tasks]);

    // Follow the highlight when the arrows walk it past the fold. Guarded
    // because scrolling an element into view is not implemented everywhere the
    // component runs — jsdom has no layout and so no `scrollIntoView` — and a
    // picker that throws is worse than one that does not scroll.
    useEffect(() => {
        if (!open) return;
        const row = listRef.current?.children[active];
        if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' });
        }
    }, [active, open]);

    const pick = (task: CaptureTask) => {
        onChange(task.id);
        setQuery('');
        setOpen(false);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((index) => {
                if (filtered.length === 0) return 0;
                return (index + step + filtered.length) % filtered.length;
            });
            return;
        }
        if (event.key === 'Enter') {
            if (!open) return;
            event.preventDefault();
            const task = filtered[active];
            if (task) pick(task);
            return;
        }
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
        }
    };

    // With a task picked the box shows its title; typing in it searches again.
    const display = open ? query : (selected?.title ?? '');

    return (
        <div ref={rootRef} className="relative">
            <div className="relative">
                <Search
                    className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                    aria-hidden="true"
                />
                <Input
                    value={display}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        if (!open) setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={loading ? labels.loading : labels.search}
                    aria-label={labels.task}
                    role="combobox"
                    aria-expanded={open}
                    aria-autocomplete="list"
                    className={`w-full ps-7 ${selected ? 'pe-8' : ''}`}
                />
                {selected ? (
                    <button
                        type="button"
                        onClick={() => {
                            onChange('');
                            setQuery('');
                            setOpen(false);
                        }}
                        aria-label={labels.clear}
                        title={labels.clear}
                        className="absolute end-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                ) : null}
            </div>

            {open ? (
                <ul
                    ref={listRef}
                    role="listbox"
                    aria-label={labels.task}
                    className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
                >
                    {filtered.length === 0 ? (
                        <li className="px-2 py-2 text-xs text-gray-500">
                            {tasks.length === 0 ? labels.noTasks : labels.noMatches}
                        </li>
                    ) : (
                        filtered.map((task, index) => (
                            <li key={task.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={task.id === value}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => pick(task)}
                                    className={`flex min-h-touch w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors md:min-h-0 md:py-1.5 ${
                                        index === active ? 'bg-blue-50' : 'hover:bg-gray-50'
                                    }`}
                                >
                                    {showProject ? (
                                        <span
                                            className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(task.project?.code)}`}
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                    {showProject && task.project ? (
                                        <span className="flex-shrink-0 text-xs text-gray-400">
                                            {task.project.code}
                                        </span>
                                    ) : null}
                                    {task.id === value ? (
                                        <Check
                                            className="h-3.5 w-3.5 flex-shrink-0 text-blue-600"
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            ) : null}
        </div>
    );
}
