'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, Field, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

interface ProjectType {
    id: string;
    name: string;
    is_active: boolean;
}

interface TaskStatus {
    id: string;
    name: string;
    category: string;
    sort_order: number;
    is_active: boolean;
    is_default: boolean;
}

export default function ProjectSettingsPage() {
    const { t } = useI18n();
    const m = t.projects;

    const [types, setTypes] = useState<ProjectType[]>([]);
    const [columns, setColumns] = useState<TaskStatus[]>([]);
    const [typeName, setTypeName] = useState('');
    const [column, setColumn] = useState({ name: '', category: 'TODO' });
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const [typeList, columnList] = await Promise.all([
            api.getProjectTypes(true),
            api.getProjectTaskStatuses(true),
        ]);
        setTypes(Array.isArray(typeList) ? typeList : []);
        setColumns(Array.isArray(columnList) ? columnList : []);
    }, []);

    useEffect(() => {
        load().catch(() => undefined);
    }, [load]);

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

    const addType = (e: React.FormEvent) => {
        e.preventDefault();
        if (!typeName.trim()) return;
        run(() => api.createProjectType({ name: typeName.trim() }), () => setTypeName(''));
    };

    const removeType = (type: ProjectType) =>
        run(async () => {
            const result = (await api.deleteProjectType(type.id)) as {
                deactivated?: boolean;
                projects?: number;
            };
            if (result?.deactivated) {
                toast.info(m.settings.typeDeactivated.replace('{count}', String(result.projects ?? 0)));
            }
        });

    const addColumn = (e: React.FormEvent) => {
        e.preventDefault();
        if (!column.name.trim()) return;
        run(
            () => api.createProjectTaskStatus({ name: column.name.trim(), category: column.category }),
            () => setColumn({ name: '', category: 'TODO' }),
        );
    };

    return (
        <PageShell>
            <PageHeader title={m.settings.title} subtitle={m.settings.subtitle} />

            <section className="rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                    <h2 className="text-sm font-medium">{m.settings.columns}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.settings.columnsHint}</p>
                </div>

                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {columns.map((col) => (
                        <li key={col.id} className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-2">
                            <span className="flex-1 truncate text-sm">{col.name}</span>
                            <StatusBadge tone={col.category === 'DONE' ? 'success' : 'neutral'}>
                                {m.settings.categories[col.category as keyof typeof m.settings.categories] ??
                                    col.category}
                            </StatusBadge>
                            {col.is_default && (
                                <span className="text-xs text-blue-600">{m.settings.isDefault}</span>
                            )}
                            <button
                                type="button"
                                aria-label={t.common.delete}
                                className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                disabled={busy}
                                onClick={() => run(() => api.deleteProjectTaskStatus(col.id))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>

                <form onSubmit={addColumn} className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row dark:border-gray-700">
                    <Input
                        value={column.name}
                        onChange={(e) => setColumn((p) => ({ ...p, name: e.target.value }))}
                        placeholder={m.settings.addColumn}
                        className="md:max-w-xs"
                    />
                    <Select
                        value={column.category}
                        onChange={(e) => setColumn((p) => ({ ...p, category: e.target.value }))}
                        className="md:w-44"
                    >
                        {Object.entries(m.settings.categories).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                    <Button type="submit" disabled={busy} className="min-h-touch">
                        <Plus className="h-4 w-4" />
                        {m.settings.addColumn}
                    </Button>
                </form>
            </section>

            <section className="rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                    <h2 className="text-sm font-medium">{m.settings.types}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.settings.typesHint}</p>
                </div>

                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {types.map((type) => (
                        <li key={type.id} className="flex min-h-touch items-center gap-2 px-3 py-2">
                            <span className="flex-1 truncate text-sm">{type.name}</span>
                            {!type.is_active && <StatusBadge tone="neutral">{m.status.CANCELLED}</StatusBadge>}
                            <button
                                type="button"
                                aria-label={t.common.delete}
                                className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                disabled={busy}
                                onClick={() => removeType(type)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>

                <form onSubmit={addType} className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row dark:border-gray-700">
                    <Input
                        value={typeName}
                        onChange={(e) => setTypeName(e.target.value)}
                        placeholder={m.settings.addType}
                        className="md:max-w-xs"
                    />
                    <Button type="submit" disabled={busy} className="min-h-touch">
                        <Plus className="h-4 w-4" />
                        {m.settings.addType}
                    </Button>
                </form>
            </section>
        </PageShell>
    );
}
