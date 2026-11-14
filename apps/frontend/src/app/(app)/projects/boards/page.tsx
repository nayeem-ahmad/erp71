'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Textarea,
    Field,
    ConfirmDialog,
} from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { fetchMe } from '@/hooks/use-me';
import { useFilterUrl } from '@/components/projects/use-filter-url';
import {
    EMPTY_BOARD_FILTERS,
    boardFiltersToQuery,
    boardRange,
    filterBoards,
    parseBoardFilters,
    type BoardFilterDimension,
    type BoardFilterState,
} from '@/components/projects/work-list-filters';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import BoardSwatch from '@/components/projects/BoardSwatch';

interface BoardSummary {
    id: string;
    name: string;
    description?: string | null;
    /** A palette key; see `board-background.ts`. Null on a plain board. */
    background_color?: string | null;
    background_image_url?: string | null;
    card_count: number;
    created_at?: string | null;
    updated_at?: string | null;
    created_by?: string | null;
    creator?: { id: string; name?: string | null; email?: string | null } | null;
    project_ids?: string[];
}

const TABLE_ID = 'project-boards';

function BoardsList() {
    const { t, locale } = useI18n();
    const m = t.projects.boards;
    const listUi = m.listUi;
    const copy = t.projects.sprint.filters;
    const work = t.projects.workList;
    const searchParams = useSearchParams();
    // Read once, at mount: from here on the controls own these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const initial = useMemo(() => parseBoardFilters(searchParams), []);

    const [boards, setBoards] = useState<BoardSummary[]>([]);
    const [loading, setLoading] = useState(true);
    /**
     * Remembered for the tab, so opening a board and coming back lands on the
     * same slice rather than on every board again.
     */
    const [filters, setFilter, filtersReady] = useRememberedFilters<BoardFilterState>(
        'project-boards',
        {
            ...EMPTY_BOARD_FILTERS,
            ...initial.filters,
            // The previous slice stored this as `cardsFilter`.
            cards: initial.filters.cards,
        },
        initial.owned,
    );
    const [userId, setUserId] = useState<string | null>(null);
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    useFilterUrl(filtersReady, filters, boardFiltersToQuery);
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [nameError, setNameError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<BoardSummary | null>(null);
    const [deleting, setDeleting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await api.getBoards();
            setBoards(Array.isArray(list) ? (list as BoardSummary[]) : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setLoading(false);
        }
    }, [t.common.error]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
        void Promise.resolve().then(() => fetchMe()).then((me) => setUserId(me?.id ?? null)).catch(() => setUserId(null));
    }, []);

    // The boards endpoint returns the whole list, so the filters run here rather
    // than as another round trip. The payload now carries owner, dates and the
    // projects of its cards, which is what those filters read.
    const filtered = useMemo(
        () => filterBoards(boards, filters, userId),
        [boards, filters, userId],
    );
    const countBoards = (omit: BoardFilterDimension, pick: (board: BoardSummary) => boolean) =>
        filterBoards(boards, filters, userId, omit).filter(pick).length;

    const closeModal = () => {
        setCreating(false);
        setName('');
        setDescription('');
        setNameError('');
    };

    const submit = async () => {
        if (!name.trim()) {
            setNameError(m.nameRequired);
            return;
        }
        setSaving(true);
        try {
            const trimmedDescription = description.trim();
            await api.createBoard({
                name: name.trim(),
                ...(trimmedDescription ? { description: trimmedDescription } : {}),
            });
            toast.success(m.created);
            closeModal();
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteBoard(pendingDelete.id);
            toast.success(m.deleted);
            setPendingDelete(null);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setDeleting(false);
        }
    };

    const listFilters = useMemo<ListFilter[]>(() => {
        const owners = new Map<string, string>();
        for (const board of boards) {
            if (board.creator?.id) owners.set(board.creator.id, board.creator.name || board.creator.email || board.creator.id);
        }
        return [
            {
                id: 'project',
                type: 'multi-select',
                label: t.projects.fields.project,
                value: filters.projectIds,
                onChange: (projectIds) => setFilter('projectIds', projectIds),
                options: projects.map((project) => ({
                    value: project.id,
                    label: `${project.code} · ${project.name}`,
                    count: countBoards('project', (board) => (board.project_ids ?? []).includes(project.id)),
                })),
            },
            {
                id: 'cards',
                type: 'select',
                label: m.cards,
                value: filters.cards || null,
                onChange: (next) => setFilter('cards', (next ?? '') as BoardFilterState['cards']),
                options: [
                    { value: 'with', label: m.withCards, count: countBoards('cards', (board) => board.card_count > 0) },
                    { value: 'empty', label: m.emptyOnly, count: countBoards('cards', (board) => board.card_count === 0) },
                ],
            },
            {
                id: 'owner',
                type: 'multi-select',
                label: work.owner,
                more: true,
                value: filters.ownerIds,
                onChange: (ownerIds) => setFilter('ownerIds', ownerIds),
                options: [
                    { value: 'me', label: copy.me, count: countBoards('owner', (board) => (board.creator?.id ?? board.created_by) === userId) },
                    { value: 'none', label: work.noOwner, count: countBoards('owner', (board) => !(board.creator?.id ?? board.created_by)) },
                    ...[...owners.entries()].map(([value, label]) => ({
                        value,
                        label,
                        count: countBoards('owner', (board) => (board.creator?.id ?? board.created_by) === value),
                    })),
                ],
            },
            {
                id: 'created',
                type: 'date-range',
                label: work.createdBetween,
                more: true,
                value: boardRange(filters, 'created'),
                presets: [],
                onChange: (next) => {
                    setFilter('createdFrom', next?.from ?? '');
                    setFilter('createdTo', next?.to ?? '');
                },
            },
            {
                id: 'updated',
                type: 'date-range',
                label: copy.updatedBetween,
                more: true,
                value: boardRange(filters, 'updated'),
                presets: [],
                onChange: (next) => {
                    setFilter('updatedFrom', next?.from ?? '');
                    setFilter('updatedTo', next?.to ?? '');
                },
            },
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m, work, copy, t.projects.fields.project, filters, projects, boards, userId, setFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <LayoutGrid aria-hidden />,
                label: listUi.stats.boards,
                value: n(filtered.length),
            },
            {
                id: 'withCards',
                icon: <LayoutGrid aria-hidden />,
                label: listUi.stats.withCards,
                value: n(filtered.filter((board) => board.card_count > 0).length),
            },
            {
                id: 'empty',
                icon: <LayoutGrid aria-hidden />,
                label: listUi.stats.empty,
                value: n(filtered.filter((board) => board.card_count === 0).length),
            },
            {
                id: 'cards',
                icon: <LayoutGrid aria-hidden />,
                label: listUi.stats.cards,
                value: n(filtered.reduce((sum, board) => sum + board.card_count, 0)),
            },
        ];
        return { items, loading: loading || !filtersReady, label: listUi.statsLabel };
    }, [filtered, loading, filtersReady, locale, listUi]);

    const columns = useMemo(
        () => [
            {
                id: 'name',
                header: m.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: BoardSummary } }) => (
                    // The swatch is the point of setting a background: a board
                    // is recognised by its colour, and a list that shows only
                    // names is where that recognition would have to be re-learnt.
                    <span className="flex items-center gap-2">
                        <BoardSwatch board={row.original} />
                        <Link
                            href={routes.projects.boardDetail(row.original.id)}
                            className="font-medium text-blue-600 hover:underline"
                        >
                            {row.original.name}
                        </Link>
                    </span>
                ),
            },
            {
                id: 'description',
                header: m.description,
                accessorKey: 'description',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: BoardSummary } }) =>
                    row.original.description || '—',
            },
            {
                id: 'card_count',
                header: m.cards,
                accessorKey: 'card_count',
                meta: { align: 'end' as const },
                cell: ({ row }: { row: { original: BoardSummary } }) => (
                    <span className="tabular-nums">{row.original.card_count}</span>
                ),
            },
            {
                id: 'actions',
                header: t.projects.fields.actions,
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                cell: ({ row }: { row: { original: BoardSummary } }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Trash2 />}
                            label={m.deleteBoard}
                            intent="danger"
                            onClick={() => setPendingDelete(row.original)}
                        />
                    </RowActions>
                ),
            },
        ],
        [m, t.projects.fields.actions],
    );

    const anyFilter = filtered.length !== boards.length || Boolean(filters.search.trim());

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.title,
                    'projects',
                )}
                actions={
                    <Button className="min-h-touch" onClick={() => setCreating(true)}>
                        <Plus className="h-4 w-4" />
                        {m.newBoard}
                    </Button>
                }
            />

            {/* The table stays on screen with nothing in it: an empty workspace still
                shows the columns, the filters and the toolbar rather than one line of grey text. */}
            <DataTable
                title={m.title}
                tableId={TABLE_ID}
                columns={columns as never}
                data={filtered}
                // Filtering happens here rather than on the server, so the rows are
                // held in the loading state until the remembered filters are in —
                // otherwise the unfiltered list paints first.
                isLoading={loading || !filtersReady}
                emptyMessage={anyFilter ? m.emptyFiltered : m.empty}
                emptyIcon={<LayoutGrid className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={m.searchPlaceholder}
                searchValue={filters.search}
                onSearchChange={(value) => setFilter('search', value)}
                filters={listFilters}
                filterLayout="row"
                scrollFilterRow
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {creating ? (
                <ModalShell onBackdropClick={closeModal}>
                    <ModalHeader title={m.newBoard} onClose={closeModal} />
                    <div className="space-y-4 p-3 md:p-4">
                        <Field label={m.name} required htmlFor="board-name" error={nameError}>
                            <Input
                                id="board-name"
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setNameError('');
                                }}
                                autoFocus
                            />
                        </Field>
                        <Field label={m.description} htmlFor="board-description">
                            <Textarea
                                id="board-description"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={submit} disabled={saving}>
                            {t.common.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            ) : null}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.deleteBoard}
                prompt={m.deleteConfirm.replace('{name}', pendingDelete?.name ?? '')}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}

export default function BoardsPage() {
    return (
        <Suspense fallback={null}>
            <BoardsList />
        </Suspense>
    );
}
