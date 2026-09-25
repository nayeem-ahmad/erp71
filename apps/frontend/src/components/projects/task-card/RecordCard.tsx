'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { ConfirmDialog, StatusBadge } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import RemainingHoursChart from '@/components/projects/RemainingHoursChart';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';
import { num, type RecordTab, type Task, type TimeEntry } from './model';
import type { TaskCard } from './useTaskCard';
import ActivitySection from './ActivitySection';
import AttachmentsSection from './AttachmentsSection';

/**
 * The hours logged against the task, with who logged each.
 *
 * `timeEntries.user` has always come with the task read and was never shown,
 * which on a task more than one person works on left "3h on the 12th" without
 * the one fact that makes it useful. The bin asks first now, the way the board
 * card's does: an hour entry is somebody's timesheet.
 */
function HourLogPanel({ task, card }: { task: Task; card: TaskCard }) {
    const { t } = useI18n();
    const m = t.projects;
    const [pending, setPending] = useState<TimeEntry | null>(null);
    const entries = task.timeEntries ?? [];

    if (entries.length === 0) return <p className="text-sm text-gray-500">{m.time.empty}</p>;

    return (
        <>
            <ul className="divide-y divide-gray-100 text-sm">
                {entries.map((entry) => {
                    const who = entry.user?.name ?? null;
                    return (
                        <li key={entry.id} className="flex items-center gap-3 py-2">
                            <span className="w-24 shrink-0 tabular-nums text-gray-500">
                                {formatDate(entry.work_date)}
                            </span>
                            <span className="w-12 shrink-0 font-semibold tabular-nums text-gray-900">
                                {num(entry.hours)}h
                            </span>
                            <span className="min-w-0 flex-1">
                                {who && (
                                    <span className="flex items-center gap-1.5 text-gray-900">
                                        <Avatar name={who} size="xs" />
                                        <span className="truncate">{who}</span>
                                    </span>
                                )}
                                {entry.note && (
                                    <span className="block truncate text-xs text-gray-500">{entry.note}</span>
                                )}
                            </span>
                            <button
                                type="button"
                                aria-label={t.common.delete}
                                className="max-md:min-h-touch max-md:min-w-touch rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                disabled={card.busy}
                                onClick={() => setPending(entry)}
                            >
                                <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                        </li>
                    );
                })}
            </ul>

            <ConfirmDialog
                open={pending != null}
                title={m.time.deleteEntryTitle}
                prompt={
                    pending
                        ? formatMessage(m.time.deleteEntryPrompt, {
                              hours: num(pending.hours),
                              date: formatDate(pending.work_date),
                          })
                        : ''
                }
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={card.busy}
                onCancel={() => setPending(null)}
                onConfirm={async () => {
                    if (!pending) return;
                    await card.deleteEntry(pending.id);
                    setPending(null);
                }}
            />
        </>
    );
}

/**
 * Every move of the remaining figure: the shape first, the rows under it. The
 * line answers "is this converging", which is what someone opening a card
 * wants to know; the list answers "what happened", and doubles as the chart's
 * table view, so no figure is reachable only by hovering a dot.
 */
function RemainingPanel({ task, card }: { task: Task; card: TaskCard }) {
    const { t } = useI18n();
    const m = t.projects;
    const { history } = card;

    if (history.length === 0) return <p className="text-sm text-gray-500">{m.remaining.empty}</p>;

    return (
        <>
            <RemainingHoursChart
                history={history}
                estimate={task.estimate_hours == null ? null : num(task.estimate_hours)}
                dateLocale={card.localeInfo.dateLocale}
                labels={{
                    title: m.remaining.chart,
                    remaining: m.overview.remaining,
                    estimate: m.overview.estimated,
                    now: m.remaining.chartNow,
                    upNote: m.remaining.chartUpNote,
                }}
            />
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
                {history.map((row) => {
                    const up = Number(row.delta) > 0;
                    return (
                        <li key={row.id} className="flex items-start gap-2 py-2">
                            <span
                                className={`mt-0.5 shrink-0 ${up ? 'text-amber-600' : 'text-emerald-600'}`}
                                aria-hidden
                            >
                                {up ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-1.5">
                                    <StatusBadge tone={up ? 'warning' : 'success'}>
                                        {m.remaining.sources[row.source as keyof typeof m.remaining.sources] ??
                                            row.source}
                                    </StatusBadge>
                                    <span className="tabular-nums text-gray-600">
                                        {num(row.previous_hours)}h → {num(row.new_hours)}h
                                    </span>
                                </p>
                                {row.note && <p className="mt-0.5 text-xs text-gray-500">{row.note}</p>}
                                <p className="mt-0.5 text-xs text-gray-400">
                                    {formatDateTime(row.changed_at)}
                                    {row.user ? ` · ${m.remaining.by} ${row.user.name ?? row.user.email}` : ''}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

/**
 * The record rather than the work: comments, the change log, hours, the
 * remaining-hours history and files, as one card whose header is its tab
 * strip.
 *
 * Tabs rather than stacked sections because only one is ever wanted at a time.
 * `TabPanel` unmounts what is not selected, so a tab whose body fetches on
 * mount fetches when it is first shown — which is what lets the modal open with
 * none selected and stay at three requests, while the page opens on Comments.
 */
export default function RecordCard({
    task,
    card,
    value,
    onChange,
}: {
    task: Task;
    card: TaskCard;
    value: RecordTab | null;
    onChange: (next: RecordTab | null) => void;
}) {
    const { t } = useI18n();
    const m = t.projects;

    return (
        <section className={compactDensity.cardSurface}>
            {/* Edge to edge, so the strip's rule meets the card's sides; the
                first tab's own padding keeps its label off the corner. */}
            <Tabs<RecordTab>
                tabs={[
                    { key: 'comments', label: m.card.tabs.comments, count: task._count?.comments },
                    { key: 'activity', label: m.card.tabs.activity },
                    { key: 'time', label: m.card.tabs.time, count: (task.timeEntries ?? []).length },
                    { key: 'remaining', label: m.card.tabs.remaining, count: card.history.length },
                    { key: 'attachments', label: m.card.tabs.attachments, count: task._count?.attachments },
                ]}
                value={value}
                onChange={onChange}
                idPrefix="task-record"
                label={m.card.record}
                bordered={value != null}
            />

            {value != null && (
                <div className="px-3 pb-4 md:px-4">
                    <TabPanel tabKey="comments" value={value} idPrefix="task-record">
                        <ActivitySection taskId={task.id} onChanged={card.markChanged} show="comments" />
                    </TabPanel>
                    <TabPanel tabKey="activity" value={value} idPrefix="task-record">
                        <ActivitySection taskId={task.id} onChanged={card.markChanged} show="activity" />
                    </TabPanel>
                    <TabPanel tabKey="time" value={value} idPrefix="task-record">
                        <HourLogPanel task={task} card={card} />
                    </TabPanel>
                    <TabPanel tabKey="remaining" value={value} idPrefix="task-record">
                        <RemainingPanel task={task} card={card} />
                    </TabPanel>
                    <TabPanel tabKey="attachments" value={value} idPrefix="task-record">
                        <AttachmentsSection taskId={task.id} />
                    </TabPanel>
                </div>
            )}
        </section>
    );
}
