'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, CalendarPlus, CheckCircle2, ClipboardList, Pencil, PhoneCall, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { useTeamMemberOptions } from '@/lib/use-team-member-options';

export type CrmActivity = {
    id: string;
    subject: string | null;
    status: 'PLANNED' | 'DONE' | 'CANCELLED';
    due_at: string | null;
    completed_at: string | null;
    summary: string | null;
    outcome: string | null;
    notes: string | null;
    purpose: { id: string; name: string; icon: string | null } | null;
    channel: { id: string; name: string; icon: string | null } | null;
    assignee: { id: string; name: string | null; email: string } | null;
};

type Props = {
    /** Exactly one of leadId / customerId, matching the old FollowUpPanel contract. */
    leadId?: string;
    customerId?: string;
    /**
     * Pre-fills and opens the "Log activity" dialog. The lead page's AI drafter
     * used to write straight into its own conversation form; that form is gone,
     * so it hands the generated text here instead.
     */
    draft?: { channelCode?: string; summary: string } | null;
    /** Called once the draft has been taken, so the caller can clear it. */
    onDraftConsumed?: () => void;
};

const emptyPlan = { subject: '', due_at: '', purpose: '', notes: '', assigned_to: '' };
const emptyLog = { channel: '', summary: '', outcome: '' };
const emptyComplete = {
    channel: '',
    summary: '',
    outcome: '',
    nextSubject: '',
    nextDueAt: '',
    nextAssignedTo: '',
};
const emptyEdit = { subject: '', due_at: '', purpose: '', notes: '', assigned_to: '' };

/**
 * `datetime-local` wants wall-clock `YYYY-MM-DDTHH:mm`; feeding it a UTC ISO
 * string puts the box an offset out — six hours early, in Dhaka.
 */
function toLocalInputValue(iso: string | null): string {
    if (!iso) return '';
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Every CRM touch against one lead or customer — planned and logged — in one
 * widget.
 *
 * Replaces FollowUpPanel, the lead detail conversation list and the customer
 * detail interaction list. Those were three components over three tables that
 * could not refer to each other; the whole point of the merge is that
 * completing a planned call and recording what happened are one action, so the
 * complete dialog carries the "schedule the next one" block rather than leaving
 * the loop open.
 */
export default function CrmActivityPanel({
    leadId,
    customerId,
    draft,
    onDraftConsumed,
}: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.crm.activities;

    const { options: channels } = useLeadTaxonomy('channels');
    const { options: purposes } = useLeadTaxonomy('purposes');

    const [rows, setRows] = useState<CrmActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [planning, setPlanning] = useState(false);
    const [plan, setPlan] = useState(emptyPlan);

    const [logging, setLogging] = useState(false);
    const [log, setLog] = useState(emptyLog);

    const [completing, setCompleting] = useState<CrmActivity | null>(null);
    const [done, setDone] = useState(emptyComplete);
    const [showNext, setShowNext] = useState(false);

    const [editing, setEditing] = useState<CrmActivity | null>(null);
    const [edit, setEdit] = useState(emptyEdit);

    const { options: memberOptions, currentUserId } = useTeamMemberOptions(m.fields.me);

    const planAssigneeId = useId();
    const editAssigneeId = useId();
    const nextSubjectId = useId();
    const nextDueId = useId();
    const nextAssigneeId = useId();

    const target = useMemo(
        () => (leadId ? { lead_id: leadId } : { customer_id: customerId }),
        [leadId, customerId],
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getAllCrmActivities(leadId ? { leadId } : { customerId });
            setRows(Array.isArray(data) ? data : []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [leadId, customerId]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (!draft) return;
        const match = channels.find((c) => c.code === draft.channelCode);
        setLog({ channel: match?.id ?? channels[0]?.id ?? '', summary: draft.summary, outcome: '' });
        setLogging(true);
        onDraftConsumed?.();
    }, [draft, channels, onDraftConsumed]);

    const planned = rows
        .filter((r) => r.status === 'PLANNED')
        .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
    const history = rows
        .filter((r) => r.status !== 'PLANNED')
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

    const savePlan = async () => {
        if (!plan.subject.trim()) return;
        setSaving(true);
        try {
            await api.createCrmActivity({
                ...target,
                subject: plan.subject.trim(),
                due_at: plan.due_at || undefined,
                purpose: plan.purpose || undefined,
                notes: plan.notes || undefined,
                assigned_to: plan.assigned_to || undefined,
            });
            setPlan(emptyPlan);
            setPlanning(false);
            toast.success(m.toast.scheduled);
            await load();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    };

    const saveLog = async () => {
        if (!log.channel || !log.summary.trim()) return;
        setSaving(true);
        try {
            await api.createCrmActivity({
                ...target,
                status: 'DONE',
                channel: log.channel,
                summary: log.summary.trim(),
                outcome: log.outcome || undefined,
            });
            setLog(emptyLog);
            setLogging(false);
            toast.success(m.toast.logged);
            await load();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    };

    const saveComplete = async () => {
        if (!completing || !done.channel || !done.summary.trim()) return;
        setSaving(true);
        try {
            await api.completeCrmActivity(completing.id, {
                channel: done.channel,
                summary: done.summary.trim(),
                outcome: done.outcome || undefined,
                // Omitted entirely unless both fields are filled — the API
                // validates the nested object, so a half-filled one is a 400.
                ...(showNext && done.nextSubject.trim() && done.nextDueAt
                    ? {
                        next: {
                            subject: done.nextSubject.trim(),
                            due_at: done.nextDueAt,
                            assigned_to: done.nextAssignedTo || undefined,
                        },
                    }
                    : {}),
            });
            setCompleting(null);
            setDone(emptyComplete);
            setShowNext(false);
            toast.success(m.toast.completed);
            await load();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    };

    const cancel = async (id: string) => {
        try {
            await api.cancelCrmActivity(id);
            toast.success(m.toast.cancelled);
            await load();
        } catch {
            toast.error(m.toast.failed);
        }
    };

    const openComplete = (row: CrmActivity) => {
        setCompleting(row);
        setDone({
            ...emptyComplete,
            channel: channels[0]?.id ?? '',
            // The follow-up stays with whoever held the activity being closed,
            // falling back to the person closing it.
            nextAssignedTo: row.assignee?.id ?? currentUserId ?? '',
        });
        setShowNext(false);
    };

    const openEdit = (row: CrmActivity) => {
        setEditing(row);
        setEdit({
            subject: row.subject ?? '',
            due_at: toLocalInputValue(row.due_at),
            purpose: row.purpose?.id ?? '',
            notes: row.notes ?? '',
            assigned_to: row.assignee?.id ?? '',
        });
    };

    /**
     * The only caller of PATCH /crm/activities/:id in the app, and so the only
     * way to move a lead's `next_step`, `next_step_date` and
     * `next_step_assigned_to` — those three are a read-only rollup of the
     * earliest planned activity, recalculated by the server on every write here.
     */
    const saveEdit = async () => {
        if (!editing || !edit.subject.trim()) return;
        setSaving(true);
        try {
            await api.updateCrmActivity(editing.id, {
                subject: edit.subject.trim(),
                due_at: edit.due_at || undefined,
                purpose: edit.purpose || undefined,
                notes: edit.notes,
                // Sent even when empty, so "nobody" is a reachable answer — the
                // DTO's emptyToNull turns '' into an explicit null.
                assigned_to: edit.assigned_to,
            });
            setEditing(null);
            toast.success(m.toast.updated);
            await load();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    variant="secondary"
                    onClick={() => { setLogging(true); setLog({ ...emptyLog, channel: channels[0]?.id ?? '' }); }}
                    icon={<PhoneCall className="w-4 h-4" />}
                >
                    {m.logActivity}
                </Button>
                <Button
                    onClick={() => {
                        setPlan({ ...emptyPlan, assigned_to: currentUserId ?? '' });
                        setPlanning(true);
                    }}
                    icon={<CalendarPlus className="w-4 h-4" />}
                >
                    {m.schedule}
                </Button>
            </div>

            {loading ? (
                <div className="py-8 text-center text-sm text-gray-400">{t.common.loading}</div>
            ) : (
                <>
                    <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {m.planned}
                        </h3>
                        {planned.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
                                {m.noPlanned}
                            </div>
                        ) : (
                            planned.map((row) => {
                                const overdue = Boolean(row.due_at) && new Date(row.due_at as string) < new Date();
                                return (
                                    <div
                                        key={row.id}
                                        className={`flex items-start gap-3 rounded-lg border bg-white p-3 ${overdue ? 'border-red-200' : 'border-gray-100'}`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-0.5 flex items-center gap-2">
                                                {row.purpose && (
                                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                                        {row.purpose.icon ? `${row.purpose.icon} ` : ''}{row.purpose.name}
                                                    </span>
                                                )}
                                                {overdue && (
                                                    <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                                                        <AlertCircle className="h-3.5 w-3.5" /> {m.overdue}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm font-medium text-gray-800">{row.subject}</p>
                                            <p className="mt-0.5 text-xs text-gray-400">
                                                {row.due_at ? `${m.due} ${new Date(row.due_at).toLocaleString()}` : m.noDate}
                                                {row.assignee ? ` · ${row.assignee.name || row.assignee.email}` : ''}
                                            </p>
                                            {row.notes && <p className="text-xs text-gray-400">{row.notes}</p>}
                                        </div>
                                        <div className="flex flex-shrink-0 gap-1">
                                            <Button size="sm" onClick={() => openComplete(row)} icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                                                {m.complete}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => openEdit(row)}
                                                aria-label={m.edit}
                                                icon={<Pencil className="w-3.5 h-3.5" />}
                                            />
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => cancel(row.id)}
                                                aria-label={m.cancelActivity}
                                                icon={<X className="w-3.5 h-3.5" />}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {m.history}
                        </h3>
                        {history.length === 0 ? (
                            <div className="py-8 text-center text-gray-400">
                                <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-30" />
                                <p className="text-sm">{m.noHistory}</p>
                            </div>
                        ) : (
                            history.map((row) => (
                                <div
                                    key={row.id}
                                    className={`rounded-lg border border-gray-100 bg-white p-3 ${row.status === 'CANCELLED' ? 'opacity-60' : ''}`}
                                >
                                    <div className="mb-0.5 flex items-center gap-2">
                                        {row.channel && (
                                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                                {row.channel.icon ? `${row.channel.icon} ` : ''}{row.channel.name}
                                            </span>
                                        )}
                                        {row.status === 'CANCELLED' && (
                                            <span className="text-xs text-gray-400">{m.cancelled}</span>
                                        )}
                                    </div>
                                    {/* A logged touch has no separate title, so the summary is the
                                        headline; a completed plan keeps the subject it was scheduled under. */}
                                    <p className={`text-sm text-gray-800 ${row.status === 'CANCELLED' ? 'line-through' : ''}`}>
                                        {row.subject ?? row.summary}
                                    </p>
                                    {row.subject && row.summary && (
                                        <p className="mt-0.5 text-xs text-gray-500">{row.summary}</p>
                                    )}
                                    {row.outcome && <p className="mt-0.5 text-xs text-gray-500">{row.outcome}</p>}
                                    <p className="mt-0.5 text-xs text-gray-400">
                                        {row.completed_at ? new Date(row.completed_at).toLocaleString() : ''}
                                    </p>
                                </div>
                            ))
                        )}
                    </section>
                </>
            )}

            {planning && (
                <ModalShell onBackdropClick={() => setPlanning(false)}>
                    <ModalHeader title={m.schedule} onClose={() => setPlanning(false)} />
                    <div className="space-y-3 p-4">
                        <Field label={m.fields.subject} required>
                            <Input
                                value={plan.subject}
                                onChange={(e) => setPlan({ ...plan, subject: e.target.value })}
                                placeholder={m.fields.subjectPlaceholder}
                            />
                        </Field>
                        <Field label={m.fields.dueAt}>
                            <Input
                                type="datetime-local"
                                value={plan.due_at}
                                onChange={(e) => setPlan({ ...plan, due_at: e.target.value })}
                            />
                        </Field>
                        <Field label={m.fields.purpose}>
                            <Select value={plan.purpose} onChange={(e) => setPlan({ ...plan, purpose: e.target.value })}>
                                <option value="">{m.fields.noPurpose}</option>
                                {purposes.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.assignedTo} htmlFor={planAssigneeId}>
                            <Select
                                id={planAssigneeId}
                                value={plan.assigned_to}
                                onChange={(e) => setPlan({ ...plan, assigned_to: e.target.value })}
                            >
                                {memberOptions.map((mem) => (
                                    <option key={mem.id} value={mem.id}>{mem.label}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.notes}>
                            <Textarea
                                rows={2}
                                value={plan.notes}
                                onChange={(e) => setPlan({ ...plan, notes: e.target.value })}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setPlanning(false)}>{t.common.cancel}</Button>
                        <Button onClick={savePlan} loading={saving} disabled={!plan.subject.trim()}>
                            {m.fields.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {logging && (
                <ModalShell onBackdropClick={() => setLogging(false)}>
                    <ModalHeader title={m.logActivity} onClose={() => setLogging(false)} />
                    <div className="space-y-3 p-4">
                        <Field label={m.fields.channel} required>
                            <Select value={log.channel} onChange={(e) => setLog({ ...log, channel: e.target.value })}>
                                {channels.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.summary} required>
                            <Textarea
                                rows={3}
                                value={log.summary}
                                onChange={(e) => setLog({ ...log, summary: e.target.value })}
                                placeholder={m.fields.summaryPlaceholder}
                            />
                        </Field>
                        <Field label={m.fields.outcome}>
                            <Input value={log.outcome} onChange={(e) => setLog({ ...log, outcome: e.target.value })} />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setLogging(false)}>{t.common.cancel}</Button>
                        <Button onClick={saveLog} loading={saving} disabled={!log.channel || !log.summary.trim()}>
                            {m.fields.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {completing && (
                <ModalShell onBackdropClick={() => setCompleting(null)}>
                    <ModalHeader title={m.completeTitle} onClose={() => setCompleting(null)} />
                    <div className="space-y-3 p-4">
                        <p className="text-sm font-medium text-gray-700">{completing.subject}</p>
                        <Field label={m.fields.channel} required>
                            <Select value={done.channel} onChange={(e) => setDone({ ...done, channel: e.target.value })}>
                                {channels.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.summary} required>
                            <Textarea
                                rows={3}
                                value={done.summary}
                                onChange={(e) => setDone({ ...done, summary: e.target.value })}
                                placeholder={m.fields.summaryPlaceholder}
                            />
                        </Field>
                        <Field label={m.fields.outcome}>
                            <Input value={done.outcome} onChange={(e) => setDone({ ...done, outcome: e.target.value })} />
                        </Field>

                        {/* Present by default rather than hidden behind a second
                            action: prompting for the next touch is the entire point
                            of merging the two tables. Skippable, never required. */}
                        <div className="rounded-lg border border-gray-100 p-3">
                            <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={showNext}
                                    onChange={(e) => setShowNext(e.target.checked)}
                                />
                                {m.scheduleNext}
                            </label>
                            {showNext && (
                                <div className="mt-3 space-y-3">
                                    <Field label={m.fields.subject} required htmlFor={nextSubjectId}>
                                        <Input
                                            id={nextSubjectId}
                                            value={done.nextSubject}
                                            onChange={(e) => setDone({ ...done, nextSubject: e.target.value })}
                                        />
                                    </Field>
                                    <Field label={m.fields.dueAt} required htmlFor={nextDueId}>
                                        <Input
                                            id={nextDueId}
                                            type="datetime-local"
                                            value={done.nextDueAt}
                                            onChange={(e) => setDone({ ...done, nextDueAt: e.target.value })}
                                        />
                                    </Field>
                                    <Field label={m.fields.assignedTo} htmlFor={nextAssigneeId}>
                                        <Select
                                            id={nextAssigneeId}
                                            value={done.nextAssignedTo}
                                            onChange={(e) => setDone({ ...done, nextAssignedTo: e.target.value })}
                                        >
                                            {memberOptions.map((mem) => (
                                                <option key={mem.id} value={mem.id}>{mem.label}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <p className="text-xs text-gray-400">{m.inheritsHint}</p>
                                </div>
                            )}
                        </div>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setCompleting(null)}>{t.common.cancel}</Button>
                        <Button
                            onClick={saveComplete}
                            loading={saving}
                            disabled={!done.channel || !done.summary.trim()}
                        >
                            {m.complete}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {editing && (
                <ModalShell onBackdropClick={() => setEditing(null)}>
                    <ModalHeader title={m.editTitle} onClose={() => setEditing(null)} />
                    <div className="space-y-3 p-4">
                        <Field label={m.fields.subject} required>
                            <Input
                                value={edit.subject}
                                onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                                placeholder={m.fields.subjectPlaceholder}
                            />
                        </Field>
                        <Field label={m.fields.dueAt}>
                            <Input
                                type="datetime-local"
                                value={edit.due_at}
                                onChange={(e) => setEdit({ ...edit, due_at: e.target.value })}
                            />
                        </Field>
                        <Field label={m.fields.purpose}>
                            <Select value={edit.purpose} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })}>
                                <option value="">{m.fields.noPurpose}</option>
                                {purposes.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.assignedTo} htmlFor={editAssigneeId}>
                            <Select
                                id={editAssigneeId}
                                value={edit.assigned_to}
                                onChange={(e) => setEdit({ ...edit, assigned_to: e.target.value })}
                            >
                                {/* Unlike the schedule form, this one can clear: an
                                    activity already filed may need handing back. */}
                                <option value="">{m.fields.unassigned}</option>
                                {memberOptions.map((mem) => (
                                    <option key={mem.id} value={mem.id}>{mem.label}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.notes}>
                            <Textarea
                                rows={2}
                                value={edit.notes}
                                onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                            />
                        </Field>
                        <p className="text-xs text-gray-400">{m.editRollupHint}</p>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
                        <Button onClick={saveEdit} loading={saving} disabled={!edit.subject.trim()}>
                            {m.fields.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </div>
    );
}
