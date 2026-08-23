'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, StatusBadge } from '@/components/ui';
import {
    LABEL_COLORS,
    labelClass,
    type ProjectLabel,
    type ProjectLabelColor,
} from '@/components/projects/board-tasks';
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
    const [labels, setLabels] = useState<ProjectLabel[]>([]);
    const [timeTags, setTimeTags] = useState<ProjectLabel[]>([]);
    const [typeName, setTypeName] = useState('');
    const [column, setColumn] = useState({ name: '', category: 'TODO' });
    const [label, setLabel] = useState<{ name: string; color: ProjectLabelColor }>({
        name: '',
        color: 'BLUE',
    });
    const [timeTag, setTimeTag] = useState<{ name: string; color: ProjectLabelColor }>({
        name: '',
        color: 'EMERALD',
    });
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const [typeList, columnList, labelList, tagList] = await Promise.all([
            api.getProjectTypes(true),
            api.getProjectTaskStatuses(true),
            api.getProjectLabels(),
            api.getProjectTimeTags(),
        ]);
        setTypes(Array.isArray(typeList) ? typeList : []);
        setColumns(Array.isArray(columnList) ? columnList : []);
        setLabels(Array.isArray(labelList) ? labelList : []);
        setTimeTags(Array.isArray(tagList) ? tagList : []);
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

    const addLabel = (e: React.FormEvent) => {
        e.preventDefault();
        if (!label.name.trim()) return;
        run(
            () => api.createProjectLabel({ name: label.name.trim(), color: label.color }),
            () => setLabel({ name: '', color: 'BLUE' }),
        );
    };

    const removeLabel = (target: ProjectLabel) =>
        run(async () => {
            const result = (await api.deleteProjectLabel(target.id)) as { untagged?: number };
            if (result?.untagged) {
                toast.info(m.labels.untagged.replace('{count}', String(result.untagged)));
            }
        });

    const addTimeTag = (e: React.FormEvent) => {
        e.preventDefault();
        if (!timeTag.name.trim()) return;
        run(
            () => api.createProjectTimeTag({ name: timeTag.name.trim(), color: timeTag.color }),
            () => setTimeTag({ name: '', color: 'EMERALD' }),
        );
    };

    // Deleted rather than refused even when hours carry it, same as a label:
    // retiring "Billable" should not mean untagging six months of afternoons
    // first. The count of hours that lose it comes back so we can say so.
    const removeTimeTag = (target: ProjectLabel) =>
        run(async () => {
            const result = (await api.deleteProjectTimeTag(target.id)) as { untagged?: number };
            if (result?.untagged) {
                toast.info(m.timeTags.untagged.replace('{count}', String(result.untagged)));
            }
        });

    return (
        <PageShell>
            <PageHeader title={m.settings.title} subtitle={m.settings.subtitle} />

            <section className="rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-3 py-2">
                    <h2 className="text-sm font-medium">{m.settings.columns}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.settings.columnsHint}</p>
                </div>

                <ul className="divide-y divide-gray-200">
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

                <form onSubmit={addColumn} className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row">
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

            <section className="rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-3 py-2">
                    <h2 className="text-sm font-medium">{m.labels.title}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.labels.hint}</p>
                </div>

                {labels.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-gray-500">{m.labels.empty}</p>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {labels.map((item) => (
                            <li
                                key={item.id}
                                className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-2"
                            >
                                <span
                                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${labelClass(item.color)}`}
                                >
                                    {item.name}
                                </span>
                                <Select
                                    aria-label={`${m.labels.color} — ${item.name}`}
                                    value={item.color}
                                    disabled={busy}
                                    className="w-36"
                                    onChange={(e) =>
                                        run(() =>
                                            api.updateProjectLabel(item.id, { color: e.target.value }),
                                        )
                                    }
                                >
                                    {LABEL_COLORS.map((color) => (
                                        <option key={color} value={color}>
                                            {m.labels.colors[color]}
                                        </option>
                                    ))}
                                </Select>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    aria-label={`${t.common.delete} ${item.name}`}
                                    className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                    disabled={busy}
                                    onClick={() => removeLabel(item)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <form
                    onSubmit={addLabel}
                    className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row"
                >
                    <Input
                        value={label.name}
                        onChange={(e) => setLabel((p) => ({ ...p, name: e.target.value }))}
                        placeholder={m.labels.namePlaceholder}
                        aria-label={m.labels.add}
                        className="md:max-w-xs"
                    />
                    <Select
                        aria-label={m.labels.color}
                        value={label.color}
                        onChange={(e) =>
                            setLabel((p) => ({ ...p, color: e.target.value as ProjectLabelColor }))
                        }
                        className="md:w-44"
                    >
                        {LABEL_COLORS.map((color) => (
                            <option key={color} value={color}>
                                {m.labels.colors[color]}
                            </option>
                        ))}
                    </Select>
                    <Button type="submit" disabled={busy || !label.name.trim()} className="min-h-touch">
                        <Plus className="h-4 w-4" />
                        {m.labels.add}
                    </Button>
                </form>
            </section>

            <section className="rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-3 py-2">
                    <h2 className="text-sm font-medium">{m.timeTags.title}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.timeTags.hint}</p>
                </div>

                {timeTags.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-gray-500">{m.timeTags.empty}</p>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {timeTags.map((item) => (
                            <li
                                key={item.id}
                                className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-2"
                            >
                                <span
                                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${labelClass(item.color)}`}
                                >
                                    {item.name}
                                </span>
                                <Select
                                    aria-label={`${m.labels.color} — ${item.name}`}
                                    value={item.color}
                                    disabled={busy}
                                    className="w-36"
                                    onChange={(e) =>
                                        run(() =>
                                            api.updateProjectTimeTag(item.id, {
                                                color: e.target.value,
                                            }),
                                        )
                                    }
                                >
                                    {LABEL_COLORS.map((color) => (
                                        <option key={color} value={color}>
                                            {m.labels.colors[color]}
                                        </option>
                                    ))}
                                </Select>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    aria-label={`${t.common.delete} ${item.name}`}
                                    className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                    disabled={busy}
                                    onClick={() => removeTimeTag(item)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <form
                    onSubmit={addTimeTag}
                    className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row"
                >
                    <Input
                        value={timeTag.name}
                        onChange={(e) => setTimeTag((p) => ({ ...p, name: e.target.value }))}
                        placeholder={m.timeTags.namePlaceholder}
                        aria-label={m.timeTags.add}
                        className="md:max-w-xs"
                    />
                    <Select
                        aria-label={`${m.labels.color} — ${m.timeTags.title}`}
                        value={timeTag.color}
                        onChange={(e) =>
                            setTimeTag((p) => ({ ...p, color: e.target.value as ProjectLabelColor }))
                        }
                        className="md:w-44"
                    >
                        {LABEL_COLORS.map((color) => (
                            <option key={color} value={color}>
                                {m.labels.colors[color]}
                            </option>
                        ))}
                    </Select>
                    <Button
                        type="submit"
                        disabled={busy || !timeTag.name.trim()}
                        className="min-h-touch"
                    >
                        <Plus className="h-4 w-4" />
                        {m.timeTags.add}
                    </Button>
                </form>
            </section>

            <section className="rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-3 py-2">
                    <h2 className="text-sm font-medium">{m.settings.types}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{m.settings.typesHint}</p>
                </div>

                <ul className="divide-y divide-gray-200">
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

                <form onSubmit={addType} className="flex flex-col gap-2 border-t border-gray-200 p-3 md:flex-row">
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
