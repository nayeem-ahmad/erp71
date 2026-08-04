'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardColumn {
    id: string;
    name: string;
    category: string;
    sort_order: number;
    is_default: boolean;
    wip_limit?: number | null;
}

interface ProjectSummary {
    id: string;
    code: string;
    name: string;
}

/**
 * Phase 3L: a board's columns belong to the board. The tenant-wide set in
 * Project Setup is now a *template* that new projects are seeded from — editing
 * it never changes a board that already exists, which is what this page says in
 * its subtitle so nobody goes looking in the wrong place.
 */
export default function ProjectColumnsPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [project, setProject] = useState<ProjectSummary | null>(null);
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [draft, setDraft] = useState({ name: '', category: 'TODO' });
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const list = await api.getProjectColumns(projectId, true);
            setColumns(Array.isArray(list) ? list : []);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [projectId]);

    useEffect(() => {
        load();
        api.getProject(projectId)
            .then((res: unknown) => setProject(res as ProjectSummary))
            .catch(() => setProject(null));
    }, [load, projectId]);

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

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        run(
            () =>
                api.createProjectColumn(projectId, {
                    name: draft.name.trim(),
                    category: draft.category,
                }),
            () => setDraft({ name: '', category: 'TODO' }),
        );
    };

    // Swaps a neighbouring pair. Two writes rather than a batch endpoint,
    // because a column list is short and a half-applied swap only costs an
    // out-of-order column, not a reshuffle on every read.
    const moveBy = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= columns.length) return;
        const a = columns[index];
        const b = columns[target];
        return run(async () => {
            await api.updateProjectTaskStatus(a.id, { sortOrder: b.sort_order });
            await api.updateProjectTaskStatus(b.id, { sortOrder: a.sort_order });
        });
    };

    const setWip = (column: BoardColumn, value: string) => {
        const parsed = value.trim() === '' ? null : Number(value);
        if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) return;
        return run(() => api.updateProjectTaskStatus(column.id, { wipLimit: parsed }));
    };

    return (
        <PageShell>
            <PageHeader
                title={m.columns.title}
                subtitle={m.columns.subtitle}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    project,
                    m.columns.title,
                )}
            />

            <section className="rounded-md border border-gray-200 bg-white">
                {failed ? (
                    <p className="px-3 py-4 text-sm text-danger">{m.columns.loadFailed}</p>
                ) : columns.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-gray-500">{m.columns.empty}</p>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {columns.map((column, index) => (
                            <li
                                key={column.id}
                                className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-2"
                            >
                                <span className="flex-1 truncate text-sm">{column.name}</span>

                                <StatusBadge tone={column.category === 'DONE' ? 'success' : 'neutral'}>
                                    {m.settings.categories[
                                        column.category as keyof typeof m.settings.categories
                                    ] ?? column.category}
                                </StatusBadge>

                                {column.is_default && (
                                    <span className="text-xs text-blue-600">
                                        {m.settings.isDefault}
                                    </span>
                                )}

                                <label className="flex items-center gap-1 text-xs text-gray-500">
                                    {m.columns.wip}
                                    <Input
                                        type="number"
                                        min="1"
                                        className="w-20"
                                        aria-label={`${m.columns.wip} — ${column.name}`}
                                        defaultValue={column.wip_limit ?? ''}
                                        placeholder={m.columns.noLimit}
                                        disabled={busy}
                                        onBlur={(e) => setWip(column, e.target.value)}
                                    />
                                </label>

                                <button
                                    type="button"
                                    aria-label={`${m.checklist.moveUp} ${column.name}`}
                                    className="px-1 text-gray-400 disabled:opacity-30"
                                    disabled={busy || index === 0}
                                    onClick={() => moveBy(index, -1)}
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={`${m.checklist.moveDown} ${column.name}`}
                                    className="px-1 text-gray-400 disabled:opacity-30"
                                    disabled={busy || index === columns.length - 1}
                                    onClick={() => moveBy(index, 1)}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={`${t.common.delete} ${column.name}`}
                                    className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                    disabled={busy}
                                    onClick={() => run(() => api.deleteProjectTaskStatus(column.id))}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <form onSubmit={add} className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row">
                    <Input
                        value={draft.name}
                        aria-label={m.columns.add}
                        placeholder={m.columns.add}
                        className="md:max-w-xs"
                        onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                    />
                    <Select
                        aria-label={m.settings.category}
                        value={draft.category}
                        className="md:w-44"
                        onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                    >
                        {Object.entries(m.settings.categories).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                    <Button type="submit" disabled={busy || !draft.name.trim()} className="min-h-touch">
                        <Plus className="h-4 w-4" />
                        {m.columns.add}
                    </Button>
                </form>
            </section>

            <p className="text-xs text-gray-500">{m.columns.wipHint}</p>
        </PageShell>
    );
}
