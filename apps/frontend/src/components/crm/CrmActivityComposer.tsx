'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { useTeamMemberOptions } from '@/lib/use-team-member-options';

/** What `POST /crm/activities` wants: exactly one of the two ids. */
export type CrmActivityTarget = { lead_id: string } | { customer_id: string };

/** The overlap of what a lead row and a customer row give the picker. */
type SearchHit = { id: string; name: string; mobile?: string | null; phone?: string | null };

type TargetChoice = {
    kind: 'lead' | 'customer';
    id: string;
    name: string;
    phone: string | null;
};

type Props = {
    /** `log` records something that already happened; `schedule` plans one. */
    mode: 'log' | 'schedule';
    /**
     * The record this activity belongs to, when the caller already knows it —
     * the lead and customer pages do. Leave it out and the dialog asks, which is
     * what lets the tenant-wide activities list create work without first
     * opening the lead it belongs to.
     */
    target?: CrmActivityTarget;
    /** Pre-fills the log form, used by the AI drafter on the lead page. */
    draft?: { channelCode?: string; summary: string } | null;
    onClose: () => void;
    onSaved: () => void;
};

const MIN_QUERY = 2;
const RESULT_LIMIT = 5;

const emptyPlan = { subject: '', due_at: '', purpose: '', notes: '', assigned_to: '' };

/**
 * The Log activity / Schedule activity dialogs, over either a target the caller
 * names or one the person picks here.
 *
 * Lives outside `CrmActivityPanel` because the activities list needs the same
 * two forms without a lead or customer in hand, and two copies of a form that
 * writes the same row is how they drift apart.
 */
export default function CrmActivityComposer({
    mode,
    target,
    draft,
    onClose,
    onSaved,
}: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.crm.activities;

    const { options: channels } = useLeadTaxonomy('channels');
    const { options: purposes } = useLeadTaxonomy('purposes');
    const { options: memberOptions, currentUserId } = useTeamMemberOptions(m.fields.me);

    const [saving, setSaving] = useState(false);
    const [plan, setPlan] = useState(emptyPlan);
    const [log, setLog] = useState({ channel: '', summary: draft?.summary ?? '', outcome: '' });

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<TargetChoice[]>([]);
    const [searching, setSearching] = useState(false);
    const [chosen, setChosen] = useState<TargetChoice | null>(null);

    const planAssigneeId = useId();
    const targetInputId = useId();

    // The channel list arrives after mount, so the select cannot be initialised
    // from it. Fill it once, and only while untouched.
    useEffect(() => {
        if (!channels.length) return;
        setLog((prev) => {
            if (prev.channel) return prev;
            const drafted = draft?.channelCode
                ? channels.find((c) => c.code === draft.channelCode)?.id
                : undefined;
            return { ...prev, channel: drafted ?? channels[0].id };
        });
    }, [channels, draft?.channelCode]);

    // Same for the assignee: a scheduled activity defaults to whoever is scheduling it.
    useEffect(() => {
        if (!currentUserId) return;
        setPlan((prev) => (prev.assigned_to ? prev : { ...prev, assigned_to: currentUserId }));
    }, [currentUserId]);

    const needsTarget = !target;

    /**
     * Leads and customers are separate lists behind separate endpoints, so the
     * picker searches both and labels each hit — a salesperson knows the name
     * they are after, not which of the two tables it is in.
     */
    useEffect(() => {
        if (!needsTarget || chosen) return;
        const q = query.trim();
        if (q.length < MIN_QUERY) {
            setResults([]);
            setSearching(false);
            return;
        }
        let cancelled = false;
        setSearching(true);
        const timer = setTimeout(() => {
            void Promise.all([
                api.getLeads({ search: q, limit: RESULT_LIMIT })
                    .then((r): SearchHit[] => (Array.isArray(r?.items) ? r.items : []))
                    .catch((): SearchHit[] => []),
                api.searchCustomers(q, RESULT_LIMIT)
                    .then((r): SearchHit[] => (Array.isArray(r) ? r : []))
                    .catch((): SearchHit[] => []),
            ]).then(([leads, customers]) => {
                if (cancelled) return;
                setResults([
                    ...leads.map((l): TargetChoice => ({
                        kind: 'lead', id: l.id, name: l.name, phone: l.mobile ?? l.phone ?? null,
                    })),
                    ...customers.map((c): TargetChoice => ({
                        kind: 'customer', id: c.id, name: c.name, phone: c.phone ?? null,
                    })),
                ]);
                setSearching(false);
            });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [needsTarget, chosen, query]);

    const resolvedTarget: CrmActivityTarget | null = useMemo(() => {
        if (target) return target;
        if (!chosen) return null;
        return chosen.kind === 'lead' ? { lead_id: chosen.id } : { customer_id: chosen.id };
    }, [target, chosen]);

    const savePlan = useCallback(async () => {
        if (!resolvedTarget || !plan.subject.trim()) return;
        setSaving(true);
        try {
            await api.createCrmActivity({
                ...resolvedTarget,
                subject: plan.subject.trim(),
                due_at: plan.due_at || undefined,
                purpose: plan.purpose || undefined,
                notes: plan.notes || undefined,
                assigned_to: plan.assigned_to || undefined,
            });
            toast.success(m.toast.scheduled);
            onSaved();
            onClose();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    }, [resolvedTarget, plan, m.toast, onSaved, onClose]);

    const saveLog = useCallback(async () => {
        if (!resolvedTarget || !log.channel || !log.summary.trim()) return;
        setSaving(true);
        try {
            await api.createCrmActivity({
                ...resolvedTarget,
                status: 'DONE',
                channel: log.channel,
                summary: log.summary.trim(),
                outcome: log.outcome || undefined,
            });
            toast.success(m.toast.logged);
            onSaved();
            onClose();
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    }, [resolvedTarget, log, m.toast, onSaved, onClose]);

    const targetPicker = needsTarget && (
        <Field label={m.fields.target} required htmlFor={targetInputId}>
            {chosen ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {chosen.kind === 'lead' ? m.fields.lead : m.fields.customer}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                        {chosen.name}
                        {chosen.phone ? <span className="ms-2 text-gray-500">{chosen.phone}</span> : null}
                    </span>
                    <button
                        type="button"
                        onClick={() => { setChosen(null); setQuery(''); }}
                        aria-label={m.fields.targetChange}
                        className="p-1 text-gray-400 hover:text-gray-700"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ) : (
                <div className="relative">
                    <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input
                        id={targetInputId}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={m.fields.targetPlaceholder}
                        className="ps-8"
                        autoComplete="off"
                    />
                    {query.trim().length < MIN_QUERY ? (
                        <p className="mt-1 text-xs text-gray-400">{m.fields.targetHint}</p>
                    ) : searching ? (
                        <p className="mt-1 text-xs text-gray-400">{t.common.loading}</p>
                    ) : results.length === 0 ? (
                        <p className="mt-1 text-xs text-gray-400">{m.fields.targetNoResults}</p>
                    ) : (
                        <div className="mt-1 overflow-hidden rounded-lg border border-gray-200">
                            {results.map((r) => (
                                <button
                                    key={`${r.kind}-${r.id}`}
                                    type="button"
                                    onClick={() => setChosen(r)}
                                    className="flex min-h-touch w-full items-center gap-2 px-2.5 py-1.5 text-start text-sm hover:bg-blue-50"
                                >
                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                        {r.kind === 'lead' ? m.fields.lead : m.fields.customer}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-gray-900">{r.name}</span>
                                    {r.phone && <span className="text-xs text-gray-500">{r.phone}</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Field>
    );

    if (mode === 'log') {
        return (
            <ModalShell onBackdropClick={onClose}>
                <ModalHeader title={m.logActivity} onClose={onClose} closeLabel={t.common.close} />
                <div className="space-y-3 overflow-y-auto p-4">
                    {targetPicker}
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
                    <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
                    <Button
                        onClick={saveLog}
                        loading={saving}
                        disabled={!resolvedTarget || !log.channel || !log.summary.trim()}
                    >
                        {m.fields.save}
                    </Button>
                </ModalFooter>
            </ModalShell>
        );
    }

    return (
        <ModalShell onBackdropClick={onClose}>
            <ModalHeader title={m.scheduleActivity} onClose={onClose} closeLabel={t.common.close} />
            <div className="space-y-3 overflow-y-auto p-4">
                {targetPicker}
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
                <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
                <Button onClick={savePlan} loading={saving} disabled={!resolvedTarget || !plan.subject.trim()}>
                    {m.fields.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
