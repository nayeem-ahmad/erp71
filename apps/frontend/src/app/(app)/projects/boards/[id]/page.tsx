'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    AlignLeft,
    CheckSquare,
    ChevronDown,
    FolderKanban,
    GitBranch,
    GripVertical,
    MessageSquare,
    Pencil,
    Play,
    Plus,
    Search,
    Settings,
    Trash2,
    X,
} from 'lucide-react';
import { PageShell, PageHeader, Button, Checkbox, Input, Select, StatusBadge } from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import Avatar from '@/components/Avatar';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import AddBoardTasksModal from '@/components/projects/AddBoardTasksModal';
import BulkEditCardsModal from '@/components/projects/BulkEditCardsModal';
import BoardCardComposer, {
    type ComposerDraft,
    type ComposerProject,
} from '@/components/projects/BoardCardComposer';
import TaskEntryModal, { type TaskEntryValues } from '@/components/projects/TaskEntryModal';
import { useProjectMeta } from '@/components/projects/use-project-meta';
import { assigneeColumns } from '@/components/projects/task-assignee';
import { composerAssigneeKey } from '@/components/projects/sprint-filters';
import BoardColumnComposer from '@/components/projects/BoardColumnComposer';
import BoardColumnHead from '@/components/projects/BoardColumnHead';
import BoardSettingsModal from '@/components/projects/BoardSettingsModal';
import RemoveCardsDialog, { type RemoveCardsMode } from '@/components/projects/RemoveCardsDialog';
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
    LANE_ATTR,
    movedFar,
    resolveDropTarget,
    toFullIndex,
    withColumnMoved,
    type DropTarget,
} from '@/components/projects/board-drag';
import {
    applyFilters,
    assigneeKeyOf,
    assigneeNameOf,
    assigneeOptionsFrom,
    countTasks,
    coverClass,
    dueStateOf,
    hasActiveFilter,
    initialsOf,
    isOverWip,
    labelClass,
    labelOptionsFrom,
    labelsOf,
    matchesDuePresetForCount,
    matchesFilters,
    matchesTimeFlagForCount,
    projectLabelOf,
    projectOptionsFrom,
    sortCards,
    sprintIdOf,
    sprintOptionsFrom,
    storyIdOf,
    storyOptionsFrom,
    BOARD_DUE_PRESETS,
    PRIORITIES,
    STATUS_CATEGORIES,
    TIME_FLAGS,
    UPDATED_PRESETS,
    cardsMatching,
    type AssigneeOption,
    type BoardColumn,
    type FilterOption,
    type BoardFilters,
    type BoardTask,
    type CardSort,
    type BoardDuePreset,
    type DueState,
    type ProjectLabel,
    type SprintOption,
    type StoryOption,
    type TimeFlag,
    type UpdatedPreset,
} from '@/components/projects/board-tasks';
import FilterBar, { type ResolvedListFilter } from '@/components/data-table/FilterBar';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesUpdatedPreset } from '@/components/projects/sprint-filters';
import { useBoardFilters } from '@/components/projects/use-board-filters';
import {
    laneStorageId,
    readCollapsedLanes,
    writeCollapsedLanes,
} from '@/components/projects/board-lane-storage';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import {
    groupIntoLanes,
    laneFieldsOf,
    laneKeyOf,
    laneRefusalOf,
    NO_LANE,
    UNSORTED_CELL,
    type BoardLane,
} from '@/components/projects/board-lanes';
import { useIsTimerRunningFor } from '@/components/projects/TimerChip';
import RunningClock from '@/components/projects/RunningClock';
import { useProjectTimerActions } from '@/components/projects/use-project-timer';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { api, ApiError, type BulkTaskChanges } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
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
    /** Set by composing a card: which card on the board is the new one. */
    created_task_id?: string;
}

/** The New Task form, opened from a column's composer, and where its card goes. */
interface CardEntry {
    columnId: string;
    initial: Partial<TaskEntryValues>;
    /** Names `initial.assignee` before the project's roster arrives. */
    assigneeLabel: string;
    /** A story lane's story, which the card joins. */
    userStory?: { id: string; code: string; title: string };
    /** A story lane fixes the project to its story's. */
    projectLocked: boolean;
}

/**
 * How long a freshly composed card stays marked. Long enough to find it after
 * the scroll that brings it into view, short enough not to read as a state.
 */
const FRESH_MS = 2000;

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
    /**
     * The pointer is over a lane the card cannot join — a story from another
     * project. Held so the release can say why nothing happened, rather than
     * the drop just silently not landing.
     */
    refused?: 'otherProject';
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
    /** Rows across the columns, one per person or story — see `board-lanes.ts`. */
    const grouped = view.swimlanes !== 'none';
    // Where this board's height goes — the page's scroll, or each column's.
    // A grouped board always scrolls the page: a column there is a stack of
    // cells, one per lane, and a scroller inside every cell would be dozens of
    // little windows onto a few cards each.
    const sc = scrollClasses(grouped ? { ...view, scroll: 'page' } : view);

    const [board, setBoard] = useState<BoardSummary | null>(null);
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [unsorted, setUnsorted] = useState<BoardTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [labels, setLabels] = useState<ProjectLabel[]>([]);
    /**
     * Both feed the remembered filters below, which cannot tell a label that
     * was deleted from one that simply has not arrived yet.
     */
    const [labelsLoaded, setLabelsLoaded] = useState(false);
    const [drag, setDrag] = useState<DragState | null>(null);
    /**
     * A finished drag is followed by a click on the card. Without this the
     * click opens the card the reader just put down — including a drag that
     * ended where it began. Cleared on the next press, so a click the browser
     * never fires (a scroll takes the gesture) cannot eat the tap after it.
     */
    const swallowCardClick = useRef(false);
    const [columnDrag, setColumnDrag] = useState<ColumnDragState | null>(null);
    const [adding, setAdding] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    /**
     * The cards the bulk bar acts on, in the order they were picked. An array
     * rather than a Set because that order is what "move these five" sends, and
     * a Set's iteration order is an accident of insertion the reader cannot see.
     */
    const [selection, setSelection] = useState<string[]>([]);
    /** Lanes this browser has folded on this board — see `board-lane-storage.ts`. */
    const [collapsedLanes, setCollapsedLanes] = useState<string[]>([]);
    useEffect(() => {
        setCollapsedLanes(readCollapsedLanes(boardId));
    }, [boardId]);
    /** Below `md` a grouped board shows one column at a time — this one. */
    const [mobileColumnId, setMobileColumnId] = useState<string | null>(null);
    const isMdUp = useIsMdUp();
    /** One guard over every bulk action: two in flight would race on the board. */
    const [busy, setBusy] = useState(false);
    /** The bulk edit dialog, over the current selection. */
    const [bulkEditing, setBulkEditing] = useState(false);
    /** The cards waiting on `RemoveCardsDialog`: off this board, or deleted outright. */
    const [pendingRemoval, setPendingRemoval] = useState<{ taskIds: string[]; title?: string } | null>(
        null,
    );
    const [projects, setProjects] = useState<ComposerProject[]>([]);
    // Which project a composed card belongs to. Held here rather than per
    // column so picking it once covers the whole board.
    const [composerProject, setComposerProject] = useState('');
    /** The New Task form, when a composer's "More fields" opened it. */
    const [entry, setEntry] = useState<CardEntry | null>(null);
    /**
     * Cards composed on this visit. Each stays on screen whatever the filters
     * say until the reader next changes them: a card typed into a board
     * filtered to "High" or to a search would otherwise vanish the moment it
     * was saved, which reads as a save that failed. The assignee filter needs
     * no help — the composer defaults to it — but a new card cannot be made to
     * match a search or a due date.
     */
    const [composed, setComposed] = useState<string[]>([]);
    /** The card just composed, while it is scrolled into view and marked. */
    const [fresh, setFresh] = useState<string | null>(null);
    /** Who is composing — a card lands on them when no filter says otherwise. */
    const [userId, setUserId] = useState<string | null>(null);
    /** The composer's assignee picker draws on the chosen project's roster. */
    const projectMeta = useProjectMeta();
    const { load: loadTimer } = useProjectTimerActions();

    /**
     * Shadow under each column, but only on a painted board: gray-50 on white
     * reads fine on its own, and the same column on a photograph does not.
     */
    const lift = boardColumnLiftClass(board);

    const assigneeOptions = useMemo(() => assigneeOptionsFrom(columns), [columns]);

    /** Every card on the board, columns and Unsorted alike. */
    const boardTasks = useMemo(
        () => columns.flatMap((column) => column.tasks).concat(unsorted),
        [columns, unsorted],
    );
    /**
     * The projects, sprints and stories the board can be narrowed to — from the
     * cards, like the assignees, so none offers a choice that can only empty
     * it. The labels are the ones a card here actually carries, which is the
     * same rule: a tenant label with no card is a filter that hides everything.
     */
    const projectOptions = useMemo(() => projectOptionsFrom(boardTasks), [boardTasks]);
    const sprintOptions = useMemo(() => sprintOptionsFrom(boardTasks), [boardTasks]);
    const storyOptions = useMemo(() => storyOptionsFrom(boardTasks), [boardTasks]);
    const labelOptions = useMemo(() => labelOptionsFrom(boardTasks), [boardTasks]);

    /**
     * What the remembered filters are checked against. A stored filter is an
     * id, and the person, label, project, sprint or story it names can be gone
     * by the next visit — without these the board would open on zero cards
     * under a filter its own controls could not show.
     */
    const filterOptionIds = useMemo(
        () => ({
            assignees: new Set(assigneeOptions.map((option) => option.key)),
            labels: new Set(labelOptions.map((label) => label.id)),
            projects: new Set(projectOptions.map((option) => option.key)),
            sprints: new Set(sprintOptions.map((option) => option.key)),
            stories: new Set(storyOptions.map((option) => option.key)),
        }),
        [assigneeOptions, labelOptions, projectOptions, sprintOptions, storyOptions],
    );
    /**
     * The filters this browser last left the board on. Restored only once both
     * the cards and the tenant's labels are in, so a filter naming someone who
     * has left can be told from one whose fetch has not landed yet.
     */
    const { filters, setFilters } = useBoardFilters(
        boardId,
        !loading && !loadError && labelsLoaded,
        filterOptionIds,
    );

    const keep = useMemo(() => new Set(composed), [composed]);
    const visibleColumns = useMemo(
        () => applyFilters(columns, filters, keep, userId),
        [columns, filters, keep, userId],
    );
    const visibleUnsorted = useMemo(
        () => unsorted.filter((task) => keep.has(task.id) || matchesFilters(task, filters, userId)),
        [unsorted, filters, keep, userId],
    );
    /** Grouped after filtering, so a filter that empties a lane hides it. */
    const lanes = useMemo(
        () => groupIntoLanes(visibleColumns, visibleUnsorted, view.swimlanes),
        [visibleColumns, visibleUnsorted, view.swimlanes],
    );
    /** The phone layout's column tabs: Unsorted first when it holds anything, as on the wide board. */
    const mobileCells = useMemo(
        () => [
            ...(unsorted.length > 0
                ? [{ id: UNSORTED_CELL, name: m.unsorted, count: visibleUnsorted.length }]
                : []),
            ...visibleColumns.map((column) => ({ id: column.id, name: column.name, count: column.tasks.length })),
        ],
        [unsorted.length, visibleUnsorted.length, visibleColumns, m.unsorted],
    );
    // Falls back to the first tab when the remembered one is gone — a column
    // deleted, or Unsorted emptied.
    const mobileCellId = mobileCells.some((cell) => cell.id === mobileColumnId)
        ? mobileColumnId
        : (mobileCells[0]?.id ?? null);
    const mobileColumn = visibleColumns.find((column) => column.id === mobileCellId);

    const boardTaskIds = useMemo(() => boardTasks.map((task) => task.id), [boardTasks]);
    /** The projects the selected cards come from — whose teams the bulk edit's assignee picker offers. */
    const selectedProjectIds = useMemo(() => {
        const picked = new Set(selection);
        return [
            ...new Set(
                boardTasks
                    .filter((task) => picked.has(task.id))
                    .map((task) => task.project?.id)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];
    }, [boardTasks, selection]);
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
    /**
     * Who a composed card lands on unless its picker says otherwise: whoever
     * the board is filtered to, or the signed-in user when it is filtered to
     * nobody in particular. Composing a run of cards while filtered to Rafi
     * means those cards are for Rafi — and they would otherwise vanish from
     * the view the moment they were created.
     *
     * The filter is a list now, so a single named holder is read off it; any
     * wider choice (nobody, or several people) falls back to the signed-in
     * user, which is what an unfiltered board already did.
     */
    const composerAssignee = useMemo(
        () => composerAssigneeKey(filters.assignees, userId),
        [filters.assignees, userId],
    );
    /**
     * A name for that default while the project's roster is still loading. A
     * filtered board has one already — the filter's options are built from the
     * cards. Otherwise the default is the signed-in user, who need not hold a
     * card here and so may have no label anywhere on this page; "Me" is both
     * true and the shortest thing to read.
     */
    const composerAssigneeLabel = useMemo(
        () =>
            assigneeOptions.find((option) => option.key === composerAssignee)?.label ??
            t.projects.quickAdd.me,
        [assigneeOptions, composerAssignee, t.projects.quickAdd.me],
    );

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
            // a card removal reports its own failures — a toast, not a state wipe.
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
            .catch(() => setLabels([]))
            // Either way the label filter now knows what exists — a failed
            // fetch means no labels, which is a truthful (if lossy) answer and
            // better than holding the other three filters back forever.
            .finally(() => setLabelsLoaded(true));
    }, []);

    // Who is composing. A card composed on an unfiltered board lands on them,
    // so this is read once rather than per card. A failure only means a
    // composed card opens unassigned, which the picker can still correct.
    useEffect(() => {
        fetchMe()
            .then((me: unknown) => setUserId((me as { id?: string } | null)?.id ?? null))
            .catch(() => setUserId(null));
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
     * A board filtered to one project is being worked one project at a time,
     * so the composer follows it — the same reasoning that lands a composed
     * card on the person the board is filtered to. Covers a restored filter
     * as well as one picked on this visit. Only a single picked project is
     * followed: with several, there is no one answer and guessing would file
     * the card in a project the reader may not be looking at.
     */
    useEffect(() => {
        const [only] = filters.projectIds;
        if (filters.projectIds.length === 1 && projects.some((project) => project.id === only)) {
            setComposerProject(only);
        }
    }, [filters.projectIds, projects]);

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

    /**
     * Brings a freshly composed card into view. It lands at the foot of its
     * column, which on a long column is below the fold — and on a board that
     * scrolls inside its columns, inside a scroller the page cannot see.
     * `nearest` leaves a card that is already on screen where it is.
     */
    useEffect(() => {
        if (!fresh) return;
        const still =
            !view.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.querySelector(`[${CARD_ATTR}="${fresh}"]`)?.scrollIntoView?.({
            block: 'nearest',
            inline: 'nearest',
            behavior: still ? 'auto' : 'smooth',
        });
        const timer = window.setTimeout(() => setFresh(null), FRESH_MS);
        return () => window.clearTimeout(timer);
    }, [fresh, view.animate]);

    /**
     * `lane` makes the drop a swimlane change as well: the card is redrawn with
     * the lane's person or story straight away, and the server's answer — the
     * whole board — replaces the guess once it arrives.
     */
    const move = async (
        taskId: string,
        columnId: string,
        sortOrder: number,
        lane?: { key: string; fields: Partial<BoardTask> },
    ) => {
        const found =
            columns.flatMap((column) => column.tasks).find((tk) => tk.id === taskId) ??
            unsorted.find((tk) => tk.id === taskId);
        if (!found) return;
        const task = lane ? { ...found, ...lane.fields } : found;

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
            const board = await api.moveBoardCard(boardId, taskId, {
                columnId,
                sortOrder,
                ...(lane && grouped ? { laneBy: view.swimlanes as 'assignee' | 'story', laneKey: lane.key } : {}),
            });
            if (lane) applyBoard(board as BoardResponse);
        } catch (error) {
            // A refused lane change has a reason of its own — the story is
            // another project's — and the server's words for it are the right
            // ones; the unmapped-column message below would be wrong.
            if (lane && error instanceof ApiError && error.status === 400) {
                toast.error(error.message);
                await loadBoard();
                return;
            }
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

    /**
     * The bulk edit dialog's change set, over the whole selection in one
     * request. The server runs each card through the same update a single edit
     * does and skips — rather than fails on — a card that refuses, so what
     * comes back is a count of each, and the board is re-read either way.
     */
    const editCards = (changes: BulkTaskChanges) => {
        const taskIds = selection;
        if (taskIds.length === 0) return;
        run(async () => {
            const { updated, skipped } = await api.bulkUpdateProjectTasks({ ids: taskIds, ...changes });
            if (updated > 0) toast.success(m.bulkUpdated.replace('{count}', String(updated)));
            if (skipped.length > 0) {
                toast.error(
                    m.bulkSkipped
                        .replace('{count}', String(skipped.length))
                        .replace('{reason}', skipped[0].reason),
                );
            }
            setBulkEditing(false);
            setSelection([]);
            await loadBoard();
        });
    };

    /**
     * Carries out the choice made in `RemoveCardsDialog`, for one card or a
     * selection alike. Deleting uses the bulk route even for one task: it skips
     * rather than fails on a task somebody else deleted a moment earlier, and
     * reports how many it skipped.
     */
    const confirmRemoval = (mode: RemoveCardsMode) => {
        const taskIds = pendingRemoval?.taskIds ?? [];
        if (taskIds.length === 0) return;
        run(async () => {
            if (mode === 'board') {
                applyBoard(await api.removeBoardCards(boardId, taskIds));
                toast.success(m.cardsRemoved.replace('{count}', String(taskIds.length)));
            } else {
                const { deleted, skipped } = await api.bulkDeleteProjectTasks(taskIds);
                if (deleted > 0) toast.success(m.tasksDeleted.replace('{count}', String(deleted)));
                if (skipped > 0) toast.error(m.tasksDeleteFailed.replace('{count}', String(skipped)));
                // The clock may have been running on a task that just went.
                loadTimer();
                await loadBoard();
            }
            setSelection((current) => current.filter((id) => !taskIds.includes(id)));
            setPendingRemoval(null);
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

    // ── Pointer dragging ────────────────────────────────────────────────────
    // Replaces HTML5 draggable, which never fires from touch input, so the board
    // was read-only on a phone. A card body only arms a mouse drag; touch has to
    // come through the grip, or the column could not be scrolled by finger.
    // Opening is a click on the card, which a scroll does not fire. A mouse
    // press under the threshold still opens here, because that gesture is the
    // click and the tests drive it without a separate click event.

    const beginDrag = (
        e: React.PointerEvent,
        task: BoardTask,
        { fromHandle }: { fromHandle: boolean },
    ) => {
        swallowCardClick.current = false;
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

    /**
     * On a grouped board a drop has to land in a lane cell — a column's header
     * cell carries no lane, so it is never a target — and a card can join any
     * lane but one: a story from another project, which the server would
     * refuse anyway. That one is reported, so the release can say why.
     */
    const laneTarget = (
        target: DropTarget | null,
        taskId: string,
    ): { target: DropTarget | null; refused?: 'otherProject' } => {
        if (!grouped || !target) return { target };
        if (target.laneKey === undefined) return { target: null };
        const task = boardTasks.find((candidate) => candidate.id === taskId);
        const lane = lanes.find((candidate) => candidate.key === target.laneKey);
        if (!task || !lane) return { target: null };
        const refused = laneRefusalOf(task, lane, view.swimlanes);
        return refused ? { target: null, refused } : { target };
    };

    /**
     * The cards the drop index counts among: the column as filtered, or on a
     * grouped board just the lane's cell of it.
     */
    const visibleAt = (target: DropTarget): BoardTask[] =>
        grouped
            ? (lanes.find((lane) => lane.key === target.laneKey)?.cells[target.columnId] ?? [])
            : (visibleColumns.find((column) => column.id === target.columnId)?.tasks ?? []);

    /** What `move` needs to carry a card into lane `key`. */
    const laneMove = (key: string) => {
        const lane = lanes.find((candidate) => candidate.key === key);
        return { key, fields: lane ? laneFieldsOf(lane, view.swimlanes) : {} };
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
            ...laneTarget(resolveDropTarget(point, drag.taskId, document), drag.taskId),
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
        swallowCardClick.current = true;
        if (!drag.target) {
            if (drag.refused === 'otherProject') toast.error(bm.laneOtherProject);
            return;
        }

        const target = drag.target;
        const sourceColumn = columns.find((column) =>
            column.tasks.some((task) => task.id === drag.taskId),
        );
        const visible = visibleAt(target);
        const draggedTask = boardTasks.find((task) => task.id === drag.taskId);
        const crossLane =
            grouped &&
            draggedTask !== undefined &&
            target.laneKey !== laneKeyOf(draggedTask, view.swimlanes);
        // Measured among the cards the reader can see, which is what the drop
        // index counts: against the whole column, a filtered or grouped board
        // would take a card dropped back where it was for a move.
        const sameSpot =
            !crossLane &&
            sourceColumn?.id === target.columnId &&
            visible.findIndex((task) => task.id === drag.taskId) === target.index;
        if (sameSpot) return;

        move(
            drag.taskId,
            target.columnId,
            toFullIndex(
                columns.find((column) => column.id === target.columnId),
                visible,
                target.index,
                drag.taskId,
            ),
            crossLane ? laneMove(target.laneKey!) : undefined,
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

    /** A filter chosen after composing applies to the new cards like any other. */
    const changeFilters = (next: BoardFilters) => {
        setComposed([]);
        setFilters(next);
    };

    /**
     * Paints the board a card was just composed into — the API answers with
     * the whole board — and makes sure the new card can be seen: kept past the
     * filters, its lane unfolded, and scrolled to by the effect above.
     */
    const cardComposed = (res: unknown) => {
        const next = res as BoardResponse;
        applyBoard(next);
        const id = next.created_task_id;
        if (!id) return;
        setComposed((current) => [...current, id]);
        const task = [...(next.columns ?? []).flatMap((column) => column.tasks), ...(next.unsorted ?? [])]
            .find((candidate) => candidate.id === id);
        // A card can land in a lane the reader has folded — handed to someone
        // else from the composer, or the first card of a lane folded on an
        // earlier visit. A folded lane renders no cards at all.
        if (grouped && task) {
            const lane = laneStorageId(view.swimlanes, laneKeyOf(task, view.swimlanes));
            setCollapsedLanes((current) => {
                if (!current.includes(lane)) return current;
                const unfolded = current.filter((other) => other !== lane);
                writeCollapsedLanes(boardId, unfolded);
                return unfolded;
            });
        }
        setFresh(id);
    };

    /** Opens the New Task form for a column, carrying over what its composer had. */
    const openEntry = (
        columnId: string,
        projectId: string,
        draft: ComposerDraft,
        lane: { userStory?: CardEntry['userStory']; projectLocked?: boolean } = {},
    ) =>
        setEntry({
            columnId,
            initial: { projectId, title: draft.title, assignee: draft.assignee },
            assigneeLabel: draft.assigneeLabel,
            userStory: lane.userStory,
            projectLocked: lane.projectLocked ?? false,
        });

    /**
     * The New Task form's save: the card the composer would have made, with
     * the rest of the form riding along. The column still decides the status.
     */
    const fileCard = async (target: CardEntry, values: TaskEntryValues) => {
        const res = await api.createBoardCard(boardId, target.columnId, {
            projectId: values.projectId,
            title: values.title.trim(),
            // `''` means nobody here, as it does in the composer — the form
            // opened on whoever the composer would have picked.
            ...assigneeColumns(values.assignee),
            ...(target.userStory ? { userStoryId: target.userStory.id } : {}),
            description: values.description.trim() || undefined,
            priority: values.priority,
            dueDate: values.dueDate || undefined,
            estimateHours: values.estimateHours ? Number(values.estimateHours) : undefined,
        });
        // The project picked here is the one the next card is most likely for
        // too — the same memory the composer's own picker writes to.
        if (!target.projectLocked) setComposerProject(values.projectId);
        cardComposed(res);
    };

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

    // ── Pieces shared by the plain board and the grouped one ────────────────

    const cardFor = (task: BoardTask, index: number) => (
        <TaskCard
            key={task.id}
            task={task}
            view={view}
            index={index}
            selecting={selection.length > 0}
            selected={selection.includes(task.id)}
            onToggleSelected={() => toggleSelected(task.id)}
            dragging={drag?.active === true && drag.taskId === task.id}
            fresh={fresh === task.id}
            onPointerDownBody={(e) => beginDrag(e, task, { fromHandle: false })}
            onPointerDownHandle={(e) => beginDrag(e, task, { fromHandle: true })}
            onPointerMove={continueDrag}
            onPointerUp={endDrag}
            onPointerCancel={cancelDrag}
            onOpen={() => setOpenTaskId(task.id)}
            consumeSwallowedClick={() => {
                if (!swallowCardClick.current) return false;
                swallowCardClick.current = false;
                return true;
            }}
            onRemove={() => setPendingRemoval({ taskIds: [task.id], title: task.title })}
        />
    );

    /**
     * The column the pointer is over while another is being dragged: where it
     * lands if released now. Marked on the target rather than by a gap opening
     * up, because a board wide enough to need reordering is a board where the
     * gap would be off screen.
     */
    const columnRing = (columnId: string) =>
        columnDrag?.active && columnDrag.targetId === columnId
            ? 'border-blue-400 ring-2 ring-blue-200'
            : 'border-gray-200';

    /** The stage rule, the heading and the WIP meter — a column's head, in either layout. */
    const columnHeadFor = (column: BoardColumn, columnIndex: number) => {
        const remaining = column.tasks.reduce((sum, task) => sum + num(task.remaining_hours), 0);
        // Against the whole column, not the filtered view: a filter must not
        // make an over-limit column look fine.
        const full = columns.find((c) => c.id === column.id);
        const overWip = isOverWip(full);
        const held = full?.tasks.length ?? column.tasks.length;
        const tint = tintOf(view, column.category);
        const draggingColumn = columnDrag?.active === true && columnDrag.columnId === column.id;
        return (
            <>
                {/* The column's stage, as a rule across its head. Colour is
                    the fastest way to tell three stages apart at a glance, and
                    it costs no row height. */}
                {/* Rounded itself rather than clipped by the column: a grouped
                    board's header cell cannot clip, or it would cut off the
                    column's menu, which drops below the cell's short height. */}
                <div aria-hidden className={`h-1 w-full rounded-t-lg ${tint.bar}`} />
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
                    onMoveLeft={columnIndex > 0 ? () => moveColumn(column.id, -1) : undefined}
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
                    onPointerDownHead={(e) => beginColumnDrag(e, column, { fromHandle: false })}
                    onPointerDownHandle={(e) => beginColumnDrag(e, column, { fromHandle: true })}
                    onPointerMove={continueColumnDrag}
                    onPointerUp={endColumnDrag}
                    onPointerCancel={cancelColumnDrag}
                />

                {/* How full the column is, as a bar rather than a number to
                    read. It grows into place so a card dropped here shows its
                    cost immediately. */}
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
            </>
        );
    };

    const composerFor = (columnId: string) => (
        <BoardCardComposer
            create={(card) => api.createBoardCard(boardId, columnId, card)}
            projects={projects}
            projectId={composerProject}
            onProjectChange={setComposerProject}
            defaultAssignee={composerAssignee}
            defaultAssigneeLabel={composerAssigneeLabel}
            assignees={projectMeta.peek(composerProject)?.assignees ?? []}
            onAssigneeMenuOpen={() => void projectMeta.load(composerProject)}
            onCreated={cardComposed}
            onOpenFull={(draft) => openEntry(columnId, composerProject, draft)}
        />
    );

    /** A lane's heading. The catch-all lane is named here, not in `board-lanes.ts`, because it is words. */
    const laneName = (lane: BoardLane) =>
        lane.title ?? (view.swimlanes === 'story' ? bm.laneNoStory : bm.laneUnassigned);

    const isCollapsed = (lane: BoardLane) =>
        collapsedLanes.includes(laneStorageId(view.swimlanes, lane.key));

    const toggleLane = (lane: BoardLane) => {
        const id = laneStorageId(view.swimlanes, lane.key);
        setCollapsedLanes((current) => {
            const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
            writeCollapsedLanes(boardId, next);
            return next;
        });
    };

    const laneHeadingFor = (lane: BoardLane) => (
        <LaneHeading
            lane={lane}
            name={laneName(lane)}
            story={view.swimlanes === 'story'}
            count={bm.laneCards.replace('{count}', String(lane.count))}
            progress={
                view.swimlanes === 'story' && lane.key !== NO_LANE
                    ? bm.laneDone.replace('{done}', String(lane.done)).replace('{count}', String(lane.count))
                    : undefined
            }
            collapsed={isCollapsed(lane)}
            toggleLabel={isCollapsed(lane) ? bm.laneExpand : bm.laneCollapse}
            onToggle={() => toggleLane(lane)}
        />
    );

    /**
     * "Add a card" inside a lane: the card is the lane's before it exists. A
     * person's lane assigns it to them; a story's lane links it to the story
     * and fixes the project to the story's, the only one it can join.
     */
    const laneComposerFor = (lane: BoardLane, columnId: string) => {
        const story =
            view.swimlanes === 'story' && lane.key !== NO_LANE
                ? (laneFieldsOf(lane, 'story').userStory ?? undefined)
                : undefined;
        const byPerson = view.swimlanes === 'assignee';
        const projectId = story && lane.projectId ? lane.projectId : composerProject;
        return (
            <BoardCardComposer
                create={(card) => api.createBoardCard(boardId, columnId, card)}
                projects={projects}
                projectId={projectId}
                onProjectChange={setComposerProject}
                projectLocked={Boolean(story && lane.projectId)}
                userStory={story}
                defaultAssignee={byPerson ? (lane.key === NO_LANE ? '' : lane.key) : composerAssignee}
                defaultAssigneeLabel={byPerson ? laneName(lane) : composerAssigneeLabel}
                assignees={projectMeta.peek(projectId)?.assignees ?? []}
                onAssigneeMenuOpen={() => void projectMeta.load(projectId)}
                onCreated={cardComposed}
                onOpenFull={(draft) =>
                    openEntry(columnId, projectId, draft, {
                        userStory: story,
                        projectLocked: Boolean(story && lane.projectId),
                    })
                }
                compact
            />
        );
    };

    /** One lane's slice of one column: a drop target, its cards and a composer. */
    const laneCellFor = (lane: BoardLane, columnId: string, sizeClass: string) => {
        const cell = lane.cells[columnId] ?? [];
        const dropIndex =
            drag?.active && drag.target?.columnId === columnId && drag.target.laneKey === lane.key
                ? drag.target.index
                : null;
        return (
            <div
                key={columnId}
                {...{ [COLUMN_ATTR]: columnId, [LANE_ATTR]: lane.key }}
                className={`group/cell flex min-h-12 ${sizeClass} flex-col ${d.columnGap} ${d.columnPad} rounded-lg border bg-gray-50 ${lift} ${
                    dropIndex !== null ? 'border-blue-300' : 'border-gray-200'
                }`}
            >
                {cell.map((task, index) => (
                    <Fragment key={task.id}>
                        {dropIndex === index && <DropIndicator animate={view.animate} />}
                        {cardFor(task, index)}
                    </Fragment>
                ))}
                {dropIndex === cell.length && <DropIndicator animate={view.animate} />}
                <div className="mt-auto">{laneComposerFor(lane, columnId)}</div>
            </div>
        );
    };

    /** The lane's Unsorted cards. Not a drop target: nothing can be moved into Unsorted. */
    const unsortedCellFor = (lane: BoardLane, sizeClass: string) => (
        <div
            key={UNSORTED_CELL}
            className={`flex min-h-12 ${sizeClass} flex-col ${d.columnGap} ${d.columnPad} rounded-lg border border-amber-300 bg-amber-50 ${lift}`}
        >
            {(lane.cells[UNSORTED_CELL] ?? []).map((task, index) => cardFor(task, index))}
        </div>
    );

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
                                    onChange={changeFilters}
                                    cards={boardTasks}
                                    assignees={assigneeOptions}
                                    labels={labelOptions}
                                    projects={projectOptions}
                                    sprints={sprintOptions}
                                    stories={storyOptions}
                                    userId={userId}
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
                        onEdit={() => setBulkEditing(true)}
                        onRemove={() => setPendingRemoval({ taskIds: selection })}
                        onClear={() => setSelection([])}
                    />
                )}

                {/* Columns scroll inside their own container so the page body
                    never scrolls sideways on a phone. Sideways always; whether
                    they scroll downwards in here too is `sc` — see `SCROLL`. */}
                {grouped && !isMdUp ? (
                    // A phone cannot show lanes × columns — at 360px that is a
                    // window onto one cell with the rest a sideways scroll
                    // away. So one column at a time, picked from the strip of
                    // tabs, with the lanes stacked under it at full width.
                    // Dragging a card up or down into another lane still
                    // reassigns it; changing column is the tabs' job, or the
                    // selection bar's.
                    <div className="space-y-3">
                        <div
                            role="tablist"
                            aria-label={bm.laneColumn}
                            className="flex gap-1 overflow-x-auto rounded-md bg-gray-100 p-0.5"
                        >
                            {mobileCells.map((cell) => {
                                const selected = cell.id === mobileCellId;
                                return (
                                    <button
                                        key={cell.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={selected}
                                        onClick={() => setMobileColumnId(cell.id)}
                                        className={`flex min-h-touch shrink-0 items-center gap-1.5 rounded px-3 text-xs font-medium ${
                                            selected ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'
                                        }`}
                                    >
                                        {cell.name}
                                        <span className="rounded bg-gray-100 px-1 text-gray-500">{cell.count}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {mobileColumn && (
                            <div
                                className={`flex flex-col rounded-lg border border-gray-200 bg-gray-50 ${lift}`}
                            >
                                {columnHeadFor(mobileColumn, visibleColumns.indexOf(mobileColumn))}
                                {lanes.length === 0 && <div className={d.columnPad}>{composerFor(mobileColumn.id)}</div>}
                            </div>
                        )}

                        {lanes.length === 0 && (
                            <p className="rounded-md border border-dashed border-gray-200 bg-white/60 px-1 py-4 text-center text-xs text-gray-400">
                                {filtered ? bm.noMatches : bm.emptyColumn}
                            </p>
                        )}

                        {lanes.map((lane) => (
                            <section key={lane.key} aria-label={laneName(lane)}>
                                {laneHeadingFor(lane)}
                                {!isCollapsed(lane) && (
                                    <div className="mt-1.5">
                                        {mobileCellId === UNSORTED_CELL
                                            ? unsortedCellFor(lane, 'w-full')
                                            : mobileColumn && laneCellFor(lane, mobileColumn.id, 'w-full')}
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>
                ) : grouped ? (
                    <div className="overflow-x-auto pb-2">
                        <div className="flex min-w-max flex-col gap-3">
                            {/* The column heads, once, above every lane. Each
                                carries the column marker, so a column can still
                                be dragged by its head and dropped over any of
                                its cells further down. It carries no lane, which
                                is what keeps it from being a place to drop a
                                card — see `laneTarget`. */}
                            <div className="flex items-start gap-3">
                                {unsorted.length > 0 && (
                                    <div
                                        className={`flex ${widthClass} shrink-0 flex-col overflow-hidden rounded-lg border border-amber-300 bg-amber-50 ${lift}`}
                                    >
                                        <div aria-hidden className="h-1 w-full bg-amber-400" />
                                        <div className="bg-white/60 px-3 py-2">
                                            <p className="text-sm font-semibold text-amber-800">{m.unsorted}</p>
                                            <p className="text-xs text-gray-500">{m.unsortedHint}</p>
                                        </div>
                                    </div>
                                )}
                                {visibleColumns.map((column, columnIndex) => (
                                    <div
                                        key={column.id}
                                        {...{ [COLUMN_ATTR]: column.id }}
                                        // No overflow-hidden, unlike a plain column:
                                        // this cell is only as tall as its head, and
                                        // clipping would hide the column's menu.
                                        className={`group/column flex ${widthClass} shrink-0 flex-col rounded-lg border bg-gray-50 ${lift} ${columnRing(column.id)}`}
                                    >
                                        {columnHeadFor(column, columnIndex)}
                                        {/* Each lane cell has its own composer, which is
                                            what decides whose card it is. Up here only
                                            while there are no lanes to hold one. */}
                                        {lanes.length === 0 && (
                                            <div className={d.columnPad}>{composerFor(column.id)}</div>
                                        )}
                                    </div>
                                ))}
                                <BoardColumnComposer
                                    boardId={boardId}
                                    widthClass={widthClass}
                                    onCreated={loadBoard}
                                />
                            </div>

                            {lanes.length === 0 && (
                                <p className="rounded-md border border-dashed border-gray-200 bg-white/60 px-1 py-4 text-center text-xs text-gray-400">
                                    {filtered ? bm.noMatches : bm.emptyColumn}
                                </p>
                            )}

                            {lanes.map((lane, laneIndex) => (
                                <section
                                    key={lane.key}
                                    aria-label={laneName(lane)}
                                    className={motionClass(view, 'column')}
                                    style={{ animationDelay: staggerDelay(view, laneIndex) }}
                                >
                                    {laneHeadingFor(lane)}
                                    {!isCollapsed(lane) && (
                                        <div className="mt-1.5 flex items-stretch gap-3">
                                            {unsorted.length > 0 && unsortedCellFor(lane, `${widthClass} shrink-0`)}
                                            {visibleColumns.map((column) =>
                                                laneCellFor(lane, column.id, `${widthClass} shrink-0`),
                                            )}
                                        </div>
                                    )}
                                </section>
                            ))}
                        </div>
                    </div>
                ) : (
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
                                {visibleUnsorted.map((task, index) => cardFor(task, index))}
                            </div>
                        </div>
                    )}

                    {visibleColumns.map((column, columnIndex) => {
                        const dropIndex =
                            drag?.active && drag.target?.columnId === column.id
                                ? drag.target.index
                                : null;
                        return (
                            <div
                                key={column.id}
                                {...{ [COLUMN_ATTR]: column.id }}
                                className={`group/column flex ${widthClass} flex-col overflow-hidden rounded-lg border bg-gray-50 ${lift} ${motionClass(view, 'column')} ${columnRing(column.id)}`}
                                style={{ animationDelay: staggerDelay(view, columnIndex) }}
                            >
                                {columnHeadFor(column, columnIndex)}

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
                                                {cardFor(task, index)}
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
                                    <div className={`${d.columnPad} pt-0`}>{composerFor(column.id)}</div>
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
                )}
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

            {bulkEditing && selection.length > 0 && (
                <BulkEditCardsModal
                    count={selection.length}
                    projectIds={selectedProjectIds}
                    projects={projects}
                    labels={labels}
                    assignees={assigneeOptions}
                    projectMeta={projectMeta}
                    busy={busy}
                    onSubmit={editCards}
                    onClose={() => setBulkEditing(false)}
                />
            )}

            <RemoveCardsDialog
                open={pendingRemoval !== null}
                count={pendingRemoval?.taskIds.length ?? 0}
                title={pendingRemoval?.title}
                busy={busy}
                onCancel={() => setPendingRemoval(null)}
                onConfirm={confirmRemoval}
            />

            {entry && (
                <TaskEntryModal
                    projects={projects}
                    initial={entry.initial}
                    projectLocked={entry.projectLocked}
                    // Where the card is going, since the form has no field for
                    // it: the column decides the status, a story lane the story.
                    subtitle={[
                        bm.entryColumn.replace(
                            '{column}',
                            columns.find((column) => column.id === entry.columnId)?.name ?? '',
                        ),
                        entry.userStory && `${entry.userStory.code} ${entry.userStory.title}`,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                    projectMeta={projectMeta}
                    assigneeName={(key) =>
                        key === entry.initial.assignee
                            ? entry.assigneeLabel
                            : assigneeOptions.find((option) => option.key === key)?.label
                    }
                    onSubmit={(values) => fileCard(entry, values)}
                    onClose={() => setEntry(null)}
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
 * A swimlane's heading, and the switch that folds the lane away. Sticky to the
 * start edge, so the name stays in view while the board is scrolled sideways
 * to its later columns — a row of cards with its owner scrolled off screen is
 * a row nobody can place.
 */
function LaneHeading({
    lane,
    name,
    story,
    count,
    progress,
    collapsed,
    toggleLabel,
    onToggle,
}: {
    lane: BoardLane;
    name: string;
    story: boolean;
    count: string;
    /** `2/3 done` on a story lane — how far the story has got, at a glance. */
    progress?: string;
    collapsed: boolean;
    toggleLabel: string;
    onToggle: () => void;
}) {
    return (
        <h2 className="sticky start-0 w-max max-w-full md:max-w-md">
            <button
                type="button"
                aria-expanded={!collapsed}
                title={toggleLabel}
                onClick={onToggle}
                className="flex min-h-touch max-w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-start text-sm font-medium text-gray-800 shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600 md:min-h-0"
            >
                <ChevronDown
                    aria-hidden
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
                        collapsed ? '-rotate-90 rtl:rotate-90' : ''
                    }`}
                />
                {story
                    ? lane.code && <span className="shrink-0 font-mono text-xs text-blue-700">{lane.code}</span>
                    : lane.key !== NO_LANE && (
                          <span
                              aria-hidden
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-medium text-blue-700"
                          >
                              {initialsOf(name)}
                          </span>
                      )}
                <span className="truncate">{name}</span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 text-xs font-normal text-gray-600">
                    {count}
                </span>
                {progress && (
                    <span
                        className={`shrink-0 rounded px-1.5 text-xs font-normal ${
                            lane.done === lane.count
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-gray-100 text-gray-600'
                        }`}
                    >
                        {progress}
                    </span>
                )}
            </button>
        </h2>
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
    onEdit,
    onRemove,
    onClear,
}: {
    count: number;
    columns: BoardColumn[];
    busy: boolean;
    onMove: (columnId: string) => void;
    /** Opens the bulk edit dialog: sprint, project, assignee, priority, due date, labels. */
    onEdit: () => void;
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

            <Button variant="secondary" className="max-md:min-h-touch" disabled={busy} onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {m.editSelected}
            </Button>
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

/**
 * The board's filters, on the same bar the Tasks list uses.
 *
 * A board is scanned for a slice of the work — my plate this week, everything on
 * High or Urgent in the running sprint — so the filters here mirror the Tasks
 * list's: the same dimensions, the same multi-select chips, the same "More" for
 * the rarely reached ones, and the same per-option counts. What differs is where
 * they run: the whole board is already in the browser, so these narrow it there
 * and never ask the server for anything. That keeps the board's own order intact
 * under a filter, which a re-query could not.
 */
function BoardFilterBar({
    filters,
    onChange,
    cards,
    assignees,
    labels,
    projects,
    sprints,
    stories,
    userId,
    shown,
    total,
}: {
    filters: BoardFilters;
    onChange: (next: BoardFilters) => void;
    /** Every card on the board, for the option counts. */
    cards: BoardTask[];
    assignees: AssigneeOption[];
    labels: ProjectLabel[];
    /** The projects holding a card here. */
    projects: FilterOption[];
    /** The sprints holding a card here, the running one first. */
    sprints: SprintOption[];
    stories: StoryOption[];
    /** So the assignee filter can spell "me". */
    userId: string | null;
    shown: number;
    total: number;
}) {
    const { t } = useI18n();
    const f = t.projects.board.filters;
    const m = t.projects.boards;
    const active = hasActiveFilter(filters);
    const today = tenantDateOnly();

    const patch = (partial: Partial<BoardFilters>) => onChange({ ...filters, ...partial });

    const listFilters = useMemo<ResolvedListFilter[]>(() => {
        // How many cards an option would add: the cards that pass every other
        // filter and this one — so the count is answered against the board as
        // it stands, not against the whole board.
        const count = (dimension: Parameters<typeof cardsMatching>[2], pick: (task: BoardTask) => boolean) =>
            cardsMatching(cards, filters, dimension, userId).filter(pick).length;

        const assigneeOptionsWithMe = [
            { value: 'me', label: f.me },
            ...assignees.map((option) => ({ value: option.key, label: option.label })),
            { value: 'unassigned', label: f.unassigned },
        ].map((option) => ({
            ...option,
            count: count('assignee', (task) => {
                const key = assigneeKeyOf(task);
                if (option.value === 'me') return userId != null && key === `user:${userId}`;
                if (option.value === 'unassigned') return key === 'none';
                return key === option.value;
            }),
        }));

        const dueRange: CreatedRange | null =
            filters.dueFrom || filters.dueTo
                ? { ...(filters.dueFrom ? { from: filters.dueFrom } : {}), ...(filters.dueTo ? { to: filters.dueTo } : {}) }
                : null;
        const updatedRange: CreatedRange | null =
            filters.updatedFrom || filters.updatedTo
                ? {
                      ...(filters.updatedFrom ? { from: filters.updatedFrom } : {}),
                      ...(filters.updatedTo ? { to: filters.updatedTo } : {}),
                  }
                : null;
        const createdRange: CreatedRange | null =
            filters.createdFrom || filters.createdTo
                ? {
                      ...(filters.createdFrom ? { from: filters.createdFrom } : {}),
                      ...(filters.createdTo ? { to: filters.createdTo } : {}),
                  }
                : null;

        return [
            {
                id: 'assignee',
                type: 'multi-select',
                label: f.assignee,
                options: assigneeOptionsWithMe,
                value: filters.assignees,
                onChange: (assignees) => patch({ assignees }),
            },
            {
                id: 'status',
                type: 'multi-select',
                label: f.status,
                options: STATUS_CATEGORIES.map((category) => ({
                    value: category,
                    label: t.projects.statusCategory[category],
                    count: count('status', (task) => task.status?.category === category),
                })),
                value: filters.statusCategories,
                onChange: (statusCategories) => patch({ statusCategories }),
            },
            {
                id: 'hideDone',
                type: 'toggle',
                label: f.hideDone,
                pressed: filters.hideDone,
                onChange: (hideDone) => patch({ hideDone }),
            },
            {
                id: 'priority',
                type: 'multi-select',
                label: f.priority,
                options: PRIORITIES.map((value) => ({
                    value,
                    label: t.projects.priority[value],
                    count: count('priority', (task) => task.priority === value),
                })),
                value: filters.priorities,
                onChange: (priorities) => patch({ priorities }),
            },
            {
                id: 'due',
                type: 'multi-select',
                label: f.due,
                options: BOARD_DUE_PRESETS.map((value) => ({
                    value,
                    label: {
                        overdue: f.overdue,
                        today: f.dueToday,
                        week: f.dueThisWeek,
                        none: f.noDueDate,
                    }[value],
                    count: count('due', (task) => matchesDuePresetForCount(task, value)),
                })),
                value: filters.due,
                onChange: (due) =>
                    patch({
                        due: due.filter((value): value is BoardDuePreset =>
                            (BOARD_DUE_PRESETS as readonly string[]).includes(value),
                        ),
                    }),
            },
            ...(projects.length > 1 || filters.projectIds.length > 0
                ? [
                      {
                          id: 'project',
                          type: 'multi-select' as const,
                          label: f.projectFilter,
                          options: projects.map((option) => ({
                              value: option.key,
                              label: option.label,
                              count: count('project', (task) => task.project?.id === option.key),
                          })),
                          value: filters.projectIds,
                          onChange: (projectIds: string[]) => patch({ projectIds }),
                      },
                  ]
                : []),
            ...(sprints.length > 0 || filters.sprintIds.length > 0
                ? [
                      {
                          id: 'sprint',
                          type: 'multi-select' as const,
                          label: f.sprintFilter,
                          options: [
                              { value: 'none', label: f.noSprint, count: count('sprint', (task) => sprintIdOf(task) === null) },
                              ...sprints.map((option) => ({
                                  value: option.key,
                                  label:
                                      option.status === 'ACTIVE'
                                          ? f.sprintActive.replace('{name}', option.label)
                                          : option.label,
                                  count: count('sprint', (task) => sprintIdOf(task) === option.key),
                              })),
                          ],
                          value: filters.sprintIds,
                          onChange: (sprintIds: string[]) => patch({ sprintIds }),
                      },
                  ]
                : []),
            ...(stories.length > 0 || filters.storyIds.length > 0
                ? [
                      {
                          id: 'story',
                          type: 'multi-select' as const,
                          label: f.story,
                          more: true,
                          options: [
                              { value: 'none', label: f.noStory, count: count('story', (task) => storyIdOf(task) === null) },
                              ...stories.map((option) => ({
                                  value: option.key,
                                  label: `${option.code} · ${option.label}`,
                                  count: count('story', (task) => storyIdOf(task) === option.key),
                              })),
                          ],
                          value: filters.storyIds,
                          onChange: (storyIds: string[]) => patch({ storyIds }),
                      },
                  ]
                : []),
            ...(labels.length > 0 || filters.labelIds.length > 0
                ? [
                      {
                          id: 'labels',
                          type: 'multi-select' as const,
                          label: f.label,
                          more: true,
                          options: [
                              { value: 'none', label: f.noLabel, count: count('label', (task) => labelsOf(task).length === 0) },
                              ...labels.map((label) => ({
                                  value: label.id,
                                  label: label.name,
                                  count: count('label', (task) => labelsOf(task).some((row) => row.id === label.id)),
                              })),
                          ],
                          value: filters.labelIds,
                          onChange: (labelIds: string[]) => patch({ labelIds }),
                      },
                  ]
                : []),
            {
                id: 'dueBetween',
                type: 'date-range',
                label: f.dueBetween,
                more: true,
                value: dueRange,
                presets: [],
                onChange: (next) => patch({ dueFrom: next?.from ?? '', dueTo: next?.to ?? '' }),
            },
            {
                id: 'time',
                type: 'multi-select',
                label: f.time,
                more: true,
                options: TIME_FLAGS.map((value) => ({
                    value,
                    label: { over: f.overEstimate, none: f.noHours, 'no-estimate': f.noEstimate }[value],
                    count: count('time', (task) => matchesTimeFlagForCount(task, value)),
                })),
                value: filters.time,
                onChange: (time) =>
                    patch({
                        time: time.filter((value): value is TimeFlag =>
                            (TIME_FLAGS as readonly string[]).includes(value),
                        ),
                    }),
            },
            {
                id: 'hours',
                type: 'number',
                label: f.loggedHours,
                more: true,
                value: filters.hours,
                onChange: (hours: NumberCondition | null) => patch({ hours }),
            },
            {
                id: 'updated',
                type: 'multi-select',
                label: f.updated,
                more: true,
                options: UPDATED_PRESETS.map((value) => ({
                    value,
                    label: { d2: f.stale2, d3: f.stale3, d7: f.stale7 }[value],
                    count: count('updated', (task) => matchesUpdatedPreset(task, value as UpdatedPreset, today)),
                })),
                value: filters.updated,
                onChange: (updated) =>
                    patch({
                        updated: updated.filter((value): value is UpdatedPreset =>
                            (UPDATED_PRESETS as readonly string[]).includes(value),
                        ),
                    }),
            },
            {
                id: 'updatedBetween',
                type: 'date-range',
                label: f.updatedBetween,
                more: true,
                value: updatedRange,
                presets: [],
                onChange: (next) => patch({ updatedFrom: next?.from ?? '', updatedTo: next?.to ?? '' }),
            },
            {
                id: 'created',
                type: 'date-range',
                label: f.createdBetween,
                more: true,
                value: createdRange,
                presets: [],
                onChange: (next) => patch({ createdFrom: next?.from ?? '', createdTo: next?.to ?? '' }),
            },
        ];
        // `patch` closes over the latest filters setter. Rebuilding the bar when
        // the cards or the choices change is the point of this memo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards, filters, assignees, labels, projects, sprints, stories, userId, today, f, t.projects]);

    return (
        /* No card of its own: this sits among the header's buttons, so a border
           and white fill around a row of chips would read as a panel floating in
           the action row. The search box stays first — on a board of two hundred
           cards, typing three letters is the fastest of these and the only
           control that reaches a card's own words rather than its metadata. */
        <div className="flex max-w-full flex-1 flex-wrap items-center gap-2" data-testid="board-filters">
            <span className="relative">
                <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 start-2"
                />
                <Input
                    type="search"
                    aria-label={m.searchCards}
                    placeholder={m.searchCards}
                    // The bar's own Clear all only reaches the chips, so the
                    // search keeps a clear of its own — otherwise the one filter
                    // typed rather than picked would be the one left behind.
                    className={`w-40 max-md:min-h-touch ps-7 ${filters.text ? 'pe-7' : ''}`}
                    value={filters.text}
                    onChange={(e) => patch({ text: e.target.value })}
                />
                {filters.text ? (
                    <button
                        type="button"
                        // Named for what it clears: the panel's own footer has a
                        // "Clear" of its own one click away.
                        aria-label={m.clearSearch}
                        onClick={() => patch({ text: '' })}
                        className="absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 end-1.5 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                ) : null}
            </span>
            <FilterBar filters={listFilters} compact={false} layout="row" />
            {active ? (
                <span className="whitespace-nowrap text-xs text-gray-500">
                    {f.showing.replace('{shown}', String(shown)).replace('{total}', String(total))}
                </span>
            ) : null}
        </div>
    );
}

function TaskCard({
    task,
    view,
    index,
    dragging,
    fresh,
    selecting,
    selected,
    onToggleSelected,
    onOpen,
    consumeSwallowedClick,
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
    /** Just composed: marked for a moment, so the eye finds it among the rest. */
    fresh: boolean;
    /**
     * True while anything on the board is selected. The box then shows on every
     * card rather than only on the chosen ones, so a selection started from one
     * column's menu can be widened or narrowed by hand from anywhere.
     */
    selecting: boolean;
    selected: boolean;
    onToggleSelected: () => void;
    onOpen: () => void;
    /** True when the click is the one a finished drag left behind, and should not open. */
    consumeSwallowedClick: () => boolean;
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
    const tm = t.projects.timer;

    // Straight from the shared store, so the card, the header chip and the
    // tracker cannot disagree about what is running.
    const timerRunning = useIsTimerRunningFor(task.id);
    const timerBusy = useProjectTimerStore((state) => state.busy);
    const { start: startTimer, stop: stopTimer } = useProjectTimerActions();

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
    const showProject = show.project && Boolean(projectLabel);
    const showMeta = showDetails || show.assignee || showProject;

    // Start only: a running clock is stopped from its own row further down,
    // which also shows how long it has run. The button sits in the meta row,
    // beside the hours it adds to. A card with that row switched off gets it
    // in the hover toolbar instead, so the clock can always be started.
    const startButton = timerRunning ? null : (
        <button
            type="button"
            aria-label={tm.start}
            title={tm.start}
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                void startTimer({ taskId: task.id, tagIds: [] });
            }}
            disabled={timerBusy}
            className="max-md:min-h-touch max-md:min-w-touch inline-flex items-center justify-center rounded px-1 text-gray-300 transition-colors hover:text-emerald-600 disabled:opacity-40 md:group-hover:text-gray-400 md:hover:!text-emerald-600"
        >
            <Play className="h-3.5 w-3.5" />
        </button>
    );

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
            onClick={() => {
                if (consumeSwallowedClick()) return;
                onOpen();
            }}
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
            className={`group relative shrink-0 touch-pan-y overflow-hidden rounded-md border bg-white text-start text-sm shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 md:cursor-grab ${
                // Selection is a thing you are doing to the card; a running
                // clock is a thing happening on it, and outlives navigating
                // away — so it wins the border when both are true.
                timerRunning
                    ? 'border-emerald-500 ring-1 ring-emerald-300'
                    : selected
                      ? 'border-blue-500 ring-1 ring-blue-300'
                      : fresh
                        ? 'border-blue-400 ring-2 ring-blue-200'
                        : 'border-gray-200'
            } ${dragging ? 'opacity-40' : ''} ${motionClass(view, 'card')}`}
        >
            {cover && <div aria-hidden className={`h-1.5 w-full ${cover}`} />}

            <div className={d.cardPad}>
            <div className="flex items-start gap-1">
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
                {/* Touch only. On a pointer device the whole card starts a drag,
                    so the grip only took width from the title. On touch, a finger
                    on the card scrolls the column (`touch-pan-y`), so the grip is
                    still the only way to start a drag there. */}
                <button
                    type="button"
                    aria-label={c.drag}
                    tabIndex={-1}
                    onPointerDown={onPointerDownHandle}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    className="-ms-1 min-h-touch touch-none px-1 text-gray-300 hover:text-gray-500 md:hidden"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <p className={`min-w-0 flex-1 pt-0.5 ${d.title}`}>{task.title}</p>
                {/* Beside the title on touch, where nothing hovers. On a pointer
                    device a small toolbar over the top corner, shown only on
                    hover or focus, so it takes no width from the title the rest
                    of the time. */}
                <span className="flex shrink-0 items-center md:absolute md:end-1 md:top-1 md:rounded md:border md:border-gray-200 md:bg-white md:p-0.5 md:opacity-0 md:shadow-sm md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                    {!showMeta && startButton}
                    <button
                        type="button"
                        aria-label={m.removeCard}
                        title={m.removeCard}
                        tabIndex={-1}
                        // Stopped here, before it reaches the article's handler, so a
                        // click on this button never arms a drag or opens the card.
                        // It only asks: `RemoveCardsDialog` does the work.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                        className="max-md:min-h-touch max-md:min-w-touch -me-1 inline-flex items-center justify-center rounded px-1 text-gray-300 hover:text-red-600 md:me-0 md:py-0.5 md:text-gray-400"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </span>
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

            {/* Its own row, not folded into the badges above: those are hidden
                by a board-view preference, and a clock somebody has running
                should not be switchable off. */}
            {timerRunning && (
                <div className={`${d.row} flex items-center gap-1`}>
                    <RunningClock
                        label={tm.running}
                        stopLabel={tm.stop}
                        busy={timerBusy}
                        onStop={() => void stopTimer()}
                    />
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
                    {/* The project, as a chip in this row rather than a line of
                        its own under the title. A card gets read away from its
                        board (two boards side by side, a screenshot in a chat),
                        so it still names its project. Short name, because the
                        full one does not fit an 18rem column; the full name is
                        in the title attribute. */}
                    {showProject && (
                        <span
                            title={task.project?.name ?? undefined}
                            className="inline-flex min-w-0 max-w-[8rem] items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                        >
                            <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="sr-only">{c.project}: </span>
                            <span className="truncate">{projectLabel}</span>
                        </span>
                    )}
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
                    {startButton}

                    {show.assignee &&
                        (assigneeName ? (
                            <span title={assigneeName} aria-label={assigneeName} className="ms-auto inline-flex">
                                <Avatar src={task.assignee?.avatar_url} name={assigneeName} sizeClass={d.avatar} />
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
