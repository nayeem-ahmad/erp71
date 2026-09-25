'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, CompactSection, Field, Input } from '@/components/ui';
import RemainingSparkline from '@/components/projects/RemainingSparkline';
import { useI18n } from '@/lib/i18n';
import { num, type Task } from './model';
import type { TaskCard } from './useTaskCard';
import { EstimateField } from './fields';
import TimerButton from './TimerButton';

/**
 * Hours as a bare figure — 3.5, not 3.50 or 3.5h. The card is titled Hours, so
 * the unit is said once; the old tiles said it twice ("Logged (h)" over
 * "0h"), and their "(h)" captions wrapped onto a second line at this width.
 */
const hoursFigure = (value: unknown) => String(Math.round(num(value) * 100) / 100);

/**
 * A figure beside the estimate that cannot be typed into here: logged is the
 * sum of the time entries, and remaining moves only through the log form below,
 * which records why.
 */
function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div
            className={`rounded-md border px-1.5 py-1.5 text-center ${
                highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
            }`}
        >
            <p className={`text-xs ${highlight ? 'text-blue-700' : 'text-gray-500'}`}>{label}</p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${highlight ? 'text-blue-900' : 'text-gray-900'}`}>
                {value}
            </p>
        </div>
    );
}

/**
 * Everything about hours in one card: what the job was going to cost, what it
 * has cost, what is left, how that has moved, and the two ways of adding to it.
 *
 * The log form lived in the main column as a card of its own — a heading, a
 * "+" carrying the same words, and a hint describing fields that were folded
 * away. It sits under the figures it changes now, beside the clock, which is
 * where the timer was moved on 2026-09-17 for the same reason.
 */
export default function TimeCard({ task, card }: { task: Task; card: TaskCard }) {
    const { t } = useI18n();
    const m = t.projects;
    const [logging, setLogging] = useState(false);
    const { timeForm, setTimeForm, hours, canSaveWork, busy, saveWork } = card;

    return (
        <CompactSection title={m.card.timeTitle} titleStyle="heading">
            {/* Three across: estimate, logged and remaining are one thought,
                and reading them needs them on one line. */}
            <div className="grid grid-cols-3 gap-2">
                <EstimateField task={task} taskId={task.id} onSaved={card.apply} />
                <Metric label={m.overview.logged} value={hoursFigure(task.logged_hours)} />
                <Metric label={m.overview.remaining} value={hoursFigure(task.remaining_hours)} highlight />
            </div>

            {/* "Is this converging", answered without a click. The full chart
                is in the Remaining tab and draws the same history. */}
            <RemainingSparkline
                history={card.history}
                dateLocale={card.localeInfo.dateLocale}
                labels={{
                    title: m.card.spark.title,
                    remaining: m.overview.remaining,
                    hover: m.card.spark.hover,
                }}
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
                <TimerButton taskId={task.id} onChanged={card.refresh} className="w-full min-w-0" />
                <Button
                    type="button"
                    variant={logging ? 'tinted' : 'secondary'}
                    className="w-full justify-center"
                    aria-expanded={logging}
                    onClick={() => setLogging((open) => !open)}
                >
                    <Plus className="h-4 w-4" aria-hidden />
                    {m.card.logTime}
                </Button>
            </div>

            {/* Hidden rather than unmounted, so a half-filled form survives
                being folded away. Hours and the revised remaining figure are one
                form: they are one act — "here is where this task now stands". */}
            <form
                onSubmit={async (event) => {
                    if (await saveWork(event)) setLogging(false);
                }}
                className={`mt-3 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 ${logging ? '' : 'hidden'}`}
            >
                <div className="grid grid-cols-2 gap-2">
                    <Field label={m.time.hours} htmlFor="task-log-hours">
                        <Input
                            id="task-log-hours"
                            type="number"
                            min="0.25"
                            step="0.25"
                            value={timeForm.hours}
                            onChange={(e) => setTimeForm((p) => ({ ...p, hours: e.target.value }))}
                        />
                    </Field>
                    <Field label={m.time.workDate} htmlFor="task-log-date">
                        <Input
                            id="task-log-date"
                            type="date"
                            value={timeForm.workDate}
                            onChange={(e) => setTimeForm((p) => ({ ...p, workDate: e.target.value }))}
                        />
                    </Field>
                </div>
                {/* The hint lives with the one field it explains, and only
                    shows while that field does — it used to sit under the
                    folded form describing hours nobody could see. */}
                <Field
                    label={m.time.remainingAfter}
                    htmlFor="task-log-remaining"
                    hint={m.time.remainingHint}
                >
                    <Input
                        id="task-log-remaining"
                        type="number"
                        min="0"
                        step="0.25"
                        // The figure a blank box will save: the backend works
                        // out max(0, remaining - hours) rather than the form.
                        placeholder={String(Math.max(num(task.remaining_hours) - hours, 0))}
                        value={timeForm.remaining}
                        onChange={(e) => setTimeForm((p) => ({ ...p, remaining: e.target.value }))}
                    />
                </Field>
                <Field label={m.time.note} htmlFor="task-log-note">
                    <Input
                        id="task-log-note"
                        placeholder={m.remaining.notePlaceholder}
                        value={timeForm.note}
                        onChange={(e) => setTimeForm((p) => ({ ...p, note: e.target.value }))}
                    />
                </Field>
                <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={() => setLogging(false)}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" disabled={busy || !canSaveWork}>
                        {t.common.save}
                    </Button>
                </div>
            </form>
        </CompactSection>
    );
}
