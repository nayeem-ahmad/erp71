'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Textarea, Field, ConfirmDialog } from '@/components/ui';
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

export default function BoardsPage() {
    const { t } = useI18n();
    const m = t.projects.boards;

    const [boards, setBoards] = useState<BoardSummary[]>([]);
    const [loading, setLoading] = useState(true);
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
            await api.createBoard({ name: name.trim(), description });
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

            {loading ? (
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            ) : boards.length === 0 ? (
                <p className="text-sm text-gray-500">{m.empty}</p>
            ) : (
                <div className="space-y-4">
                    {boards.map((board) => (
                        <div
                            key={board.id}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 md:p-4"
                        >
                            <Link href={routes.projects.boardDetail(board.id)} className="min-h-touch flex-1">
                                <span className="block text-sm font-medium text-blue-600">{board.name}</span>
                                {board.description ? (
                                    <span className="block text-xs text-gray-500">{board.description}</span>
                                ) : null}
                                <span className="block text-xs text-gray-500">
                                    {m.cardCount.replace('{count}', String(board.card_count))}
                                </span>
                            </Link>
                            <button
                                type="button"
                                aria-label={t.common.delete}
                                onClick={() => setPendingDelete(board)}
                                className="min-h-touch min-w-touch rounded-lg text-gray-400 hover:text-red-600"
                            >
                                <Trash2 className="mx-auto h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

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
