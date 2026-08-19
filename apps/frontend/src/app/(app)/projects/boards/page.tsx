'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Select,
    Textarea,
    Field,
    ConfirmDialog,
} from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardSummary {
    id: string;
    name: string;
    description?: string | null;
    card_count: number;
}

/** `''` is every board; the other two split on whether the board holds cards. */
type CardsFilter = '' | 'with' | 'empty';

export default function BoardsPage() {
    const { t } = useI18n();
    const m = t.projects.boards;

    const [boards, setBoards] = useState<BoardSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [cardsFilter, setCardsFilter] = useState<CardsFilter>('');
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

    const columns = useMemo(
        () => [
            {
                id: 'name',
                header: m.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: BoardSummary } }) => (
                    <Link
                        href={routes.projects.boardDetail(row.original.id)}
                        className="font-medium text-blue-600 hover:underline"
                    >
                        {row.original.name}
                    </Link>
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
                cell: ({ row }: { row: { original: BoardSummary } }) => row.original.card_count,
            },
            {
                id: 'actions',
                header: t.projects.fields.actions,
                cell: ({ row }: { row: { original: BoardSummary } }) => (
                    <div className="flex items-center justify-end">
                        <button
                            type="button"
                            aria-label={t.common.delete}
                            title={m.deleteBoard}
                            onClick={() => setPendingDelete(row.original)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                        >
                            <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                    </div>
                ),
            },
        ],
        [m, t.common.delete, t.projects.fields.actions],
    );

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

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={m.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select
                    value={cardsFilter}
                    onChange={(event) => setCardsFilter(event.target.value as CardsFilter)}
                    className="md:w-44"
                >
                    <option value="">{m.allBoards}</option>
                    <option value="with">{m.withCards}</option>
                    <option value="empty">{m.emptyOnly}</option>
                </Select>
            </div>

            {/* The table stays on screen with nothing in it: an empty workspace still
                shows the columns, the filters and the toolbar rather than one line of grey text. */}
            <DataTable
                title={m.title}
                tableId="project-boards"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                showSearch={false}
                emptyMessage={search.trim() || cardsFilter ? m.emptyFiltered : m.empty}
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
