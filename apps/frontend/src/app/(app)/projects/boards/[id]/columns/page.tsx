'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { projectLabelOf, type BoardProject, type BoardTask } from '@/components/projects/board-tasks';

interface BoundStatus {
    id: string;
    name: string;
    project_id: string;
}

interface Binding {
    id: string;
    status_id: string;
    status: BoundStatus;
}

interface Column {
    id: string;
    name: string;
    category: string;
    sort_order: number;
    wip_limit?: number | null;
    bindings: Binding[];
}

interface ProjectStatus {
    id: string;
    name: string;
}

/** The subset of `api.getBoard`'s response this page reads. */
interface BoardDetail {
    id: string;
    name: string;
    columns?: { tasks: BoardTask[] }[];
    unsorted?: BoardTask[];
}

interface EditDraft {
    name: string;
    category: string;
    wipLimit: string;
}

const draftOf = (column: Column): EditDraft => ({
    name: column.name,
    category: column.category,
    wipLimit: column.wip_limit != null ? String(column.wip_limit) : '',
});

/**
 * Task 11: board settings. Column shape and the name/category/WIP row are
 * modelled on the per-project columns page (`/projects/[id]/columns`), which
 * stays untouched — that page edits a project's own status list; this one
 * edits a board's columns and, uniquely to a board, which project statuses
 * feed into each one.
 */
export default function BoardColumnsSettingsPage() {
    const params = useParams<{ id: string }>();
    const boardId = params.id;
    const { t } = useI18n();
    const m = t.projects.boards;
    const cm = t.projects.columns;
    const categories = t.projects.settings.categories;

    const [boardName, setBoardName] = useState<string | null>(null);
    const [columns, setColumns] = useState<Column[]>([]);
    // Projects with a card on this board right now — the primary source for
    // which projects get a row in the bindings panel below, and for their
    // display names (real names, not derived from a status/binding).
    const [cardProjects, setCardProjects] = useState<Record<string, BoardProject>>({});
    // Tenant-wide project list, kept only as a name fallback for a project
    // that is bound on this board but no longer has any card on it (see
    // `boardProjects` below) — it is never used to decide which projects to
    // offer.
    const [projects, setProjects] = useState<BoardProject[]>([]);
    const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({});
    const [edits, setEdits] = useState<Record<string, EditDraft>>({});
    const [wipErrors, setWipErrors] = useState<Record<string, boolean>>({});
    const [draft, setDraft] = useState({ name: '', category: 'TODO' });
    const [deleting, setDeleting] = useState<Column | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const list = (await api.getBoardColumns(boardId)) as Column[];
            const safe = Array.isArray(list) ? list : [];
            setColumns(safe);
            setEdits(Object.fromEntries(safe.map((column) => [column.id, draftOf(column)])));
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [boardId]);

    useEffect(() => {
        load();
        api.getBoard(boardId)
            .then((res: unknown) => {
                const board = res as BoardDetail | null;
                setBoardName(board?.name ?? null);

                // Every project with a card on the board, bound or not — a card
                // sits in Unsorted *because* its status has no binding, so this
                // is deliberately not derived from `bindings`. That would erase
                // from this page's own controls exactly the projects this page
                // exists to fix.
                const tasks: BoardTask[] = [
                    ...(board?.columns ?? []).flatMap((column) => column.tasks ?? []),
                    ...(board?.unsorted ?? []),
                ];
                const map: Record<string, BoardProject> = {};
                for (const task of tasks) {
                    if (task.project) map[task.project.id] = task.project;
                }
                setCardProjects(map);
            })
            .catch(() => {
                setBoardName(null);
                setCardProjects({});
            });
        // Fallback name source only — see the `projects` state comment above.
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as BoardProject[]))
            .catch(() => setProjects([]));
    }, [load, boardId]);

    // The board's own cards decide which projects get a row, unioned with
    // whatever is currently bound — so a binding whose project no longer has
    // a card on the board still shows (and is fixable) rather than becoming
    // unreachable.
    const boardProjects = useMemo(() => {
        const byId: Record<string, BoardProject> = { ...cardProjects };
        for (const column of columns) {
            for (const binding of column.bindings) {
                const projectId = binding.status.project_id;
                if (!byId[projectId]) {
                    byId[projectId] =
                        projects.find((p) => p.id === projectId) ??
                        ({ id: projectId, code: projectId, name: projectId } as BoardProject);
                }
            }
        }
        return Object.values(byId);
    }, [cardProjects, columns, projects]);

    // Fetched once per project, lazily, the first time it shows up bound to a
    // column — most boards only ever touch a handful of projects. A ref (not
    // `statusesByProject` itself) tracks what has been requested so the effect
    // does not need that state in its dependency list.
    const requested = useRef<Set<string>>(new Set());
    useEffect(() => {
        const missing = boardProjects.filter((project) => !requested.current.has(project.id));
        missing.forEach((project) => {
            requested.current.add(project.id);
            api.getProjectColumns(project.id, true)
                .then((list: unknown) =>
                    setStatusesByProject((prev) => ({
                        ...prev,
                        [project.id]: Array.isArray(list) ? (list as ProjectStatus[]) : [],
                    })),
                )
                .catch(() => {
                    requested.current.delete(project.id);
                });
        });
    }, [boardProjects]);

    const run = async (action: () => Promise<unknown>, onOk?: () => void) => {
        setBusy(true);
        try {
            await action();
            onOk?.();
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setBusy(false);
        }
    };

    const addColumn = (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        run(
            () => api.createBoardColumn(boardId, { name: draft.name.trim(), category: draft.category }),
            () => setDraft({ name: '', category: 'TODO' }),
        );
    };

    const saveColumn = (column: Column) => {
        const edit = edits[column.id];
        if (!edit || !edit.name.trim()) return;

        const trimmed = edit.wipLimit.trim();
        const wipLimit = trimmed === '' ? null : Number(trimmed);
        if (wipLimit !== null && (!Number.isFinite(wipLimit) || wipLimit < 1)) {
            setWipErrors((prev) => ({ ...prev, [column.id]: true }));
            return;
        }
        setWipErrors((prev) => ({ ...prev, [column.id]: false }));

        run(() =>
            api.updateBoardColumn(boardId, column.id, {
                name: edit.name.trim(),
                category: edit.category,
                wipLimit,
            }),
        );
    };

    const deleteColumn = (column: Column) => {
        run(() => api.deleteBoardColumn(boardId, column.id), () => setDeleting(null));
    };

    // A select's onChange carries the full desired state for its column: the
    // other projects' bindings unchanged, plus this project pointed at the new
    // status (or dropped, when the value is the "—" option). setBindings on the
    // server replaces the column's bindings wholesale, so the array has to be
    // complete, not a delta.
    const setBinding = (column: Column, projectId: string, statusId: string) => {
        const others = column.bindings
            .filter((binding) => binding.status.project_id !== projectId)
            .map((binding) => binding.status_id);
        const next = statusId ? [...others, statusId] : others;
        run(() => api.setBoardColumnStatuses(boardId, column.id, next));
    };

    const projectLabel = (projectId: string) => {
        const project = cardProjects[projectId] ?? projects.find((p) => p.id === projectId);
        return project ? projectLabelOf(project) : projectId;
    };

    // Which column currently holds each status — so a project's status list
    // can flag the ones that belong to a *different* column on this board.
    // Picking one of those moves it there and then: the server takes a status
    // off whichever column holds it before binding it here, silently.
    const columnByStatusId = useMemo(() => {
        const map: Record<string, Column> = {};
        for (const column of columns) {
            for (const binding of column.bindings) map[binding.status_id] = column;
        }
        return map;
    }, [columns]);

    return (
        <PageShell>
            <PageHeader
                title={m.columns}
                subtitle={boardName ?? undefined}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    'projects',
                    [
                        {
                            label: boardName ?? m.title,
                            href: routes.projects.boardDetail(boardId),
                        },
                    ],
                    m.columns,
                )}
            />

            <section className="space-y-4">
                {failed ? (
                    <p className="rounded-md border border-gray-200 bg-white px-3 py-4 text-sm text-danger">
                        {m.loadFailed}
                    </p>
                ) : columns.length === 0 ? (
                    <p className="rounded-md border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                        {cm.empty}
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {columns.map((column) => {
                            const edit = edits[column.id] ?? draftOf(column);
                            return (
                                <li
                                    key={column.id}
                                    className="space-y-3 rounded-md border border-gray-200 bg-white p-3 md:p-4"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Input
                                            aria-label={`${m.columnName} — ${column.name}`}
                                            value={edit.name}
                                            className="min-w-[10rem] flex-1"
                                            disabled={busy}
                                            onChange={(e) =>
                                                setEdits((prev) => ({
                                                    ...prev,
                                                    [column.id]: { ...edit, name: e.target.value },
                                                }))
                                            }
                                        />
                                        <Select
                                            aria-label={`${m.category} — ${column.name}`}
                                            value={edit.category}
                                            className="w-40"
                                            disabled={busy}
                                            onChange={(e) =>
                                                setEdits((prev) => ({
                                                    ...prev,
                                                    [column.id]: { ...edit, category: e.target.value },
                                                }))
                                            }
                                        >
                                            {Object.entries(categories).map(([key, label]) => (
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ))}
                                        </Select>
                                        <label className="flex items-center gap-1 text-xs text-gray-500">
                                            {m.wipLimit}
                                            <Input
                                                type="number"
                                                min="1"
                                                className="w-20"
                                                aria-label={`${m.wipLimit} — ${column.name}`}
                                                placeholder={cm.noLimit}
                                                value={edit.wipLimit}
                                                disabled={busy}
                                                onChange={(e) =>
                                                    setEdits((prev) => ({
                                                        ...prev,
                                                        [column.id]: { ...edit, wipLimit: e.target.value },
                                                    }))
                                                }
                                            />
                                        </label>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            className="min-h-touch"
                                            disabled={busy || !edit.name.trim()}
                                            onClick={() => saveColumn(column)}
                                        >
                                            {t.common.save}
                                        </Button>
                                        <button
                                            type="button"
                                            aria-label={`${m.deleteColumn} — ${column.name}`}
                                            className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                            disabled={busy}
                                            onClick={() => setDeleting(column)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>

                                    {wipErrors[column.id] && (
                                        <p className="text-xs text-red-600">{m.wipInvalid}</p>
                                    )}

                                    <div className="space-y-2 border-t border-gray-100 pt-3">
                                        <p className="text-xs font-medium text-gray-700">
                                            {m.mappedStatuses}
                                        </p>

                                        {column.bindings.length === 0 ? (
                                            <p className="text-xs text-gray-500">{m.noMappings}</p>
                                        ) : (
                                            <ul className="flex flex-wrap gap-1.5">
                                                {column.bindings.map((binding) => (
                                                    <li
                                                        key={binding.id}
                                                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                                                    >
                                                        {projectLabel(binding.status.project_id)} ·{' '}
                                                        {binding.status.name}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {boardProjects.length > 0 && (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {boardProjects.map((project) => {
                                                    const current = column.bindings.find(
                                                        (binding) =>
                                                            binding.status.project_id === project.id,
                                                    );
                                                    const options = statusesByProject[project.id] ?? [];
                                                    return (
                                                        <label
                                                            key={project.id}
                                                            className="flex min-h-touch items-center gap-2 text-xs text-gray-500"
                                                        >
                                                            <span
                                                                title={project.name}
                                                                className="w-24 shrink-0 truncate"
                                                            >
                                                                {projectLabelOf(project)}
                                                            </span>
                                                            <Select
                                                                aria-label={`${m.mappedStatuses} — ${projectLabelOf(project)} — ${column.name}`}
                                                                className="flex-1"
                                                                value={current?.status_id ?? ''}
                                                                disabled={busy}
                                                                onChange={(e) =>
                                                                    setBinding(
                                                                        column,
                                                                        project.id,
                                                                        e.target.value,
                                                                    )
                                                                }
                                                            >
                                                                <option value="">{t.common.none}</option>
                                                                {options.map((status) => {
                                                                    const holder = columnByStatusId[status.id];
                                                                    const heldElsewhere =
                                                                        holder && holder.id !== column.id;
                                                                    return (
                                                                        <option key={status.id} value={status.id}>
                                                                            {heldElsewhere
                                                                                ? `${status.name} ${m.currentlyIn.replace('{column}', holder.name)}`
                                                                                : status.name}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </Select>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <form
                    onSubmit={addColumn}
                    className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-3 md:flex-row md:items-center"
                >
                    <Input
                        value={draft.name}
                        aria-label={m.addColumn}
                        placeholder={m.columnName}
                        className="md:max-w-xs"
                        onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                    />
                    <Select
                        aria-label={m.category}
                        value={draft.category}
                        className="md:w-44"
                        onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                    >
                        {Object.entries(categories).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                    <Button type="submit" disabled={busy || !draft.name.trim()} className="min-h-touch">
                        <Plus className="h-4 w-4" />
                        {m.addColumn}
                    </Button>
                </form>
            </section>

            <p className="text-xs text-gray-500">{cm.wipHint}</p>

            <ConfirmDialog
                open={deleting !== null}
                title={m.deleteColumn}
                prompt={m.deleteColumnConfirm.replace('{name}', deleting?.name ?? '')}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={busy}
                onConfirm={() => deleting && deleteColumn(deleting)}
                onCancel={() => setDeleting(null)}
            />
        </PageShell>
    );
}
