'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Checkbox, Input, Select, Field, StatusBadge } from '@/components/ui';
import { labelClass, labelsOf, type ProjectLabel } from '@/components/projects/board-tasks';
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

interface ChecklistItem {
    id: string;
    text: string;
    is_done: boolean;
    sort_order: number;
}

interface Task {
    id: string;
    title: string;
    description?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    logged_hours?: number;
    start_date?: string | null;
    due_date?: string | null;
    status?: { id: string; name: string; category: string };
    assignee?: { id: string; name?: string | null; email: string } | null;
    labels?: { label: ProjectLabel }[];
    checklistItems?: ChecklistItem[];
    timeEntries?: TimeEntry[];
}

/** `@db.Date` arrives as an ISO instant; a date input wants YYYY-MM-DD. */
const dateInputValue = (value?: string | null) => (value ? value.slice(0, 10) : '');

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

    const [allLabels, setAllLabels] = useState<ProjectLabel[]>([]);

    const load = useCallback(async () => {
        const [detail, log, cols, labels] = await Promise.all([
            api.getProjectTask(taskId),
            api.getTaskRemainingHistory(taskId),
            api.getProjectTaskStatuses(),
            api.getProjectLabels(),
        ]);
        setTask(detail as Task);
        setHistory(Array.isArray(log) ? log : []);
        setStatuses(Array.isArray(cols) ? cols : []);
        setAllLabels(Array.isArray(labels) ? labels : []);
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

                        <DatesSection task={task} taskId={taskId} onChanged={refresh} />

                        {allLabels.length > 0 && (
                            <LabelsSection
                                taskId={taskId}
                                all={allLabels}
                                selected={labelsOf(task)}
                                onChanged={refresh}
                            />
                        )}

                        <ChecklistSection
                            taskId={taskId}
                            items={task.checklistItems ?? []}
                            onChanged={refresh}
                        />

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

/**
 * Start and due, saved on change rather than behind a Save button — there are
 * two fields and no validation to batch, so a button would only be one more
 * click between the user and the thing they came here to do.
 */
function DatesSection({
    task,
    taskId,
    onChanged,
}: {
    task: Task;
    taskId: string;
    onChanged: () => Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    const save = async (field: 'startDate' | 'dueDate', value: string) => {
        setSaving(true);
        try {
            // Sends '' rather than undefined to clear: PATCH reads undefined as
            // "leave alone", so only the empty string can mean "no date".
            await api.updateProjectTask(taskId, { [field]: value });
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.dates.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const start = dateInputValue(task.start_date);
    const due = dateInputValue(task.due_date);
    const inverted = start !== '' && due !== '' && start > due;

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-medium">{m.dates.title}</h3>
            {/* `Field` only ties its label to the control when given htmlFor —
                without the matching id these inputs have no accessible name. */}
            <div className="grid gap-2 md:grid-cols-2">
                <Field label={m.dates.start} htmlFor="task-start-date">
                    <Input
                        id="task-start-date"
                        type="date"
                        value={start}
                        disabled={saving}
                        onChange={(e) => save('startDate', e.target.value)}
                    />
                </Field>
                <Field
                    label={m.dates.due}
                    htmlFor="task-due-date"
                    error={inverted ? m.dates.inverted : undefined}
                >
                    <Input
                        id="task-due-date"
                        type="date"
                        value={due}
                        disabled={saving}
                        onChange={(e) => save('dueDate', e.target.value)}
                    />
                </Field>
            </div>
        </section>
    );
}

/**
 * Toggles rather than a multi-select: a label set is small and visual, and the
 * chip you tap is the chip you will see on the card.
 */
function LabelsSection({
    taskId,
    all,
    selected,
    onChanged,
}: {
    taskId: string;
    all: ProjectLabel[];
    selected: ProjectLabel[];
    onChanged: () => Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects.labels;
    const [saving, setSaving] = useState(false);

    const selectedIds = new Set(selected.map((label) => label.id));

    const toggle = async (labelId: string) => {
        const next = new Set(selectedIds);
        if (next.has(labelId)) next.delete(labelId);
        else next.add(labelId);

        setSaving(true);
        try {
            // The whole set every time — the endpoint replaces rather than
            // patches, so there is no add/remove pair to keep in step.
            await api.updateProjectTask(taskId, { labelIds: [...next] });
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-medium">{m.title}</h3>
            <div className="flex flex-wrap gap-1.5">
                {all.map((label) => {
                    const on = selectedIds.has(label.id);
                    return (
                        <button
                            key={label.id}
                            type="button"
                            disabled={saving}
                            aria-pressed={on}
                            onClick={() => toggle(label.id)}
                            className={`min-h-touch rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${labelClass(label.color)} ${
                                on ? 'ring-2 ring-blue-600' : 'opacity-50'
                            }`}
                        >
                            {label.name}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function ChecklistSection({
    taskId,
    items,
    onChanged,
}: {
    taskId: string;
    items: ChecklistItem[];
    onChanged: () => Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects.checklist;

    const [newText, setNewText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);

    const done = items.filter((item) => item.is_done).length;
    const percent = items.length === 0 ? 0 : Math.round((done / items.length) * 100);

    const run = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        const text = newText.trim();
        if (!text) return;
        return run(async () => {
            await api.addTaskChecklistItem(taskId, { text });
            setNewText('');
        });
    };

    const commitEdit = (item: ChecklistItem) => {
        const text = editText.trim();
        setEditingId(null);
        if (!text || text === item.text) return;
        return run(() => api.updateTaskChecklistItem(item.id, { text }));
    };

    // Sends the whole order rather than the swapped pair — a half-applied swap
    // would leave two items sharing a sort_order and the list would reshuffle.
    const moveBy = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[index], next[target]] = [next[target], next[index]];
        return run(() => api.reorderTaskChecklist(taskId, next.map((item) => item.id)));
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{m.title}</h3>
                {items.length > 0 && (
                    <span className="text-xs text-gray-500">
                        {done === items.length
                            ? m.allDone
                            : m.progress
                                  .replace('{done}', String(done))
                                  .replace('{total}', String(items.length))}
                    </span>
                )}
            </div>

            {items.length > 0 && (
                <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={m.title}
                >
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}

            {items.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-2 space-y-0.5">
                    {items.map((item, index) => (
                        <li key={item.id} className="flex items-center gap-2">
                            <Checkbox
                                checked={item.is_done}
                                disabled={saving}
                                aria-label={item.text}
                                onChange={() =>
                                    run(() =>
                                        api.updateTaskChecklistItem(item.id, {
                                            isDone: !item.is_done,
                                        }),
                                    )
                                }
                            />

                            {editingId === item.id ? (
                                <Input
                                    autoFocus
                                    value={editText}
                                    className="flex-1"
                                    onChange={(e) => setEditText(e.target.value)}
                                    onBlur={() => commitEdit(item)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitEdit(item);
                                        }
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className={`min-h-touch flex-1 text-left text-sm ${
                                        item.is_done ? 'text-gray-400 line-through' : ''
                                    }`}
                                    onClick={() => {
                                        setEditingId(item.id);
                                        setEditText(item.text);
                                    }}
                                >
                                    {item.text}
                                </button>
                            )}

                            <button
                                type="button"
                                aria-label={m.moveUp}
                                className="px-1 text-gray-400 disabled:opacity-30"
                                disabled={saving || index === 0}
                                onClick={() => moveBy(index, -1)}
                            >
                                <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={m.moveDown}
                                className="px-1 text-gray-400 disabled:opacity-30"
                                disabled={saving || index === items.length - 1}
                                onClick={() => moveBy(index, 1)}
                            >
                                <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={m.deleteItem}
                                className="px-1 text-red-600"
                                disabled={saving}
                                onClick={() => run(() => api.deleteTaskChecklistItem(item.id))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <form onSubmit={add} className="mt-2 flex gap-2">
                <Input
                    value={newText}
                    placeholder={m.placeholder}
                    className="flex-1"
                    onChange={(e) => setNewText(e.target.value)}
                />
                <Button
                    type="submit"
                    variant="secondary"
                    className="min-h-touch"
                    disabled={saving || newText.trim() === ''}
                >
                    {m.add}
                </Button>
            </form>
        </section>
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
