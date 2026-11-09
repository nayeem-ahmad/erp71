'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
}

/** `''` is every board; the other two split on whether the board holds cards. */
type CardsFilter = '' | 'with' | 'empty';

const TABLE_ID = 'project-boards';

export default function BoardsPage() {
    const { t, locale } = useI18n();
    const m = t.projects.boards;
    const listUi = m.listUi;

    const [boards, setBoards] = useState<BoardSummary[]>([]);
    const [loading, setLoading] = useState(true);
    /**
     * Remembered for the tab, so opening a board and coming back lands on the
     * same slice rather than on every board again.
     */
    const [filters, setFilter, filtersReady] = useRememberedFilters('project-boards', {
        search: '',
        cardsFilter: '' as CardsFilter,
    });
    const { search, cardsFilter } = filters;
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

    // The boards endpoint returns the whole list, so the filters run here rather
    // than as another round trip.
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return boards.filter((board) => {
            if (cardsFilter === 'with' && board.card_count === 0) return false;
            if (cardsFilter === 'empty' && board.card_count > 0) return false;
            if (!term) return true;
            return (
                board.name.toLowerCase().includes(term)
                || (board.description ?? '').toLowerCase().includes(term)
            );
        });
    }, [boards, search, cardsFilter]);

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

    const listFilters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'cards',
                type: 'select',
                label: m.cards,
                value: cardsFilter || null,
                onChange: (next) => setFilter('cardsFilter', (next ?? '') as CardsFilter),
                options: [
                    { value: 'with', label: m.withCards },
                    { value: 'empty', label: m.emptyOnly },
                ],
            },
        ],
        [m, cardsFilter, setFilter],
    );

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

    const anyFilter = Boolean(search.trim() || cardsFilter);

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
                searchValue={search}
                onSearchChange={(value) => setFilter('search', value)}
                filters={listFilters}
                filterLayout="row"
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
