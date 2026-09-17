'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Input, Select } from '@/components/ui';
import CollapsibleSection from './CollapsibleSection';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectLabelOf, type BoardProject } from './board-tasks';

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

export interface EditableColumn {
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

interface EditDraft {
    name: string;
    category: string;
    wipLimit: string;
}

const draftOf = (column: EditableColumn): EditDraft => ({
    name: column.name,
    category: column.category,
    wipLimit: column.wip_limit != null ? String(column.wip_limit) : '',
});

/**
 * The columns half of board settings: the order they sit in, what each one is
 * called, which stage it counts as, its WIP limit, and — uniquely to a board —
 * which project statuses feed into it.
 *
 * Two things changed when this moved out of its own page and into the settings
 * panel. Every field now commits on its own (a select on change, a text field
 * when it is left or on Enter) rather than half of them waiting behind a Save
 * button the status dropdowns never had — one page with two ideas of "has my
 * change taken effect" was the worst part of the old screen. And the status
 * mappings, which are the longest thing here and the thing most boards never
 * touch, are folded away behind a count.
 *
 * The per-project columns page (`/projects/[id]/columns`) is untouched by all
 * of this: it edits a project's own status list, not a board's columns.
 */
export default function BoardColumnsEditor({
    boardId,
    projectsOnBoard,
    onChanged,
}: Readonly<{
    boardId: string;
    /**
     * Every project with a card on this board — bound or not. Passed in rather
     * than fetched, because both callers have the board in hand already and a
     * second `getBoard` on opening settings would re-read every card on it.
     *
     * Deliberately not derived from the bindings: a card sits in Unsorted
     * *because* its status has no binding, so deriving it would erase from
     * these controls exactly the projects they exist to fix.
     */
    projectsOnBoard: BoardProject[];
    /** Fired after anything that changes what the board renders. */
    onChanged?: () => void;
}>) {
    const { t } = useI18n();
    const m = t.projects.boards;
    const cm = t.projects.columns;
    const categories = t.projects.settings.categories;

    const [columns, setColumns] = useState<EditableColumn[]>([]);
    // Tenant-wide project list, kept only as a name fallback for a project
    // that is bound on this board but no longer has any card on it (see
    // `boardProjects` below) — it is never used to decide which projects to
    // offer.
    const [projects, setProjects] = useState<BoardProject[]>([]);
    const [statusesByProject, setStatusesByProject] = useState<Record<string, ProjectStatus[]>>({});
    const [edits, setEdits] = useState<Record<string, EditDraft>>({});
    const [wipErrors, setWipErrors] = useState<Record<string, boolean>>({});
    const [draft, setDraft] = useState({ name: '', category: 'TODO' });
    const [deleting, setDeleting] = useState<EditableColumn | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const list = (await api.getBoardColumns(boardId)) as EditableColumn[];
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
        // Fallback name source only — see the `projects` state comment above.
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as BoardProject[]))
            .catch(() => setProjects([]));
    }, [load]);

    const cardProjects = useMemo(
        () => Object.fromEntries(projectsOnBoard.map((project) => [project.id, project])),
        [projectsOnBoard],
    );

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
            onChanged?.();
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

    /**
     * Writes one field of one column. The caller establishes that it actually
     * changed, because these fire on blur: tabbing across a row of three
     * fields must not be three requests and three board reloads.
     */
    const saveField = (column: EditableColumn, patch: Record<string, unknown>) =>
        run(() => api.updateBoardColumn(boardId, column.id, patch));

    const saveName = (column: EditableColumn) => {
        const name = (edits[column.id]?.name ?? column.name).trim();
        if (!name) {
            // An empty name is a slip, not an instruction: put the old one back
            // rather than sending a rename the server would refuse.
            setEdits((prev) => ({ ...prev, [column.id]: draftOf(column) }));
            return;
        }
        if (name === column.name) return;
        saveField(column, { name });
    };

    const saveWipLimit = (column: EditableColumn) => {
        const raw = (edits[column.id]?.wipLimit ?? '').trim();
        const wipLimit = raw === '' ? null : Number(raw);
        if (wipLimit !== null && (!Number.isFinite(wipLimit) || wipLimit < 1)) {
            setWipErrors((prev) => ({ ...prev, [column.id]: true }));
            return;
        }
        setWipErrors((prev) => ({ ...prev, [column.id]: false }));
        if (wipLimit === (column.wip_limit ?? null)) return;
        saveField(column, { wipLimit });
    };

    /**
     * Moves one column one place and sends the whole resulting order, which is
     * what the endpoint takes — see `ReorderBoardColumnsDto`. Applied locally
     * first so the list does not wait a round trip to show the move.
     */
    const moveColumn = (index: number, delta: number) => {
        const next = [...columns];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];

        setColumns(next);
        run(() => api.reorderBoardColumns(boardId, next.map((column) => column.id)));
    };

    const deleteColumn = (column: EditableColumn) => {
        run(() => api.deleteBoardColumn(boardId, column.id), () => setDeleting(null));
    };

    // A select's onChange carries the full desired state for its column: the
    // other projects' bindings unchanged, plus this project pointed at the new
    // status (or dropped, when the value is the "—" option). setBindings on the
    // server replaces the column's bindings wholesale, so the array has to be
    // complete, not a delta.
    const setBinding = (column: EditableColumn, projectId: string, statusId: string) => {
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
        const map: Record<string, EditableColumn> = {};
        for (const column of columns) {
            for (const binding of column.bindings) map[binding.status_id] = column;
        }
        return map;
    }, [columns]);

    if (failed) {
        return (
            <p className="rounded-md border border-gray-200 bg-white px-3 py-4 text-sm text-danger">
                {m.loadFailed}
            </p>
        );
    }

    return (
        <div className="space-y-3">
            {columns.length === 0 ? (
                <p className="rounded-md border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                    {cm.empty}
                </p>
            ) : (
                <ul className="space-y-2">
                    {columns.map((column, index) => {
                        const edit = edits[column.id] ?? draftOf(column);
                        return (
                            <li
                                key={column.id}
                                className="space-y-2 rounded-md border border-gray-200 bg-white p-2"
                            >
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {/* Buttons rather than a drag handle: the
                                        board itself is where a column is
                                        dragged, and a list that can only be
                                        reordered by dragging cannot be
                                        reordered by keyboard at all. */}
                                    <div className="flex shrink-0 flex-col">
                                        <button
                                            type="button"
                                            aria-label={`${m.moveColumnUp} — ${column.name}`}
                                            className="rounded px-1 text-gray-400 hover:text-blue-600 disabled:opacity-30"
                                            disabled={busy || index === 0}
                                            onClick={() => moveColumn(index, -1)}
                                        >
                                            <ChevronUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`${m.moveColumnDown} — ${column.name}`}
                                            className="rounded px-1 text-gray-400 hover:text-blue-600 disabled:opacity-30"
                                            disabled={busy || index === columns.length - 1}
                                            onClick={() => moveColumn(index, 1)}
                                        >
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                    </div>

                                    <Input
                                        aria-label={`${m.columnName} — ${column.name}`}
                                        value={edit.name}
                                        className="min-w-[8rem] flex-1"
                                        disabled={busy}
                                        onChange={(e) =>
                                            setEdits((prev) => ({
                                                ...prev,
                                                [column.id]: { ...edit, name: e.target.value },
                                            }))
                                        }
                                        onBlur={() => saveName(column)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') e.currentTarget.blur();
                                            if (e.key === 'Escape') {
                                                setEdits((prev) => ({
                                                    ...prev,
                                                    [column.id]: draftOf(column),
                                                }));
                                            }
                                        }}
                                    />
                                    <Select
                                        aria-label={`${m.category} — ${column.name}`}
                                        value={edit.category}
                                        className="w-32"
                                        disabled={busy}
                                        onChange={(e) => {
                                            const category = e.target.value;
                                            setEdits((prev) => ({
                                                ...prev,
                                                [column.id]: { ...edit, category },
                                            }));
                                            if (category !== column.category) {
                                                saveField(column, { category });
                                            }
                                        }}
                                    >
                                        {Object.entries(categories).map(([key, label]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ))}
                                    </Select>
                                    <Input
                                        type="number"
                                        min="1"
                                        className="w-16"
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
                                        onBlur={() => saveWipLimit(column)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') e.currentTarget.blur();
                                        }}
                                    />
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

                                {/* Folded away behind its own count: the
                                    mappings are the longest thing on this
                                    screen and the thing a board on the default
                                    template never needs to open. */}
                                <CollapsibleSection
                                    title={`${m.mappedStatuses} — ${column.name}`}
                                    count={column.bindings.length}
                                >
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
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
                                                            className="w-20 shrink-0 truncate"
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
                                                                const holder =
                                                                    columnByStatusId[status.id];
                                                                const heldElsewhere =
                                                                    holder && holder.id !== column.id;
                                                                return (
                                                                    <option
                                                                        key={status.id}
                                                                        value={status.id}
                                                                    >
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
                                </CollapsibleSection>
                            </li>
                        );
                    })}
                </ul>
            )}

            <form
                onSubmit={addColumn}
                className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 md:flex-row md:items-center"
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
                    className="md:w-40"
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
        </div>
    );
}
