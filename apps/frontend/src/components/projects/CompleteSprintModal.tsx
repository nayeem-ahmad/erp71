'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { nextSprintDates, nextSprintName } from './complete-sprint-defaults';

type CarryKind = 'new' | 'sprint' | 'backlog';

interface CompletingSprint {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
}

interface Figures {
    remaining_hours: number;
    task_count: number;
    done_task_count: number;
}

/**
 * The confirmation behind "Complete sprint", and where its unfinished work goes.
 *
 * Completing used to send every unfinished task to the backlog without asking,
 * which left whoever planned the next sprint picking them back out of it from
 * memory. The default now is a new sprint, prefilled to follow this one, so the
 * common case is one click; a planned sprint and the backlog remain.
 *
 * The figures come from the burndown's live totals — the same numbers the
 * sprint page shows — rather than from a second count of the task list.
 */
export default function CompleteSprintModal({
    sprint,
    onClose,
    onCompleted,
}: {
    sprint: CompletingSprint;
    onClose: () => void;
    onCompleted: () => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects.sprint;

    const [figures, setFigures] = useState<Figures | null>(null);
    const [planned, setPlanned] = useState<{ id: string; name: string }[]>([]);
    const [kind, setKind] = useState<CarryKind>('new');
    const [form, setForm] = useState(() => ({
        name: nextSprintName(sprint.name),
        ...nextSprintDates(sprint.start_date, sprint.end_date),
        start: false,
    }));
    const [targetId, setTargetId] = useState('');
    const [errors, setErrors] = useState<{ name?: string; endDate?: string }>({});
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getSprintBurndown(sprint.id)
            .then((res) => {
                if (!cancelled) setFigures((res as { current?: Figures } | null)?.current ?? null);
            })
            .catch(() => {
                if (!cancelled) setFigures(null);
            });
        api.getSprints()
            .then((list) => {
                if (cancelled) return;
                const options = (Array.isArray(list) ? list : [])
                    .filter((candidate: { id: string; status: string }) =>
                        candidate.status === 'PLANNED' && candidate.id !== sprint.id,
                    )
                    .map((candidate: { id: string; name: string }) => ({ id: candidate.id, name: candidate.name }));
                setPlanned(options);
                setTargetId((current) => current || options[0]?.id || '');
            })
            .catch(() => setPlanned([]));
        return () => {
            cancelled = true;
        };
    }, [sprint.id]);

    const unfinished = figures ? Math.max(figures.task_count - figures.done_task_count, 0) : null;
    // Until the figures arrive, assume there is work to place: offering the
    // choice and then withdrawing it reads better than the reverse.
    const hasUnfinished = unfinished == null || unfinished > 0;

    const submit = async () => {
        let carryTo: Parameters<typeof api.completeSprint>[1];
        if (hasUnfinished && kind === 'new') {
            const next: typeof errors = {};
            if (!form.name.trim()) next.name = m.nameRequired;
            if (form.endDate < form.startDate) next.endDate = m.endBeforeStart;
            setErrors(next);
            if (next.name || next.endDate) return;
            carryTo = {
                kind: 'new',
                name: form.name.trim(),
                startDate: form.startDate,
                endDate: form.endDate,
                ...(form.start ? { start: true } : {}),
            };
        } else if (hasUnfinished && kind === 'sprint' && targetId) {
            carryTo = { kind: 'sprint', sprintId: targetId };
        } else if (hasUnfinished) {
            carryTo = { kind: 'backlog' };
        }

        setBusy(true);
        try {
            const result = (await api.completeSprint(sprint.id, carryTo)) as {
                carried_over?: number;
                carried_to?: { id: string; name: string } | null;
            };
            const count = result?.carried_over ?? 0;
            toast.success(
                result?.carried_to
                    ? fmt(m.carriedTo, { count, name: result.carried_to.name })
                    : count > 0
                      ? fmt(m.carriedOver, { count })
                      : m.completedMsg,
            );
            onCompleted();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const choice = (value: CarryKind, label: string, disabled = false, hint?: string) => (
        <label
            className={`flex min-h-touch items-start gap-3 rounded-md border p-3 transition-colors ${
                disabled
                    ? 'cursor-not-allowed border-gray-200 opacity-60'
                    : kind === value
                      ? 'cursor-pointer border-blue-300 bg-blue-50'
                      : 'cursor-pointer border-gray-200 hover:bg-gray-50'
            }`}
        >
            <input
                type="radio"
                name="carry-to"
                value={value}
                checked={kind === value}
                disabled={disabled || busy}
                onChange={() => setKind(value)}
                // Named by the label alone; the hint is its description, so a
                // screen reader says "The backlog" first rather than both run together.
                aria-label={label}
                aria-describedby={hint ? `carry-${value}-hint` : undefined}
                className="mt-0.5 h-4 w-4 accent-blue-600"
            />
            <span className="space-y-0.5">
                <span className="block text-sm font-medium text-gray-900">{label}</span>
                {hint && (
                    <span id={`carry-${value}-hint`} className="block text-xs text-gray-500">
                        {hint}
                    </span>
                )}
            </span>
        </label>
    );

    return (
        <ModalShell size="md" onBackdropClick={busy ? undefined : onClose}>
            <ModalHeader title={fmt(m.completeTitle, { name: sprint.name })} onClose={busy ? undefined : onClose} />
            <div className="space-y-3 p-4">
                {figures && (
                    <p className="text-sm text-gray-700">
                        {fmt(m.completeSummary, {
                            done: figures.done_task_count,
                            open: unfinished ?? 0,
                            hours: Math.round(figures.remaining_hours * 100) / 100,
                        })}
                    </p>
                )}

                {!hasUnfinished ? (
                    <p className="text-sm text-gray-500">{m.completeAllDone}</p>
                ) : (
                    <fieldset className="space-y-2">
                        <legend className="mb-1 text-xs font-medium text-gray-600">
                            {fmt(m.carryTo, { count: unfinished ?? '…' })}
                        </legend>

                        {choice('new', m.carryNew)}
                        {kind === 'new' && (
                            <div className="space-y-3 rounded-md border border-gray-200 p-3">
                                <Field label={m.name} required error={errors.name} htmlFor="carry-name">
                                    <Input
                                        id="carry-name"
                                        value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label={m.startDate} required htmlFor="carry-start">
                                        <Input
                                            id="carry-start"
                                            type="date"
                                            value={form.startDate}
                                            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                                        />
                                    </Field>
                                    <Field label={m.endDate} required error={errors.endDate} htmlFor="carry-end">
                                        <Input
                                            id="carry-end"
                                            type="date"
                                            value={form.endDate}
                                            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                                        />
                                    </Field>
                                </div>
                                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700 md:min-h-0">
                                    <Checkbox
                                        checked={form.start}
                                        onChange={(e) => setForm((f) => ({ ...f, start: e.target.checked }))}
                                    />
                                    {m.startNow}
                                </label>
                            </div>
                        )}

                        {choice('sprint', m.carryExisting, planned.length === 0, planned.length === 0 ? m.carryNoPlanned : undefined)}
                        {kind === 'sprint' && planned.length > 0 && (
                            <div className="rounded-md border border-gray-200 p-3">
                                <Field label={m.pickSprint} htmlFor="carry-target">
                                    <Select
                                        id="carry-target"
                                        value={targetId}
                                        onChange={(e) => setTargetId(e.target.value)}
                                    >
                                        {planned.map((option) => (
                                            <option key={option.id} value={option.id}>
                                                {option.name}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                        )}

                        {choice('backlog', m.carryBacklog, false, m.carryBacklogHint)}
                    </fieldset>
                )}
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button onClick={() => void submit()} loading={busy} disabled={busy}>
                    {m.complete}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
