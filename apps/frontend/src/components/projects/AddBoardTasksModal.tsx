'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectLabelOf, type BoardProject } from './board-tasks';

interface PickerProject {
    id: string;
    code: string;
    name: string;
}

interface PickerTask {
    id: string;
    title: string;
    project?: BoardProject | null;
}

interface AddBoardTasksModalProps {
    boardId: string;
    /**
     * Task ids already on the board. They are filtered out of the list: the
     * picker offers what can be added, and a row that cannot be picked is only
     * something to scroll past. The board itself is what shows what is on it.
     */
    onBoardTaskIds?: string[];
    /**
     * Opens the picker on this project rather than on the whole workspace. The
     * board page passes its own project when every card comes from one.
     */
    defaultProjectId?: string;
    onClose: () => void;
    onAdded: () => void;
}

/**
 * How many tasks one page of the picker holds.
 *
 * 200 is the ceiling `ProjectTasksService.list` clamps `limit` to, so asking for
 * more is silently reduced rather than honoured. At this size most boards are
 * filled from a single page and the paging controls never appear at all.
 */
const PAGE_SIZE = 200;

/** Cross-project task picker used to add existing tasks to a board. */
export default function AddBoardTasksModal({
    boardId,
    onBoardTaskIds,
    defaultProjectId = '',
    onClose,
    onAdded,
}: AddBoardTasksModalProps) {
    const { t, fmt } = useI18n();
    const m = t.projects.boards;

    const [projects, setProjects] = useState<PickerProject[]>([]);
    const [projectId, setProjectId] = useState(defaultProjectId);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [tasks, setTasks] = useState<PickerTask[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    const onBoard = useMemo(() => new Set(onBoardTaskIds ?? []), [onBoardTaskIds]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as PickerProject[]))
            .catch(() => setProjects([]));
    }, []);

    // Debounced like the workspace-wide tasks list (projects/tasks/page.tsx) — a
    // fetch per keystroke would hammer the endpoint for no benefit.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Only the newest request is allowed to write state: a slow first page that
    // lands after a narrower one would otherwise overwrite it with stale rows.
    const requestId = useRef(0);

    const load = useCallback(
        async (nextPage: number, append: boolean) => {
            const seq = ++requestId.current;
            if (append) setLoadingMore(true);
            else setLoading(true);
            try {
                const res = await api.getProjectTasks({
                    search: debouncedSearch || undefined,
                    projectId: projectId || undefined,
                    page: nextPage,
                    limit: PAGE_SIZE,
                });
                if (seq !== requestId.current) return;
                const items = (res?.items ?? []) as PickerTask[];
                setTasks((prev) => (append ? [...prev, ...items] : items));
                // `total` is the server's count for the whole filter, not the
                // page — it is what tells the reader there is more to load.
                setTotal(typeof res?.total === 'number' ? res.total : items.length);
                setPage(nextPage);
            } catch {
                if (seq !== requestId.current) return;
                if (!append) {
                    setTasks([]);
                    setTotal(0);
                }
            } finally {
                if (seq === requestId.current) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        },
        [debouncedSearch, projectId],
    );

    // Back to page one whenever the filter changes; `load`'s identity changes
    // with it, so this fires exactly when the results would differ.
    useEffect(() => {
        load(1, false);
    }, [load]);

    const toggle = (taskId: string) => {
        // A Set (not an array) so re-narrowing the filter never silently drops an
        // earlier pick that has scrolled out of the current results.
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    };

    /**
     * What the picker lists — and, since nothing unpickable is shown any more,
     * also exactly what "select all" acts on.
     */
    const selectable = useMemo(
        () => tasks.filter((task) => !onBoard.has(task.id)),
        [tasks, onBoard],
    );
    const allSelected =
        selectable.length > 0 && selectable.every((task) => selected.has(task.id));
    const someSelected = selectable.some((task) => selected.has(task.id));

    /**
     * The server counts the board's own cards in `total`, because it does not
     * know which of them are already here. Reporting that number raw would
     * overstate what is on offer, so the hidden rows are discounted.
     *
     * Only the ones actually seen can be discounted — a card sitting on a page
     * nobody has loaded is still inside the server's count — so this closes the
     * gap as paging proceeds rather than guessing at it up front.
     */
    const hiddenSoFar = tasks.length - selectable.length;
    const pickableTotal = Math.max(total - hiddenSoFar, selectable.length);

    /**
     * Whether more rows exist, measured against what was *fetched* rather than
     * what is shown: a page made entirely of cards already on the board hides
     * every row it brought back, and comparing visible rows to the total would
     * read that as "nothing more to load" and strand the rest.
     */
    const hasMore = tasks.length < total;

    const toggleAll = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const task of selectable) {
                if (allSelected) next.delete(task.id);
                else next.add(task.id);
            }
            return next;
        });
    };

    /**
     * Fetch every remaining page in one go.
     *
     * A loop rather than one enormous request because the backend clamps a page
     * to 200 however much is asked for. Each round reads the response it just
     * received instead of component state, which the pending re-render has not
     * applied yet; and it stops the moment `requestId` moves, so changing the
     * filter mid-loop abandons it rather than appending rows from the old one.
     */
    const loadAll = useCallback(async () => {
        const seq = requestId.current;
        setLoadingMore(true);
        try {
            let nextPage = page;
            let loaded = tasks.length;
            let expected = total;

            while (loaded < expected) {
                nextPage += 1;
                const res = await api.getProjectTasks({
                    search: debouncedSearch || undefined,
                    projectId: projectId || undefined,
                    page: nextPage,
                    limit: PAGE_SIZE,
                });
                if (seq !== requestId.current) return;

                const items = (res?.items ?? []) as PickerTask[];
                // A page that comes back empty means the count and the rows
                // disagree — stop rather than spin until the count is met.
                if (items.length === 0) break;

                loaded += items.length;
                if (typeof res?.total === 'number') expected = res.total;
                setTasks((prev) => [...prev, ...items]);
                setTotal(expected);
                setPage(nextPage);
            }
        } catch {
            // Whatever arrived stays listed and `Load more` remains, so the
            // reader can retry a page without losing the ones already in.
        } finally {
            if (seq === requestId.current) setLoadingMore(false);
        }
    }, [debouncedSearch, projectId, page, tasks.length, total]);

    const submit = async () => {
        if (selected.size === 0) return;
        setSubmitting(true);
        try {
            await api.addBoardTasks(boardId, [...selected]);
            toast.success(m.added);
            onAdded();
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader title={m.addTasksTitle} onClose={onClose} />
            <div className="space-y-4 p-3 md:p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-end">
                    <Field label={m.searchTasks} htmlFor="board-task-search" className="flex-1">
                        <Input
                            id="board-task-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </Field>
                    <Field label={t.projects.fields.project} htmlFor="board-task-project" className="md:w-52">
                        <Select
                            id="board-task-project"
                            value={projectId}
                            onChange={(event) => setProjectId(event.target.value)}
                        >
                            <option value="">{m.allProjects}</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.code} · {project.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </div>

                {loading ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : selectable.length === 0 && !hasMore ? (
                    // Two different empty states. "Nothing matched" and "it is
                    // all here already" look identical in an empty list, and
                    // telling them apart is what stops a reader hunting for a
                    // task the picker deliberately removed.
                    //
                    // Guarded on `!hasMore`: a page made entirely of the board's
                    // own cards is empty but not finished, and settling on an
                    // empty state there would strand the pages behind it.
                    <p className="text-sm text-gray-500">
                        {tasks.length > 0 ? m.allOnBoard : m.noResults}
                    </p>
                ) : (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 pb-2">
                            <label className="flex min-h-touch items-center gap-2">
                                <Checkbox
                                    aria-label={t.common.selectAll}
                                    checked={allSelected}
                                    disabled={selectable.length === 0}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someSelected && !allSelected;
                                    }}
                                    onChange={toggleAll}
                                />
                                <span className="text-sm text-gray-700">{t.common.selectAll}</span>
                            </label>
                            <span className="text-xs text-gray-500">
                                {fmt(m.showingCount, {
                                    shown: selectable.length,
                                    total: pickableTotal,
                                })}
                            </span>
                            {selected.size > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setSelected(new Set())}
                                    className="ms-auto text-xs font-medium text-blue-600 hover:underline"
                                >
                                    {t.common.clearAll}
                                </button>
                            )}
                        </div>

                        {selectable.map((task) => (
                            <label
                                key={task.id}
                                className="flex min-h-touch items-center gap-3 rounded-lg border border-gray-200 p-3"
                            >
                                <Checkbox
                                    aria-label={task.title}
                                    checked={selected.has(task.id)}
                                    onChange={() => toggle(task.id)}
                                />
                                <span className="flex-1 text-sm text-gray-900">{task.title}</span>
                                {task.project ? (
                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                        {projectLabelOf(task.project)}
                                    </span>
                                ) : null}
                            </label>
                        ))}

                        {hasMore && (
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    className="flex-1 justify-center"
                                    loading={loadingMore}
                                    onClick={() => load(page + 1, true)}
                                >
                                    {m.loadMore}
                                </Button>
                                <Button
                                    variant="secondary"
                                    className="flex-1 justify-center"
                                    disabled={loadingMore}
                                    onClick={loadAll}
                                >
                                    {m.loadAll}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button onClick={submit} disabled={submitting || selected.size === 0}>
                    {t.common.add} ({m.selectedCount.replace('{count}', String(selected.size))})
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
