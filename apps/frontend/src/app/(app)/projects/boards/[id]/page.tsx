'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    AlignLeft,
    CheckSquare,
    FolderKanban,
    GitBranch,
    GripVertical,
    MessageSquare,
    Plus,
    Search,
    Settings,
    Trash2,
    X,
} from 'lucide-react';
import { PageShell, PageHeader, Button, Checkbox, Input, Select, StatusBadge } from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import AddBoardTasksModal from '@/components/projects/AddBoardTasksModal';
import BoardCardComposer, { type ComposerProject } from '@/components/projects/BoardCardComposer';
import BoardColumnComposer from '@/components/projects/BoardColumnComposer';
import BoardColumnHead from '@/components/projects/BoardColumnHead';
import BoardSettingsModal from '@/components/projects/BoardSettingsModal';
import { useBoardView } from '@/components/projects/use-board-view';
import {
    boardCanvasClass,
    boardCanvasStyle,
    boardColumnLiftClass,
    boardHeaderPlateClass,
} from '@/components/projects/board-background';
import {
    columnWidthClass,
    density,
    motionClass,
    scrollClasses,
    staggerDelay,
    tintOf,
    type BoardView,
} from '@/components/projects/board-view';
import {
    CARD_ATTR,
    COLUMN_ATTR,
    columnAtPoint,
    movedFar,
    resolveDropTarget,
    toFullIndex,
    withColumnMoved,
    type DropTarget,
} from '@/components/projects/board-drag';
import {
    applyFilters,
    assigneeNameOf,
    assigneeOptionsFrom,
    countTasks,
    coverClass,
    dueStateOf,
    hasActiveFilter,
    initialsOf,
    isOverWip,
    labelClass,
    labelsOf,
    matchesFilters,
    NO_FILTERS,
    projectLabelOf,
    sortCards,
    type BoardColumn,
    type BoardFilters,
    type BoardTask,
    type CardSort,
    type DueState,
    type ProjectLabel,
} from '@/components/projects/board-tasks';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardSummary {
    id: string;
    name: string;
    description?: string | null;
    /** A palette key; see `board-background.ts`. Null on a plain board. */
    background_color?: string | null;
    background_image_url?: string | null;
}

/** What `GET /projects/boards/:id` answers with — and every bulk write too. */
interface BoardResponse extends BoardSummary {
    columns?: BoardColumn[];
    unsorted?: BoardTask[];
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

const DUE_TONE: Record<DueState, StatusBadgeTone> = {
    done: 'success',
    overdue: 'danger',
    today: 'warning',
    soon: 'warning',
    later: 'neutral',
};

interface DragState {
    taskId: string;
    pointerId: number;
    origin: { x: number; y: number };
    point: { x: number; y: number };
    /** False until a mouse gesture passes the threshold — before that it is a click. */
    active: boolean;
    target: DropTarget | null;
    title: string;
}

/**
 * A column being dragged along the board. Same shape as a card's drag and the
 * same rules — a threshold before a mouse gesture counts, no threshold from the
 * grip — because they are the same gesture at two scales, and two drags that
 * behaved differently would be two things to learn.
 */
interface ColumnDragState {
    columnId: string;
    pointerId: number;
    origin: { x: number; y: number };
    point: { x: number; y: number };
    active: boolean;
    /** The column under the pointer: where this one lands if released now. */
    targetId: string | null;
    name: string;
}

export default function BoardPage() {
    const params = useParams<{ id: string }>();
    const boardId = params.id;
    const { t } = useI18n();
    const m = t.projects.boards;
    const bm = t.projects.board;

    const boardView = useBoardView();
    const { view } = boardView;
    const widthClass = columnWidthClass(view.columnWidth);
    const d = density(view);
    // Where this board's height goes — the page's scroll, or each column's.
    const sc = scrollClasses(view);

    const [board, setBoard] = useState<BoardSummary | null>(null);
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [unsorted, setUnsorted] = useState<BoardTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
    const [labels, setLabels] = useState<ProjectLabel[]>([]);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [columnDrag, setColumnDrag] = useState<ColumnDragState | null>(null);
    const [adding, setAdding] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    /**
     * The cards the bulk bar acts on, in the order they were picked. An array
     * rather than a Set because that order is what "move these five" sends, and
     * a Set's iteration order is an accident of insertion the reader cannot see.
     */
    const [selection, setSelection] = useState<string[]>([]);
    /** One guard over every bulk action: two in flight would race on the board. */
    const [busy, setBusy] = useState(false);
    const [projects, setProjects] = useState<ComposerProject[]>([]);
    // Which project a composed card belongs to. Held here rather than per
    // column so picking it once covers the whole board.
    const [composerProject, setComposerProject] = useState('');

    /**
     * Shadow under each column, but only on a painted board: gray-50 on white
     * reads fine on its own, and the same column on a photograph does not.
     */
    const lift = boardColumnLiftClass(board);

    const visibleColumns = useMemo(() => applyFilters(columns, filters), [columns, filters]);
    const visibleUnsorted = useMemo(
        () => unsorted.filter((task) => matchesFilters(task, filters)),
        [unsorted, filters],
    );
    const assigneeOptions = useMemo(() => assigneeOptionsFrom(columns), [columns]);

    /** Every card on the board, columns and Unsorted alike. */
    const boardTasks = useMemo(
        () => columns.flatMap((column) => column.tasks).concat(unsorted),
        [columns, unsorted],
    );
    const boardTaskIds = useMemo(() => boardTasks.map((task) => task.id), [boardTasks]);
    /**
     * The project the picker opens on. Only when every card on the board comes
     * from the same one: on a board that genuinely mixes projects there is no
     * right answer, and guessing would hide the rest behind a filter the reader
     * never set. `composerProject` is not it — that falls back to the first
     * project in the workspace, which on an empty board is arbitrary.
     */
    const boardProjectId = useMemo(() => {
        const ids = new Set(
            boardTasks.map((task) => task.project?.id).filter((id): id is string => Boolean(id)),
        );
        return ids.size === 1 ? [...ids][0] : '';
    }, [boardTasks]);
    /**
     * Every project with a card on the board, for board settings — which needs
     * it to decide whose statuses each column can bind, and would otherwise
     * re-read the whole board to work out what this page already knows.
     */
    const projectsOnBoard = useMemo(() => {
        const byId = new Map<string, NonNullable<BoardTask['project']>>();
        for (const task of boardTasks) {
            if (task.project) byId.set(task.project.id, task.project);
        }
        return [...byId.values()];
    }, [boardTasks]);
    const filtered = hasActiveFilter(filters);
    const shown = countTasks(visibleColumns) + visibleUnsorted.length;
    const total = countTasks(columns) + unsorted.length;

    /**
     * Paints a whole board response. Shared with the bulk actions below, which
     * answer with the same shape `getBoard` does rather than making the page
     * fetch it again.
     */
    const applyBoard = useCallback((res: BoardResponse) => {
        setBoard({
            id: res.id,
            name: res.name,
            description: res.description ?? null,
            background_color: res.background_color ?? null,
            background_image_url: res.background_image_url ?? null,
        });
        setColumns(res.columns ?? []);
        setUnsorted(res.unsorted ?? []);
    }, []);

    const loadBoard = useCallback(async () => {
        setLoading(true);
        try {
            applyBoard((await api.getBoard(boardId)) as BoardResponse);
            setLoadError(false);
        } catch (error) {
            // Distinguished from "still loading" below, so a 403/404/network
            // failure gets an exit rather than an indefinite spinner. A failure
            // once the board is already on screen is reported the same way
            // `removeCard` reports its own failures — a toast, not a state wipe.
            setLoadError(true);
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setLoading(false);
        }
    }, [applyBoard, boardId, t.common.error]);

    useEffect(() => {
        loadBoard();
    }, [loadBoard]);

    // Tenant-wide, so it does not need re-fetching when the board changes. A
    // failure only costs the label filter, not the board.
    useEffect(() => {
        api.getProjectLabels()
            .then((list: unknown) => setLabels(Array.isArray(list) ? list : []))
            .catch(() => setLabels([]));
    }, []);

    // For the column composers. Also tenant-wide: a board can take a card from
    // a project that has none on it yet, so this is not derived from the cards.
    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as ComposerProject[]))
            .catch(() => setProjects([]));
    }, []);

    // Default the composer to a project the board already works with, falling
    // back to the first in the workspace — one less choice in the common case
    // of a board that only ever draws from one project.
    useEffect(() => {
        if (composerProject || projects.length === 0) return;
        const onBoard = boardTasks
            .map((task) => task.project?.id)
            .find((id) => id && projects.some((project) => project.id === id));
        setComposerProject(onBoard ?? projects[0].id);
    }, [projects, boardTasks, composerProject]);

    /**
     * The bulk bar acts on what is on screen. A filter typed (or a search run)
     * after a selection must not leave a card selected that its owner can no
     * longer see — "remove these four" has to mean the four in front of them.
     */
    useEffect(() => {
        setSelection((current) => {
            if (current.length === 0) return current;
            const visible = new Set(
                [...visibleColumns.flatMap((column) => column.tasks), ...visibleUnsorted].map(
                    (task) => task.id,
                ),
            );
            const next = current.filter((id) => visible.has(id));
            return next.length === current.length ? current : next;
        });
    }, [visibleColumns, visibleUnsorted]);

    const move = async (taskId: string, columnId: string, sortOrder: number) => {
        const task =
            columns.flatMap((column) => column.tasks).find((tk) => tk.id === taskId) ??
            unsorted.find((tk) => tk.id === taskId);
        if (!task) return;

        // Optimistic: the card should follow the cursor, not the round-trip.
        setUnsorted((list) => list.filter((tk) => tk.id !== taskId));
        setColumns((cols) =>
            cols.map((col) => {
                const without = col.tasks.filter((tk) => tk.id !== taskId);
                if (col.id !== columnId) return { ...col, tasks: without };
                const next = [...without];
                next.splice(Math.min(sortOrder, next.length), 0, task);
                return { ...col, tasks: next };
            }),
        );

        try {
            await api.moveBoardCard(boardId, taskId, { columnId, sortOrder });
        } catch (error) {
            // A 400 here means exactly one thing — the target column has no
            // status mapped for this card's project (moveCard's only
            // BadRequestException). Anything else — a 401, a 500, a dropped
            // connection — is not that, and claiming it is would send the
            // user to board settings to "fix" a mapping that was never the
            // problem. Reload either way: it undoes the optimistic move.
            if (error instanceof ApiError && error.status === 400) {
                toast.error(m.unmappedDrop.replace('{project}', projectLabelOf(task.project) ?? ''));
            } else {
                toast.error(bm.moveFailed);
            }
            await loadBoard();
        }
    };

    /**
     * One guard and one failure path for every board-level write below. Two in
     * flight would race on the same cards, and a failure reloads rather than
     * trying to unpick whichever of them applied its change to the board
     * before asking the server for it.
     */
    const run = async (action: () => Promise<unknown>, done?: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            if (done) toast.success(done);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
            await loadBoard();
        } finally {
            setBusy(false);
        }
    };

    /** The whole order, because that is what the endpoint takes — see the DTO. */
    const applyColumnOrder = (ids: string[]) => {
        const byId = new Map(columns.map((column) => [column.id, column]));
        const next = ids.map((id) => byId.get(id)).filter((column): column is BoardColumn => !!column);
        if (next.length !== columns.length) return;

        setColumns(next);
        run(() => api.reorderBoardColumns(boardId, ids), m.columnsReordered);
    };

    const moveColumn = (columnId: string, delta: number) => {
        const ids = columns.map((column) => column.id);
        const at = ids.indexOf(columnId);
        const to = at + delta;
        if (at === -1 || to < 0 || to >= ids.length) return;
        applyColumnOrder(withColumnMoved(ids, columnId, ids[to]));
    };

    const renameColumn = (columnId: string, name: string) => {
        setColumns((cols) =>
            cols.map((column) => (column.id === columnId ? { ...column, name } : column)),
        );
        run(() => api.updateBoardColumn(boardId, columnId, { name }), m.columnRenamed);
    };

    /**
     * Sorts what is on screen and stores the result. The comparison happens
     * here rather than on the server (see `sortCards`), and it is deliberately
     * the *visible* cards that are sorted: a filtered column rearranges the
     * cards its reader can see, and the server leaves the rest where they are.
     */
    const sortColumn = (columnId: string, by: CardSort) => {
        const visible = visibleColumns.find((column) => column.id === columnId);
        if (!visible || visible.tasks.length === 0) return;

        const ordered = sortCards(visible.tasks, by);

        // Dealt back into the slots the sorted cards already occupied, which is
        // exactly what the server does with the ids it is sent: a card the
        // filter is hiding keeps its place rather than being swept to an end
        // the reader cannot see.
        const sorted = new Set(ordered.map((task) => task.id));
        const queue = [...ordered];
        setColumns((cols) =>
            cols.map((column) =>
                column.id === columnId
                    ? {
                          ...column,
                          tasks: column.tasks.map((task) =>
                              sorted.has(task.id) ? (queue.shift() as BoardTask) : task,
                          ),
                      }
                    : column,
            ),
        );
        run(
            () => api.setBoardColumnCardOrder(boardId, columnId, ordered.map((task) => task.id)),
            m.cardsSorted,
        );
    };

    /**
     * Several cards into one column. Not applied optimistically, unlike the
     * moves above: a card crossing a lane changes its status, and which status
     * it lands in is the server's answer, not one the board can guess for a
     * card whose project maps that column differently.
     */
    const moveCards = (taskIds: string[], columnId: string) => {
        if (taskIds.length === 0) return;
        run(async () => {
            const board = await api.moveBoardCards(boardId, { taskIds, columnId });
            applyBoard(board);
            setSelection([]);
            toast.success(m.cardsMoved.replace('{count}', String(taskIds.length)));
        });
    };

    const removeCards = (taskIds: string[]) => {
        if (taskIds.length === 0) return;
        run(async () => {
            const board = await api.removeBoardCards(boardId, taskIds);
            applyBoard(board);
            setSelection([]);
            toast.success(m.cardsRemoved.replace('{count}', String(taskIds.length)));
        });
    };

    const toggleSelected = (taskId: string) =>
        setSelection((current) =>
            current.includes(taskId)
                ? current.filter((id) => id !== taskId)
                : [...current, taskId],
        );

    /**
     * Adds the column's visible cards to the selection rather than replacing
     * it, so "select all" in two columns is a selection spanning both — which
     * is the only way to move a mixed set in one go.
     */
    const selectAllIn = (columnId: string) => {
        const visible = visibleColumns.find((column) => column.id === columnId);
        if (!visible) return;
        setSelection((current) => [
            ...current,
            ...visible.tasks.map((task) => task.id).filter((id) => !current.includes(id)),
        ]);
    };

    const removeCard = async (taskId: string) => {
        try {
            await api.removeBoardTask(boardId, taskId);
            await loadBoard();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        }
    };

    // ── Pointer dragging ────────────────────────────────────────────────────
    // Replaces HTML5 draggable, which never fires from touch input, so the board
    // was read-only on a phone. A card body only arms a mouse drag; touch has to
    // come through the grip, or the column could not be scrolled by finger.

    const beginDrag = (
        e: React.PointerEvent,
        task: BoardTask,
        { fromHandle }: { fromHandle: boolean },
    ) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType !== 'mouse' && !fromHandle) return;

        const element = e.currentTarget as Element & { setPointerCapture?: (id: number) => void };
        element.setPointerCapture?.(e.pointerId);

        setDrag({
            taskId: task.id,
            pointerId: e.pointerId,
            origin: { x: e.clientX, y: e.clientY },
            point: { x: e.clientX, y: e.clientY },
            // From the grip the intent is unambiguous, so skip the threshold.
            active: fromHandle,
            target: null,
            title: task.title,
        });
    };

    const continueDrag = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;

        const point = { x: e.clientX, y: e.clientY };
        const active = drag.active || movedFar(drag.origin, point);
        if (!active) {
            setDrag({ ...drag, point });
            return;
        }

        e.preventDefault();
        setDrag({
            ...drag,
            point,
            active: true,
            target: resolveDropTarget(point, drag.taskId, document),
        });
    };

    const endDrag = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        setDrag(null);

        // Under the threshold the gesture was a tap: open the card.
        if (!drag.active) {
            setOpenTaskId(drag.taskId);
            return;
        }
        if (!drag.target) return;

        const target = drag.target;
        const sourceColumn = columns.find((column) =>
            column.tasks.some((task) => task.id === drag.taskId),
        );
        const sameSpot =
            sourceColumn?.id === target.columnId &&
            sourceColumn?.tasks.findIndex((task) => task.id === drag.taskId) === target.index;
        if (sameSpot) return;

        move(
            drag.taskId,
            target.columnId,
            toFullIndex(
                columns.find((column) => column.id === target.columnId),
                visibleColumns.find((column) => column.id === target.columnId)?.tasks ?? [],
                target.index,
                drag.taskId,
            ),
        );
    };

    const cancelDrag = () => setDrag(null);

    // ── Dragging a column ───────────────────────────────────────────────────
    // Deliberately a second, separate gesture rather than a mode of the card
    // drag: the two never overlap (a card is never a drop target for a column)
    // and folding them together would mean every card event asking which kind
    // of drag it is in.

    const beginColumnDrag = (
        e: React.PointerEvent,
        column: BoardColumn,
        { fromHandle }: { fromHandle: boolean },
    ) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType !== 'mouse' && !fromHandle) return;
        if (busy) return;

        const element = e.currentTarget as Element & { setPointerCapture?: (id: number) => void };
        element.setPointerCapture?.(e.pointerId);

        setColumnDrag({
            columnId: column.id,
            pointerId: e.pointerId,
            origin: { x: e.clientX, y: e.clientY },
            point: { x: e.clientX, y: e.clientY },
            active: fromHandle,
            targetId: null,
            name: column.name,
        });
    };

    const continueColumnDrag = (e: React.PointerEvent) => {
        if (!columnDrag || e.pointerId !== columnDrag.pointerId) return;

        const point = { x: e.clientX, y: e.clientY };
        const active = columnDrag.active || movedFar(columnDrag.origin, point);
        if (!active) {
            setColumnDrag({ ...columnDrag, point });
            return;
        }

        e.preventDefault();
        setColumnDrag({
            ...columnDrag,
            point,
            active: true,
            targetId: columnAtPoint(point, document),
        });
    };

    const endColumnDrag = (e: React.PointerEvent) => {
        if (!columnDrag || e.pointerId !== columnDrag.pointerId) return;
        setColumnDrag(null);

        // Under the threshold the gesture was a click on the head, which is
        // not a drag and must not reorder anything.
        if (!columnDrag.active || !columnDrag.targetId) return;
        if (columnDrag.targetId === columnDrag.columnId) return;

        applyColumnOrder(
            withColumnMoved(
                columns.map((column) => column.id),
                columnDrag.columnId,
                columnDrag.targetId,
            ),
        );
    };

    const cancelColumnDrag = () => setColumnDrag(null);

    /** Where a column's "move all cards to" can send them: everywhere but here. */
    const targetsFor = (columnId: string) =>
        columns
            .filter((column) => column.id !== columnId)
            .map((column) => ({ id: column.id, name: column.name }));

    if (!board) {
        if (loadError) {
            return (
                <PageShell>
                    <PageHeader
                        title={m.title}
                        breadcrumbs={modulePageBreadcrumbs(
                            t.dashboardHome.breadcrumbHome,
                            t.sidebar.modules.projects,
                            m.title,
                            'projects',
                        )}
                    />
                    <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3 md:p-4">
                        <p className="text-sm text-red-700">{t.common.error}</p>
                        <Link href={routes.projects.boards}>
                            <Button variant="secondary" className="max-md:min-h-touch">
                                {t.common.back}
                            </Button>
                        </Link>
                    </div>
                </PageShell>
            );
        }
        return (
            <PageShell>
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            </PageShell>
        );
    }

    return (
        <PageShell contentClassName={sc.shell}>
            {/* The background is painted here rather than on the column
                scroller, so it runs behind the title and breadcrumb the way
                Jira and Trello paint a board. The header is part of the board,
                not chrome sitting above it.

                `space-y-4` is the page's own gap between the header and the
                columns; it has to be restated because this wrapper is now the
                child `PageShell` spaces, and without it the two would sit
                flush inside one painted surface. */}
            <div
                data-testid="board-canvas"
                className={`space-y-4 ${sc.canvas} ${boardCanvasClass(board)}`}
                style={boardCanvasStyle(board)}
            >
                <div className={boardHeaderPlateClass(board)}>
                    <PageHeader
                        title={board.name}
                        subtitle={board.description ?? undefined}
                        breadcrumbs={modulePageBreadcrumbs(
                            t.dashboardHome.breadcrumbHome,
                            t.sidebar.modules.projects,
                            board.name,
                            'projects',
                        )}
                        actions={
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {/* The search box and the filters sit beside
                                    the buttons rather than on a row of their
                                    own: the bar they used to live on cost a
                                    whole row of board height to five controls.
                                    It is also why the header is down to two
                                    buttons — see the settings one below. */}
                                <BoardFilterBar
                                    filters={filters}
                                    onChange={setFilters}
                                    assignees={assigneeOptions}
                                    labels={labels}
                                    shown={shown}
                                    total={total}
                                />
                                <Button className="max-md:min-h-touch" onClick={() => setAdding(true)}>
                                    <Plus className="h-4 w-4" />
                                    {m.addTasks}
                                </Button>
                                {/* One way in for everything that is not a
                                    card: the columns, the background and this
                                    browser's appearance settings. It replaced
                                    an Appearance popover, a Background button
                                    and a link to a settings page, which were
                                    three buttons deciding between themselves
                                    how much of a phone's header was left for
                                    the filters. */}
                                <Button
                                    variant="secondary"
                                    className="max-md:min-h-touch"
                                    onClick={() => setSettingsOpen(true)}
                                >
                                    <Settings className="h-4 w-4" />
                                    {m.boardSettings}
                                </Button>
                            </div>
                        }
                    />
                </div>

                {selection.length > 0 && (
                    <SelectionBar
                        count={selection.length}
                        columns={columns}
                        busy={busy}
                        onMove={(columnId) => moveCards(selection, columnId)}
                        onRemove={() => removeCards(selection)}
                        onClear={() => setSelection([])}
                    />
                )}

                {/* Columns scroll inside their own container so the page body
                    never scrolls sideways on a phone. Sideways always; whether
                    they scroll downwards in here too is `sc` — see `SCROLL`. */}
                <div className={`overflow-x-auto pb-2 ${sc.strip}`}>
                    <div className={`flex min-w-max gap-3 ${sc.row}`}>
                    {unsorted.length > 0 && (
                        <div
                            className={`flex ${widthClass} flex-col overflow-hidden rounded-lg border border-amber-300 bg-amber-50 ${lift} ${motionClass(view, 'column')}`}
                        >
                            <div aria-hidden className="h-1 w-full bg-amber-400" />
                            <div className="border-b border-amber-300 bg-white/60 px-3 py-2">
                                <p className="text-sm font-semibold text-amber-800">{m.unsorted}</p>
                                <p className="text-xs text-gray-500">{m.unsortedHint}</p>
                            </div>
                            <div className={`flex flex-1 flex-col ${d.columnGap} ${d.columnPad} ${sc.list}`}>
                                {visibleUnsorted.length === 0 && (
                                    <p className="rounded-md border border-dashed border-amber-200 px-1 py-4 text-center text-xs text-gray-400">
                                        {bm.noMatches}
                                    </p>
                                )}
                                {visibleUnsorted.map((task, index) => (
                                    <TaskCard
                                        key={task.id}
                                        task={task}
                                        view={view}
                                        index={index}
                                        selecting={selection.length > 0}
                                        selected={selection.includes(task.id)}
                                        onToggleSelected={() => toggleSelected(task.id)}
                                        dragging={drag?.active === true && drag.taskId === task.id}
                                        onPointerDownBody={(e) =>
                                            beginDrag(e, task, { fromHandle: false })
                                        }
                                        onPointerDownHandle={(e) =>
                                            beginDrag(e, task, { fromHandle: true })
                                        }
                                        onPointerMove={continueDrag}
                                        onPointerUp={endDrag}
                                        onPointerCancel={cancelDrag}
                                        onOpen={() => setOpenTaskId(task.id)}
                                        onRemove={() => removeCard(task.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {visibleColumns.map((column, columnIndex) => {
                        const remaining = column.tasks.reduce(
                            (total, task) => total + num(task.remaining_hours),
                            0,
                        );
                        const dropIndex =
                            drag?.active && drag.target?.columnId === column.id
                                ? drag.target.index
                                : null;
                        // Against the whole column, not the filtered view: a
                        // filter must not make an over-limit column look fine.
                        const full = columns.find((c) => c.id === column.id);
                        const overWip = isOverWip(full);
                        const held = full?.tasks.length ?? column.tasks.length;
                        const tint = tintOf(view, column.category);
                        const draggingColumn =
                            columnDrag?.active === true && columnDrag.columnId === column.id;
                        return (
                            <div
                                key={column.id}
                                {...{ [COLUMN_ATTR]: column.id }}
                                className={`group/column flex ${widthClass} flex-col overflow-hidden rounded-lg border bg-gray-50 ${lift} ${motionClass(view, 'column')} ${
                                    // The column the pointer is over while another
                                    // is being dragged: where it lands if released
                                    // now. Marked on the target rather than by a
                                    // gap opening up, because a board wide enough
                                    // to need reordering is a board where the gap
                                    // would be off screen.
                                    columnDrag?.active && columnDrag.targetId === column.id
                                        ? 'border-blue-400 ring-2 ring-blue-200'
                                        : 'border-gray-200'
                                }`}
                                style={{ animationDelay: staggerDelay(view, columnIndex) }}
                            >
                                {/* The column's stage, as a rule across its head.
                                    Colour is the fastest way to tell three lanes
                                    apart at a glance, and it costs no row height. */}
                                <div aria-hidden className={`h-1 w-full ${tint.bar}`} />
                                <BoardColumnHead
                                    columnId={column.id}
                                    name={column.name}
                                    category={column.category}
                                    view={view}
                                    held={held}
                                    shown={column.tasks.length}
                                    wipLimit={column.wip_limit}
                                    overWip={overWip}
                                    remaining={remaining}
                                    remainingLabel={bm.columnTotal}
                                    dragging={draggingColumn}
                                    busy={busy}
                                    onRename={(name) => renameColumn(column.id, name)}
                                    onMoveLeft={
                                        columnIndex > 0 ? () => moveColumn(column.id, -1) : undefined
                                    }
                                    onMoveRight={
                                        columnIndex < visibleColumns.length - 1
                                            ? () => moveColumn(column.id, 1)
                                            : undefined
                                    }
                                    onSort={(by) => sortColumn(column.id, by)}
                                    targets={targetsFor(column.id)}
                                    onMoveAllCards={(targetId) =>
                                        moveCards(
                                            column.tasks.map((task) => task.id),
                                            targetId,
                                        )
                                    }
                                    onSelectAll={() => selectAllIn(column.id)}
                                    onPointerDownHead={(e) =>
                                        beginColumnDrag(e, column, { fromHandle: false })
                                    }
                                    onPointerDownHandle={(e) =>
                                        beginColumnDrag(e, column, { fromHandle: true })
                                    }
                                    onPointerMove={continueColumnDrag}
                                    onPointerUp={endColumnDrag}
                                    onPointerCancel={cancelColumnDrag}
                                />

                                {/* How full the column is, as a bar rather than a
                                    number to read. It grows into place so a card
                                    dropped here shows its cost immediately. */}
                                {column.wip_limit ? (
                                    <div aria-hidden className="h-1 w-full bg-gray-200">
                                        <div
                                            className={`h-full transition-all duration-500 ease-out ${
                                                overWip ? 'bg-red-500' : tint.meter
                                            }`}
                                            style={{
                                                width: `${Math.min(100, Math.round((held / column.wip_limit) * 100))}%`,
                                            }}
                                        />
                                    </div>
                                ) : null}

                                <div className="flex min-h-0 flex-1 flex-col">
                                    {/* The cards. In column-scroll mode this is
                                        the box that scrolls, which is what keeps
                                        the column's heading above it and the
                                        composer below it in place; in page-scroll
                                        mode it is a plain stack and the window
                                        scrolls past it. */}
                                    <div className={`flex flex-col ${d.columnGap} ${d.columnPad} ${sc.list}`}>
                                        {column.tasks.length === 0 && dropIndex === null && (
                                            <p className="rounded-md border border-dashed border-gray-200 px-1 py-4 text-center text-xs text-gray-400">
                                                {filtered ? bm.noMatches : bm.emptyColumn}
                                            </p>
                                        )}
                                        {column.tasks.map((task, index) => (
                                            <Fragment key={task.id}>
                                                {dropIndex === index && <DropIndicator animate={view.animate} />}
                                                <TaskCard
                                                    task={task}
                                                    view={view}
                                                    index={index}
                                                    selecting={selection.length > 0}
                                                    selected={selection.includes(task.id)}
                                                    onToggleSelected={() => toggleSelected(task.id)}
                                                    dragging={drag?.active === true && drag.taskId === task.id}
                                                    onPointerDownBody={(e) =>
                                                        beginDrag(e, task, { fromHandle: false })
                                                    }
                                                    onPointerDownHandle={(e) =>
                                                        beginDrag(e, task, { fromHandle: true })
                                                    }
                                                    onPointerMove={continueDrag}
                                                    onPointerUp={endDrag}
                                                    onPointerCancel={cancelDrag}
                                                    onOpen={() => setOpenTaskId(task.id)}
                                                    onRemove={() => removeCard(task.id)}
                                                />
                                            </Fragment>
                                        ))}
                                        {dropIndex === column.tasks.length && (
                                            <DropIndicator animate={view.animate} />
                                        )}
                                    </div>

                                    {/* Outside the scroller on purpose: "Add a
                                        card" is how a column grows, and a
                                        control that scrolls away with the
                                        fortieth card is one you have to go
                                        looking for. `pt-0` because the list
                                        above it already ends in the column's own
                                        padding. */}
                                    <div className={`${d.columnPad} pt-0`}>
                                        <BoardCardComposer
                                            boardId={boardId}
                                            columnId={column.id}
                                            projects={projects}
                                            projectId={composerProject}
                                            onProjectChange={setComposerProject}
                                            onCreated={loadBoard}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* After the last column, where a new lane belongs. It is
                        outside the map so it is there on a board with no
                        columns at all — which is exactly the board that most
                        needs it. */}
                    <BoardColumnComposer
                        boardId={boardId}
                        widthClass={widthClass}
                        onCreated={loadBoard}
                    />
                    </div>
                </div>
            </div>

            {/* Follows the finger, because on touch there is no cursor to tell
                you the card has been picked up. */}
            {drag?.active && (
                <div
                    aria-hidden
                    // The tilt is the one piece of pure decoration on the board,
                    // and it earns its place: a card held at an angle reads as
                    // picked up rather than as a tooltip following the cursor.
                    className={`pointer-events-none fixed z-modal max-w-[16rem] truncate rounded-md border border-blue-300 bg-white px-2 py-1 text-sm shadow-xl ${
                        view.animate ? 'motion-safe:-rotate-2' : ''
                    }`}
                    style={{ left: drag.point.x + 12, top: drag.point.y + 12 }}
                >
                    {drag.title}
                </div>
            )}

            {columnDrag?.active && (
                <div
                    aria-hidden
                    className={`pointer-events-none fixed z-modal max-w-[16rem] truncate rounded-md border border-blue-300 bg-white px-2 py-1 text-sm font-medium shadow-xl ${
                        view.animate ? 'motion-safe:-rotate-2' : ''
                    }`}
                    style={{ left: columnDrag.point.x + 12, top: columnDrag.point.y + 12 }}
                >
                    {columnDrag.name}
                </div>
            )}

            {loading && <p className="text-sm text-gray-500">{t.common.loading}</p>}

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={() => loadBoard()}
                />
            )}

            {adding && (
                <AddBoardTasksModal
                    boardId={boardId}
                    onBoardTaskIds={boardTaskIds}
                    defaultProjectId={boardProjectId}
                    onClose={() => setAdding(false)}
                    onAdded={() => loadBoard()}
                />
            )}

            {settingsOpen && (
                <BoardSettingsModal
                    boardId={boardId}
                    boardName={board.name}
                    boardView={boardView}
                    background={board}
                    projectsOnBoard={projectsOnBoard}
                    onColumnsChanged={loadBoard}
                    onClose={() => setSettingsOpen(false)}
                    // Repainted from what the API returned rather than by
                    // reloading: the cards have not changed, and pulling the
                    // whole board back would blink every column for a colour.
                    onBackgroundChanged={(next) =>
                        setBoard((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      background_color: next.background_color ?? null,
                                      background_image_url: next.background_image_url ?? null,
                                  }
                                : prev,
                        )
                    }
                />
            )}
        </PageShell>
    );
}

/**
 * Where the card would land. A dot on the leading edge rather than a bare rule:
 * a 2px line alone is easy to lose against a card border mid-drag.
 */
function DropIndicator({ animate }: { animate: boolean }) {
    return (
        <div
            aria-hidden
            className={`flex shrink-0 items-center gap-1 ${animate ? 'motion-safe:animate-board-drop-in' : ''}`}
        >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
            <span className="h-0.5 flex-1 rounded-full bg-blue-600" />
        </div>
    );
}

/**
 * What can be done to the cards that are picked out, while they are picked out.
 *
 * A strip across the top of the board rather than a floating bar: the board
 * already has one floating surface (the time tracker) and a second one would
 * cover the bottom of a column, which is where the composer lives. It only
 * exists while something is selected, so it costs nothing the rest of the time.
 */
function SelectionBar({
    count,
    columns,
    busy,
    onMove,
    onRemove,
    onClear,
}: {
    count: number;
    columns: BoardColumn[];
    busy: boolean;
    onMove: (columnId: string) => void;
    onRemove: () => void;
    onClear: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.boards;

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2">
            <span className="text-sm font-medium text-blue-900">
                {m.selectedCount.replace('{count}', String(count))}
            </span>

            {/* A select rather than a list of buttons: a board can have a dozen
                columns, and the bar has to survive a phone. Resets to its
                placeholder after each move, because the move it just made is
                not a state this control is in. */}
            <Select
                aria-label={m.moveSelectedTo}
                className="w-auto max-w-[12rem] max-md:min-h-touch"
                value=""
                disabled={busy || columns.length === 0}
                onChange={(e) => {
                    if (e.target.value) onMove(e.target.value);
                }}
            >
                <option value="">{m.moveSelectedTo}</option>
                {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                        {column.name}
                    </option>
                ))}
            </Select>

            <Button
                variant="secondary"
                className="max-md:min-h-touch"
                disabled={busy}
                onClick={onRemove}
            >
                <Trash2 className="h-4 w-4" />
                {m.removeCard}
            </Button>
            <Button variant="ghost" className="max-md:min-h-touch" onClick={onClear}>
                <X className="h-4 w-4" />
                {m.clearSelection}
            </Button>
        </div>
    );
}

function BoardFilterBar({
    filters,
    onChange,
    assignees,
    labels,
    shown,
    total,
}: {
    filters: BoardFilters;
    onChange: (next: BoardFilters) => void;
    assignees: { key: string; label: string }[];
    labels: ProjectLabel[];
    shown: number;
    total: number;
}) {
    const { t } = useI18n();
    const f = t.projects.board.filters;
    const m = t.projects.boards;
    const active = hasActiveFilter(filters);

    return (
        /* No card of its own any more: this sits among the header's buttons, so
           a border and white fill around four selects would read as a panel
           floating in the action row. The labels move onto the controls as
           `aria-label`, which keeps every select named for a screen reader
           without spending a line of height on visible label text — the point
           of moving the filters up here was to get that height back.

           `[&_select]:w-auto` is the load-bearing part: `Select` ships `w-full`
           from `compactDensity.formField`, which is right in a form column and
           wrong in a header row — each select claims the full width and the
           four of them stack into a tall ladder instead of sitting in a line.
           Overriding it here rather than in `Select` keeps every form on the
           app untouched. The selects then size to their content, so the widest
           option label sets the width; `max-w-[9rem]` stops a long assignee
           name from pushing the buttons off the row.

           `max-w-full` is what makes it wrap on a phone. `PageHeader` lays its
           actions out in a `flex-shrink-0` column, so that column takes its
           natural content width — 898px at a 360px viewport — and a nested
           wrapping row given 898px of space never has any reason to wrap. It
           overflows the plate instead and clips the last filter, which puts
           "Due" out of reach on a phone. Capping this row at the width it
           actually has gives `flex-wrap` a real boundary to break against.
           Fixing `PageHeader` itself would be the deeper repair, but it is a
           shared primitive behind every module header — logged as a follow-up
           rather than changed from inside one board page. */
        <div className="flex max-w-full flex-wrap items-center gap-2 [&_select]:w-auto [&_select]:max-w-[9rem]">
            {/* First in the row because it is what a full board is reached for:
                on a board of two hundred cards, typing three letters is the
                fastest of the five controls here and the only one that reaches
                a card's own words rather than its metadata. */}
            <span className="relative">
                <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 start-2"
                />
                <Input
                    type="search"
                    aria-label={m.searchCards}
                    placeholder={m.searchCards}
                    className="w-40 max-md:min-h-touch ps-7"
                    value={filters.text}
                    onChange={(e) => onChange({ ...filters, text: e.target.value })}
                />
            </span>

            <Select
                aria-label={f.assignee}
                className="max-md:min-h-touch"
                value={filters.assignee}
                onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
            >
                <option value="all">{f.assignee}</option>
                <option value="none">{f.unassigned}</option>
                {assignees.map((option) => (
                    <option key={option.key} value={option.key}>
                        {option.label}
                    </option>
                ))}
            </Select>

            <Select
                aria-label={f.priority}
                className="max-md:min-h-touch"
                value={filters.priority}
                onChange={(e) => onChange({ ...filters, priority: e.target.value })}
            >
                <option value="all">{f.priority}</option>
                {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((value) => (
                    <option key={value} value={value}>
                        {t.projects.priority[value]}
                    </option>
                ))}
            </Select>

            {/* Only offered once the tenant has labels — an empty select is a
                dead control that just makes the bar longer. */}
            {labels.length > 0 && (
                <Select
                    aria-label={f.label}
                    className="max-md:min-h-touch"
                    value={filters.label}
                    onChange={(e) => onChange({ ...filters, label: e.target.value })}
                >
                    <option value="all">{f.label}</option>
                    <option value="none">{f.noLabel}</option>
                    {labels.map((label) => (
                        <option key={label.id} value={label.id}>
                            {label.name}
                        </option>
                    ))}
                </Select>
            )}

            <Select
                aria-label={f.due}
                className="max-md:min-h-touch"
                value={filters.due}
                onChange={(e) =>
                    onChange({ ...filters, due: e.target.value as BoardFilters['due'] })
                }
            >
                <option value="all">{f.due}</option>
                <option value="overdue">{f.overdue}</option>
                <option value="today">{f.dueToday}</option>
                <option value="week">{f.dueThisWeek}</option>
                <option value="none">{f.noDueDate}</option>
            </Select>

            {active && (
                <>
                    <span className="text-xs text-gray-500">
                        {f.showing
                            .replace('{shown}', String(shown))
                            .replace('{total}', String(total))}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        className="max-md:min-h-touch"
                        onClick={() => onChange(NO_FILTERS)}
                    >
                        <X className="me-1 h-4 w-4" />
                        {f.clear}
                    </Button>
                </>
            )}
        </div>
    );
}

function TaskCard({
    task,
    view,
    index,
    dragging,
    selecting,
    selected,
    onToggleSelected,
    onOpen,
    onRemove,
    onPointerDownBody,
    onPointerDownHandle,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    task: BoardTask;
    view: BoardView;
    /** Position in its column, for the entrance stagger. */
    index: number;
    dragging: boolean;
    /**
     * True while anything on the board is selected. The box then shows on every
     * card rather than only on the chosen ones, so a selection started from one
     * column's menu can be widened or narrowed by hand from anywhere.
     */
    selecting: boolean;
    selected: boolean;
    onToggleSelected: () => void;
    onOpen: () => void;
    onRemove: () => void;
    onPointerDownBody: (e: React.PointerEvent) => void;
    onPointerDownHandle: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
}) {
    const { t, locale } = useI18n();
    const c = t.projects.board.card;
    const m = t.projects.boards;

    const d = density(view);
    const show = view.fields;

    const labels = show.labels ? labelsOf(task) : [];
    const cover = show.cover ? coverClass(task.cover_color) : null;
    const checklist = task.checklistItems ?? [];
    const checklistDone = checklist.filter((item) => item.is_done).length;
    const comments = task._count?.comments ?? 0;
    const subtasks = task._count?.subtasks ?? 0;

    const due = dueStateOf(task.due_date, task.completed_at);
    const dueLabel =
        due === 'overdue'
            ? c.overdue
            : due === 'today'
              ? c.dueToday
              : c.due.replace('{date}', formatDate(task.due_date, locale));

    const assigneeName = assigneeNameOf(task);
    const projectLabel = projectLabelOf(task.project);

    const showBadges =
        show.badges && Boolean(due || task.priority === 'HIGH' || task.priority === 'URGENT');
    // Whether the icon row has anything left to say once the switched-off
    // fields are dropped. Without this an empty row still takes its margin,
    // and a stripped-down card would sit on a band of white.
    const showDetails =
        show.details &&
        Boolean(
            task.description ||
                checklist.length > 0 ||
                comments > 0 ||
                subtasks > 0 ||
                task.remaining_hours != null,
        );
    const showMeta = showDetails || show.assignee;

    return (
        <article
            {...{ [CARD_ATTR]: task.id }}
            role="button"
            tabIndex={0}
            aria-label={`${c.open}: ${task.title}`}
            onPointerDown={onPointerDownBody}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            style={{ animationDelay: staggerDelay(view, index) }}
            // pan-y keeps the column scrollable by finger; the grip below opts
            // out of that so a touch drag can start there.
            // `shrink-0` because the column's list is a flex column, and a
            // bounded one in column-scroll mode: a flex item shrinks to fit its
            // container before it will overflow it, so without this forty cards
            // squeeze into one screen of column instead of scrolling inside it.
            className={`group shrink-0 touch-pan-y overflow-hidden rounded-md border bg-white text-start text-sm shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 md:cursor-grab ${
                selected ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'
            } ${dragging ? 'opacity-40' : ''} ${motionClass(view, 'card')}`}
        >
            {cover && <div aria-hidden className={`h-1.5 w-full ${cover}`} />}

            <div className={d.cardPad}>
            <div className="flex items-start gap-1">
                {/* Shown only while a selection is running, and then on every
                    card: a permanent checkbox on every card of every board
                    would be a column of boxes to read past for the majority of
                    readers who never select anything. */}
                {selecting && (
                    <span
                        className="pt-0.5"
                        // Stopped before the article's handler, so ticking a box
                        // neither arms a drag nor opens the card.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Checkbox
                            checked={selected}
                            aria-label={`${m.selectCard}: ${task.title}`}
                            onChange={onToggleSelected}
                        />
                    </span>
                )}
                {/* Both chrome buttons fade in on hover on a pointer device, so a
                    full column reads as cards rather than as rows of controls.
                    They stay put on touch, where the grip is the only way to
                    start a drag and there is no hover to reveal it. */}
                <button
                    type="button"
                    aria-label={c.drag}
                    tabIndex={-1}
                    onPointerDown={onPointerDownHandle}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    className="-ms-1 max-md:min-h-touch touch-none px-1 text-gray-300 transition-opacity hover:text-gray-500 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 pt-0.5">
                    <p className={d.title}>{task.title}</p>
                    {/* A card gets read away from its board — two boards open
                        side by side, a screenshot pasted into a chat — so it
                        names its own project. Short name first because the full
                        one does not fit a 18rem column; that goes in the title
                        attribute. Muted and under the heading so it never
                        competes with the task itself. */}
                    {show.project && projectLabel && (
                        <p
                            title={task.project?.name ?? undefined}
                            className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"
                        >
                            <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="sr-only">{c.project}: </span>
                            <span className="truncate">{projectLabel}</span>
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    aria-label={m.removeCard}
                    tabIndex={-1}
                    // Stopped here, before it reaches the article's handler, so a
                    // click on this button never arms a drag or opens the card.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="max-md:min-h-touch max-md:min-w-touch -me-1 rounded px-1 text-gray-300 transition-opacity hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Above the badges, as on a Trello card: colour is what the eye
                scans a column by, so it should not be buried in the meta row. */}
            {labels.length > 0 && (
                <div className={`${d.row} flex flex-wrap gap-1`}>
                    {labels.map((label) => (
                        <span
                            key={label.id}
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(label.color)}`}
                        >
                            {label.name}
                        </span>
                    ))}
                </div>
            )}

            {showBadges && (
                <div className={`${d.row} flex flex-wrap items-center gap-1.5`}>
                    {due && <StatusBadge tone={DUE_TONE[due]}>{dueLabel}</StatusBadge>}
                    {(task.priority === 'HIGH' || task.priority === 'URGENT') && (
                        <StatusBadge tone={task.priority === 'URGENT' ? 'danger' : 'warning'}>
                            {t.projects.priority[task.priority as keyof typeof t.projects.priority]}
                        </StatusBadge>
                    )}
                </div>
            )}

            {showMeta && (
                <div
                    className={`${d.row} flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500`}
                >
                    {showDetails && (
                        <>
                            {task.description && (
                                <AlignLeft className="h-3.5 w-3.5" aria-label={c.hasDescription} />
                            )}
                            {checklist.length > 0 && (
                                <span
                                    className={`inline-flex items-center gap-1 ${
                                        checklistDone === checklist.length ? 'text-emerald-600' : ''
                                    }`}
                                    aria-label={c.checklist
                                        .replace('{done}', String(checklistDone))
                                        .replace('{total}', String(checklist.length))}
                                >
                                    <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                                    {checklistDone}/{checklist.length}
                                </span>
                            )}
                            {comments > 0 && (
                                <span
                                    className="inline-flex items-center gap-1"
                                    aria-label={c.comments.replace('{count}', String(comments))}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                                    {comments}
                                </span>
                            )}
                            {subtasks > 0 && (
                                <span
                                    className="inline-flex items-center gap-1"
                                    aria-label={c.subtasks.replace('{count}', String(subtasks))}
                                >
                                    <GitBranch className="h-3.5 w-3.5" aria-hidden />
                                    {subtasks}
                                </span>
                            )}
                            {task.remaining_hours != null && <span>{num(task.remaining_hours)}h</span>}
                        </>
                    )}

                    {show.assignee &&
                        (assigneeName ? (
                            <span
                                title={assigneeName}
                                aria-label={assigneeName}
                                className={`ms-auto inline-flex items-center justify-center rounded-full bg-blue-100 font-medium text-blue-700 ${d.avatar}`}
                            >
                                {initialsOf(assigneeName)}
                            </span>
                        ) : (
                            <span className="ms-auto text-gray-400">{c.unassigned}</span>
                        ))}
                </div>
            )}
            </div>
        </article>
    );
}
