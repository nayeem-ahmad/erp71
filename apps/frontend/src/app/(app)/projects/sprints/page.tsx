'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Field, StatusBadge, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
    estimated_hours: number;
    remaining_hours: number;
    /** Derived from the sprint's tasks — a sprint has no project column any more. */
    projects: { id: string; code: string; name: string }[];
    _count?: { tasks: number };
}

const TONE: Record<string, 'neutral' | 'info' | 'success'> = {
    PLANNED: 'neutral',
    ACTIVE: 'info',
    COMPLETED: 'success',
};

export default function SprintsPage() {
    const { t } = useI18n();
    const m = t.projects;

    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Sprint | null>(null);
    const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await api.getSprints();
            setSprints(Array.isArray(list) ? list : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.sprint.loadFailed]);

    useEffect(() => {
        load();
    }, [load]);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.startDate || !form.endDate) return;
        setSaving(true);
        try {
            await api.createSprint({
                name: form.name.trim(),
                goal: form.goal.trim() || undefined,
                startDate: form.startDate,
                endDate: form.endDate,
            });
            toast.success(m.sprint.created);
            setCreating(false);
            setForm({ name: '', goal: '', startDate: '', endDate: '' });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const act = async (fn: () => Promise<unknown>, success: string) => {
        try {
            await fn();
            toast.success(success);
            await load();
        } catch (error) {
            // The one-active-per-tenant rule surfaces here as a 409; show the
            // server's sentence rather than a generic failure.
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        await act(() => api.deleteSprint(pendingDelete.id), m.sprint.deleted);
        setPendingDelete(null);
    };

    return (
        <PageShell>
            <PageHeader
                title={m.sprint.sprints}
                subtitle={m.sprint.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.sprint.sprints,
                    'projects',
                )}
                actions={
                    <Button className="min-h-touch" onClick={() => setCreating(true)}>
                        <Plus className="h-4 w-4" />
                        {m.sprint.newSprint}
                    </Button>
                }
            />

            {loading ? (
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            ) : sprints.length === 0 ? (
                <p className="text-sm text-gray-500">{m.sprint.empty}</p>
            ) : (
                <div className="space-y-3">
                    {sprints.map((sprint) => (
                        <div key={sprint.id} className="rounded-md border border-gray-200 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Link
                                            href={routes.projects.sprintDetail(sprint.id)}
                                            className="font-medium text-blue-600 hover:underline"
                                        >
                                            {sprint.name}
                                        </Link>
                                        <StatusBadge tone={TONE[sprint.status] ?? 'neutral'}>
                                            {(m.sprint[sprint.status.toLowerCase() as keyof typeof m.sprint] as string)
                                                ?? sprint.status}
                                        </StatusBadge>
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {new Date(sprint.start_date).toLocaleDateString()} —{' '}
                                        {new Date(sprint.end_date).toLocaleDateString()}
                                        {sprint.goal ? ` · ${sprint.goal}` : ''}
                                    </p>
                                    {/* A sprint spans whatever projects its tasks came from. */}
                                    <p className="mt-1 text-xs text-gray-600">
                                        {sprint.projects.length === 0
                                            ? m.sprint.noProjects
                                            : sprint.projects.map((p) => p.code).join(', ')}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-gray-500">
                                        {sprint._count?.tasks ?? 0} {m.fields.tasks} · {sprint.remaining_hours}h{' '}
                                        {m.overview.remaining.toLowerCase()}
                                    </span>
                                    {sprint.status === 'PLANNED' && (
                                        <Button
                                            variant="secondary"
                                            className="min-h-touch"
                                            onClick={() => act(() => api.startSprint(sprint.id), m.sprint.started)}
                                        >
                                            {m.sprint.start}
                                        </Button>
                                    )}
                                    {sprint.status === 'ACTIVE' && (
                                        <Button
                                            variant="secondary"
                                            className="min-h-touch"
                                            onClick={() => act(() => api.completeSprint(sprint.id), m.sprint.completedMsg)}
                                        >
                                            {m.sprint.complete}
                                        </Button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setPendingDelete(sprint)}
                                        title={m.sprint.deleteSprint}
                                        className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {creating && (
            <ModalShell onBackdropClick={() => setCreating(false)}>
                <ModalHeader title={m.sprint.newSprint} onClose={() => setCreating(false)} />
                <form onSubmit={create}>
                    <div className="space-y-3 p-4">
                        <Field label={m.sprint.name} required>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                autoFocus
                            />
                        </Field>
                        <Field label={m.sprint.goal}>
                            <Input
                                value={form.goal}
                                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={m.sprint.startDate} required>
                                <Input
                                    type="date"
                                    value={form.startDate}
                                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                                />
                            </Field>
                            <Field label={m.sprint.endDate} required>
                                <Input
                                    type="date"
                                    value={form.endDate}
                                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                                />
                            </Field>
                        </div>
                        <p className="text-xs text-gray-500">{m.sprint.tenantHint}</p>
                    </div>
                    <ModalFooter>
                        <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {t.common.save}
                        </Button>
                    </ModalFooter>
                </form>
            </ModalShell>
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.sprint.deleteSprint}
                prompt={m.sprint.deletePrompt.replace('{name}', pendingDelete?.name ?? '')}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
