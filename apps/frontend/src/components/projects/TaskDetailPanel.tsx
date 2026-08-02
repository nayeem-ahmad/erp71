'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Input, Select, Textarea, Field, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

interface RemainingLog {
    id: string;
    previous_hours?: string | null;
    new_hours: string;
    delta: string;
    source: string;
    note?: string | null;
    changed_at: string;
    user?: { id: string; name?: string | null; email: string } | null;
}

interface TimeEntry {
    id: string;
    work_date: string;
    hours: string;
    note?: string | null;
    user?: { id: string; name?: string | null } | null;
}

interface Task {
    id: string;
    title: string;
    description?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    logged_hours?: number;
    status?: { id: string; name: string; category: string };
    assignee?: { id: string; name?: string | null; email: string } | null;
    timeEntries?: TimeEntry[];
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const today = () => new Date().toISOString().slice(0, 10);

export default function TaskDetailPanel({
    taskId,
    onClose,
    onChanged,
}: {
    taskId: string;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;

    const [task, setTask] = useState<Task | null>(null);
    const [statuses, setStatuses] = useState<{ id: string; name: string; category: string }[]>([]);
    const [history, setHistory] = useState<RemainingLog[]>([]);
    const [busy, setBusy] = useState(false);

    const [timeForm, setTimeForm] = useState({ hours: '', workDate: today(), note: '', remaining: '' });
    const [reestimate, setReestimate] = useState({ hours: '', note: '' });

    const load = useCallback(async () => {
        const [detail, log, cols] = await Promise.all([
            api.getProjectTask(taskId),
            api.getTaskRemainingHistory(taskId),
            api.getProjectTaskStatuses(),
        ]);
        setTask(detail as Task);
        setHistory(Array.isArray(log) ? log : []);
        setStatuses(Array.isArray(cols) ? cols : []);
    }, [taskId]);

    useEffect(() => {
        load().catch(() => setTask(null));
    }, [load]);

    const refresh = async () => {
        await load();
        onChanged?.();
    };

    const logTime = async (e: React.FormEvent) => {
        e.preventDefault();
        const hours = Number(timeForm.hours);
        if (!hours || hours <= 0) return;
        setBusy(true);
        try {
            await api.logProjectTime({
                taskId,
                workDate: timeForm.workDate,
                hours,
                note: timeForm.note.trim() || undefined,
                // Blank means "accept the suggestion" — the backend works out
                // max(0, remaining - hours) rather than the form guessing.
                remainingHours: timeForm.remaining === '' ? undefined : Number(timeForm.remaining),
            });
            toast.success(m.time.logged);
            setTimeForm({ hours: '', workDate: today(), note: '', remaining: '' });
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not log the time');
        } finally {
            setBusy(false);
        }
    };

    const applyReestimate = async () => {
        if (reestimate.hours === '') return;
        setBusy(true);
        try {
            await api.updateProjectTask(taskId, {
                remainingHours: Number(reestimate.hours),
                remainingNote: reestimate.note.trim() || undefined,
            });
            toast.success(m.task.updated);
            setReestimate({ hours: '', note: '' });
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update the task');
        } finally {
            setBusy(false);
        }
    };

    const changeStatus = async (statusId: string) => {
        setBusy(true);
        try {
            await api.updateProjectTask(taskId, { statusId });
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update the task');
        } finally {
            setBusy(false);
        }
    };

    const deleteEntry = async (entryId: string) => {
        setBusy(true);
        try {
            await api.deleteProjectTimeEntry(entryId);
            toast.success(m.time.deleted);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not delete the entry');
        } finally {
            setBusy(false);
        }
    };

    return (
        <ModalShell onBackdropClick={onClose} size="lg">
            <ModalHeader title={task?.title ?? m.task.title} onClose={onClose} />

            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
                {!task ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <Metric label={m.task.estimate} value={`${num(task.estimate_hours)}h`} />
                            <Metric label={m.task.logged} value={`${num(task.logged_hours)}h`} />
                            <Metric label={m.task.remaining} value={`${num(task.remaining_hours)}h`} highlight />
                        </div>

                        <Field label={m.fields.status}>
                            <Select
                                value={task.status?.id ?? ''}
                                onChange={(e) => changeStatus(e.target.value)}
                                disabled={busy}
                            >
                                {statuses.map((status) => (
                                    <option key={status.id} value={status.id}>
                                        {status.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>

                        <section className="rounded-md border border-gray-200 p-3">
                            <h3 className="mb-2 text-sm font-medium">{m.time.log}</h3>
                            <form onSubmit={logTime} className="space-y-2">
                                <div className="grid gap-2 md:grid-cols-3">
                                    <Field label={m.time.hours} required>
                                        <Input
                                            type="number"
                                            min="0.25"
                                            step="0.25"
                                            value={timeForm.hours}
                                            onChange={(e) =>
                                                setTimeForm((p) => ({ ...p, hours: e.target.value }))
                                            }
                                        />
                                    </Field>
                                    <Field label={m.time.workDate}>
                                        <Input
                                            type="date"
                                            value={timeForm.workDate}
                                            onChange={(e) =>
                                                setTimeForm((p) => ({ ...p, workDate: e.target.value }))
                                            }
                                        />
                                    </Field>
                                    <Field label={m.time.remainingAfter} hint={m.time.remainingHint}>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.25"
                                            placeholder={String(
                                                Math.max(
                                                    num(task.remaining_hours) - Number(timeForm.hours || 0),
                                                    0,
                                                ),
                                            )}
                                            value={timeForm.remaining}
                                            onChange={(e) =>
                                                setTimeForm((p) => ({ ...p, remaining: e.target.value }))
                                            }
                                        />
                                    </Field>
                                </div>
                                <Field label={m.time.note}>
                                    <Input
                                        value={timeForm.note}
                                        onChange={(e) => setTimeForm((p) => ({ ...p, note: e.target.value }))}
                                    />
                                </Field>
                                <Button type="submit" disabled={busy} className="min-h-touch">
                                    {m.time.log}
                                </Button>
                            </form>
                        </section>

                        <section className="rounded-md border border-gray-200 p-3">
                            <h3 className="text-sm font-medium">{m.task.remaining}</h3>
                            <p className="mb-2 mt-1 text-xs text-gray-500">{m.remaining.hint}</p>
                            <div className="grid gap-2 md:grid-cols-3">
                                <Field label={m.task.remaining}>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={reestimate.hours}
                                        onChange={(e) =>
                                            setReestimate((p) => ({ ...p, hours: e.target.value }))
                                        }
                                    />
                                </Field>
                                <div className="md:col-span-2">
                                    <Field label={m.remaining.note}>
                                        <Input
                                            placeholder={m.remaining.notePlaceholder}
                                            value={reestimate.note}
                                            onChange={(e) =>
                                                setReestimate((p) => ({ ...p, note: e.target.value }))
                                            }
                                        />
                                    </Field>
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="secondary"
                                className="mt-2 min-h-touch"
                                disabled={busy || reestimate.hours === ''}
                                onClick={applyReestimate}
                            >
                                {t.common.save}
                            </Button>
                        </section>

                        <section>
                            <h3 className="mb-2 text-sm font-medium">{m.tabs.time}</h3>
                            {(task.timeEntries ?? []).length === 0 ? (
                                <p className="text-sm text-gray-500">{m.time.empty}</p>
                            ) : (
                                <ul className="divide-y divide-gray-200 text-sm">
                                    {(task.timeEntries ?? []).map((entry) => (
                                        <li key={entry.id} className="flex items-center gap-2 py-1.5">
                                            <span className="w-24 shrink-0 text-gray-500">
                                                {new Date(entry.work_date).toLocaleDateString()}
                                            </span>
                                            <span className="w-14 shrink-0">{num(entry.hours)}h</span>
                                            <span className="flex-1 truncate text-gray-600">
                                                {entry.note ?? ''}
                                            </span>
                                            <button
                                                type="button"
                                                aria-label={t.common.delete}
                                                className="min-h-touch px-2 text-red-600"
                                                disabled={busy}
                                                onClick={() => deleteEntry(entry.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section>
                            <h3 className="mb-2 text-sm font-medium">{m.remaining.history}</h3>
                            {history.length === 0 ? (
                                <p className="text-sm text-gray-500">{m.remaining.empty}</p>
                            ) : (
                                <ul className="divide-y divide-gray-200 text-sm">
                                    {history.map((row) => {
                                        const delta = Number(row.delta);
                                        const up = delta > 0;
                                        return (
                                            <li key={row.id} className="flex items-start gap-2 py-2">
                                                <span
                                                    className={`mt-0.5 shrink-0 ${up ? 'text-amber-600' : 'text-emerald-600'}`}
                                                    aria-hidden
                                                >
                                                    {up ? (
                                                        <ArrowUp className="h-4 w-4" />
                                                    ) : (
                                                        <ArrowDown className="h-4 w-4" />
                                                    )}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="flex flex-wrap items-center gap-1.5">
                                                        <StatusBadge tone={up ? 'warning' : 'success'}>
                                                            {m.remaining.sources[
                                                                row.source as keyof typeof m.remaining.sources
                                                            ] ?? row.source}
                                                        </StatusBadge>
                                                        <span className="text-gray-600">
                                                            {num(row.previous_hours)}h → {num(row.new_hours)}h
                                                        </span>
                                                    </p>
                                                    {row.note && (
                                                        <p className="mt-0.5 text-xs text-gray-500">{row.note}</p>
                                                    )}
                                                    <p className="mt-0.5 text-xs text-gray-400">
                                                        {new Date(row.changed_at).toLocaleString()}
                                                        {row.user
                                                            ? ` · ${m.remaining.by} ${row.user.name ?? row.user.email}`
                                                            : ''}
                                                    </p>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </div>

            <ModalFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div
            className={`rounded-md border p-2 text-center ${
                highlight
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-200'
            }`}
        >
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-sm font-medium">{value}</p>
        </div>
    );
}
