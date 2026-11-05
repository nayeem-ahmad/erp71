'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useMe } from '@/hooks/use-me';
import { hasPermission, isOwner, tenantFromMe } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, PageHeader, PageShell, Textarea } from '@/components/ui';
import {
    APPROVAL_BUCKETS,
    APPROVAL_INBOX_BATCH_CAP,
    APPROVAL_INBOX_CHANNEL,
    classifyApprovalDraft,
    draftPreview,
    isGradeA,
    isTypingTarget,
    lastHistoryLine,
    type ApprovalBucket,
    type ApprovalHistoryLine,
} from '@/lib/approval-inbox';

interface InboxHistory {
    id: string;
    subject: string | null;
    summary: string | null;
    outcome: string | null;
    notes: string | null;
    channel_code: string | null;
    direction: string | null;
    status: string;
    completed_at: string | null;
}

interface InboxItem {
    id: string;
    subject: string | null;
    notes: string | null;
    due_at: string | null;
    is_approved: boolean;
    lead: { id: string; name: string; grade: string | null };
    history: InboxHistory[];
}

type BucketFilter = ApprovalBucket | 'all';
type BulkKind = 'approve' | 'complete';

function toHistoryLine(row: InboxHistory): ApprovalHistoryLine {
    return {
        subject: row.subject,
        summary: row.summary,
        outcome: row.outcome,
        notes: row.notes,
        channelCode: row.channel_code,
        direction: row.direction,
    };
}

function bucketOf(item: InboxItem): ApprovalBucket {
    return classifyApprovalDraft({
        title: item.subject,
        notes: item.notes,
        history: item.history.map(toHistoryLine),
    });
}

/**
 * CRM → Approvals Inbox. Clears overdue LinkedIn follow-up drafts.
 *
 * Approve flips the existing planned-activity flag so the send queue can pick
 * the row up. Complete uses the existing complete API (channel LinkedIn, no
 * next activity) and that write is what lands in History. This page does not
 * talk to LinkedIn.
 */
export default function ApprovalsInboxPage() {
    const { t } = useI18n();
    const m = t.crm.approvalsInbox;
    const { data: me } = useMe();
    const tenant = tenantFromMe(
        me as { tenants?: { id: string; role?: string | null; permissions?: string[] }[] } | undefined,
        getWorkspaceItem('tenant_id'),
    );
    const owner = isOwner(tenant?.role);
    const canApprove = owner || hasPermission(tenant?.permissions, 'APPROVE_CRM_ACTIVITY');
    const canComplete = owner || hasPermission(tenant?.permissions, 'CREATE_CRM_INTERACTIONS');

    const [items, setItems] = useState<InboxItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [gradeAOnly, setGradeAOnly] = useState(true);
    const [bucket, setBucket] = useState<BucketFilter>('all');
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [openId, setOpenId] = useState<string | null>(null);
    const [skipNotes, setSkipNotes] = useState<Record<string, string>>({});
    const [bulk, setBulk] = useState<BulkKind | null>(null);
    const [bulkNote, setBulkNote] = useState('');
    const [saving, setSaving] = useState(false);
    const skipRef = useRef<HTMLTextAreaElement>(null);
    const running = useRef(false);
    const [focusSkip, setFocusSkip] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getApprovalsInbox() as { items?: InboxItem[] };
            setItems(Array.isArray(data?.items) ? data.items : []);
        } catch {
            setError(m.loadFailed);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (!focusSkip || !openId) return;
        skipRef.current?.focus();
        setFocusSkip(false);
    }, [focusSkip, openId]);

    const tagged = useMemo(
        () => items.map((item) => ({ item, bucket: bucketOf(item) })),
        [items],
    );
    const gradeScoped = useMemo(
        () => tagged.filter(({ item }) => !gradeAOnly || isGradeA(item.lead.grade)),
        [tagged, gradeAOnly],
    );
    const counts = useMemo(() => {
        const next = Object.fromEntries(APPROVAL_BUCKETS.map((key) => [key, 0])) as Record<ApprovalBucket, number>;
        for (const row of gradeScoped) next[row.bucket] += 1;
        return next;
    }, [gradeScoped]);
    const visible = useMemo(
        () => gradeScoped.filter((row) => bucket === 'all' || row.bucket === bucket),
        [gradeScoped, bucket],
    );

    useEffect(() => {
        setCursor((current) => Math.min(current, Math.max(visible.length - 1, 0)));
    }, [visible.length]);

    const focused = visible[cursor]?.item ?? null;
    const openItem = items.find((item) => item.id === openId) ?? null;

    const toggleSelected = useCallback((id: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const approveOne = useCallback(async (item: InboxItem) => {
        if (!canApprove || item.is_approved || saving) return;
        setSaving(true);
        try {
            await api.setCrmActivityApproval(item.id, true);
            setItems((current) => current.map((row) => (
                row.id === item.id ? { ...row, is_approved: true } : row
            )));
            toast.success(m.toast.approved);
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    }, [canApprove, saving, m.toast.approved, m.toast.failed]);

    const completeOne = useCallback(async (id: string, summary: string) => {
        const note = summary.trim();
        if (!canComplete || !note || saving) return;
        setSaving(true);
        try {
            await api.completeCrmActivity(id, {
                channel: APPROVAL_INBOX_CHANNEL,
                summary: note,
            });
            setItems((current) => current.filter((row) => row.id !== id));
            setSelected((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
            });
            setOpenId((current) => (current === id ? null : current));
            toast.success(m.toast.completed);
        } catch {
            toast.error(m.toast.failed);
        } finally {
            setSaving(false);
        }
    }, [canComplete, saving, m.toast.completed, m.toast.failed]);

    const selectedItems = useMemo(
        () => items.filter((item) => selected.has(item.id)),
        [items, selected],
    );
    const overCap = selectedItems.length > APPROVAL_INBOX_BATCH_CAP;

    const runBulk = useCallback(async () => {
        if (running.current || saving || !bulk || overCap || selectedItems.length === 0) return;
        if (bulk === 'approve' && !canApprove) return;
        if (bulk === 'complete' && (!canComplete || !bulkNote.trim())) return;
        running.current = true;
        setSaving(true);
        const batch = selectedItems.slice(0, APPROVAL_INBOX_BATCH_CAP);
        try {
            if (bulk === 'approve') {
                const pending = batch.filter((item) => !item.is_approved);
                await Promise.all(pending.map((item) => api.setCrmActivityApproval(item.id, true)));
                const ids = new Set(pending.map((item) => item.id));
                setItems((current) => current.map((row) => (
                    ids.has(row.id) ? { ...row, is_approved: true } : row
                )));
                toast.success(m.toast.bulkApproved.replace('{count}', String(pending.length)));
            } else {
                const note = bulkNote.trim();
                await Promise.all(batch.map((item) => api.completeCrmActivity(item.id, {
                    channel: APPROVAL_INBOX_CHANNEL,
                    summary: note,
                })));
                const ids = new Set(batch.map((item) => item.id));
                setItems((current) => current.filter((row) => !ids.has(row.id)));
                toast.success(m.toast.bulkCompleted.replace('{count}', String(batch.length)));
            }
            setSelected(new Set());
            setBulk(null);
            setBulkNote('');
        } catch {
            toast.error(m.toast.failed);
            await load();
        } finally {
            running.current = false;
            setSaving(false);
        }
    }, [
        bulk,
        bulkNote,
        canApprove,
        canComplete,
        load,
        m.toast.bulkApproved,
        m.toast.bulkCompleted,
        m.toast.failed,
        overCap,
        saving,
        selectedItems,
    ]);

    const openLead = useCallback((id: string) => {
        window.open(routes.crm.leadDetail(id), '_blank', 'noopener,noreferrer');
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;
            const key = event.key;
            if ((key === 'j' || key === 'J') && visible.length > 0) {
                event.preventDefault();
                setCursor((current) => Math.min(current + 1, visible.length - 1));
                return;
            }
            if ((key === 'k' || key === 'K') && visible.length > 0) {
                event.preventDefault();
                setCursor((current) => Math.max(current - 1, 0));
                return;
            }
            if (key === ' ' && focused) {
                event.preventDefault();
                toggleSelected(focused.id);
                return;
            }
            if ((key === 'a' || key === 'A') && focused) {
                event.preventDefault();
                void approveOne(focused);
                return;
            }
            if ((key === 's' || key === 'S') && focused) {
                event.preventDefault();
                setOpenId(focused.id);
                const note = (skipNotes[focused.id] ?? '').trim();
                if (note) void completeOne(focused.id, note);
                else setFocusSkip(true);
                return;
            }
            if ((key === 'o' || key === 'O') && focused) {
                event.preventDefault();
                openLead(focused.lead.id);
                return;
            }
            if (key === 'Enter' && bulk) {
                event.preventDefault();
                void runBulk();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [approveOne, bulk, completeOne, focused, openLead, runBulk, skipNotes, toggleSelected, visible.length]);

    const bucketLabel: Record<ApprovalBucket, string> = {
        ready: m.buckets.ready,
        already_dmd: m.buckets.alreadyDmd,
        lapsed_invite: m.buckets.lapsedInvite,
        needs_rewrite: m.buckets.needsRewrite,
        hold: m.buckets.hold,
    };

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, m.title, 'crm')}
            />

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    aria-pressed={bucket === 'all'}
                    onClick={() => setBucket('all')}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        bucket === 'all' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                >
                    {m.buckets.all}
                    <span className="ml-1 text-gray-400">{gradeScoped.length}</span>
                </button>
                {APPROVAL_BUCKETS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={bucket === key}
                        onClick={() => setBucket((current) => (current === key ? 'all' : key))}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            bucket === key ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'
                        }`}
                    >
                        {bucketLabel[key]}
                        <span className="ml-1 text-gray-400">{counts[key]}</span>
                    </button>
                ))}
                <label className="ml-auto flex min-h-touch items-center gap-2 text-sm text-gray-700">
                    <Checkbox
                        checked={gradeAOnly}
                        onChange={(event) => setGradeAOnly(event.target.checked)}
                    />
                    {m.gradeAOnly}
                </label>
            </div>
            <p className="text-xs text-gray-400">{m.shortcuts}</p>

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-400">{t.common.loading}</p>
            ) : error ? (
                <p className="py-8 text-center text-sm text-red-600">{error}</p>
            ) : visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">{m.empty}</p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-gray-100 text-xs text-gray-500">
                            <tr>
                                <th className="w-10 px-3 py-2" />
                                <th className="px-3 py-2 font-medium">{m.columns.lead}</th>
                                <th className="px-3 py-2 font-medium">{m.columns.grade}</th>
                                <th className="px-3 py-2 font-medium">{m.columns.due}</th>
                                <th className="px-3 py-2 font-medium">{m.columns.draft}</th>
                                <th className="hidden px-3 py-2 font-medium md:table-cell">{m.columns.history}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(({ item, bucket: rowBucket }, index) => {
                                const historyLines = item.history.map(toHistoryLine);
                                const preview = draftPreview(item.notes, item.subject);
                                const lastLine = lastHistoryLine(historyLines);
                                const isCursor = index === cursor;
                                return (
                                    <tr
                                        key={item.id}
                                        data-cursor={isCursor ? 'true' : undefined}
                                        tabIndex={isCursor ? 0 : -1}
                                        onClick={() => {
                                            setCursor(index);
                                            setOpenId(item.id);
                                        }}
                                        className={`cursor-pointer border-b border-gray-50 ${isCursor ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                            <Checkbox
                                                checked={selected.has(item.id)}
                                                aria-label={`${m.select} ${item.lead.name}`}
                                                onChange={() => toggleSelected(item.id)}
                                            />
                                        </td>
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {item.lead.name}
                                            {item.is_approved && (
                                                <span className="ml-2 text-xs font-medium text-emerald-700">{m.approved}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{item.lead.grade || m.noGrade}</td>
                                        <td className="px-3 py-2 text-red-600">
                                            {item.due_at ? formatDate(item.due_at) : m.noDue}
                                        </td>
                                        <td className="max-w-xs px-3 py-2 text-gray-600" title={item.notes || item.subject || ''}>
                                            <span className="line-clamp-2">{preview}</span>
                                            <span className="mt-0.5 block text-xs text-gray-400">{bucketLabel[rowBucket]}</span>
                                        </td>
                                        <td className="hidden max-w-xs px-3 py-2 text-gray-500 md:table-cell">
                                            {lastLine || m.noHistory}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {selectedItems.length > 0 && (
                <div className="sticky bottom-0 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <p className="mr-2 self-center text-sm text-gray-700">
                        {m.selected.replace('{count}', String(selectedItems.length))}
                    </p>
                    {overCap && <p className="self-center text-xs text-red-600">{m.batchCap}</p>}
                    <Button
                        variant="secondary"
                        disabled={!canApprove || overCap || saving}
                        onClick={() => setBulk('approve')}
                    >
                        {m.actions.approveSelected}
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={!canComplete || overCap || saving}
                        onClick={() => setBulk('complete')}
                    >
                        {m.actions.completeSelected}
                    </Button>
                    {bulk === 'complete' && (
                        <Field label={m.actions.whatHappened} htmlFor="bulk-what-happened" className="min-w-64 flex-1">
                            <Textarea
                                id="bulk-what-happened"
                                rows={2}
                                value={bulkNote}
                                placeholder={m.actions.whatHappenedPlaceholder}
                                onChange={(event) => setBulkNote(event.target.value)}
                            />
                        </Field>
                    )}
                    {bulk && (
                        <Button
                            disabled={saving || (bulk === 'complete' && !bulkNote.trim())}
                            onClick={() => { void runBulk(); }}
                        >
                            {m.actions.confirm}
                        </Button>
                    )}
                </div>
            )}

            {openItem && (
                <ModalShell variant="drawer" size="lg" onBackdropClick={() => setOpenId(null)}>
                    <ModalHeader
                        title={openItem.lead.name}
                        subtitle={bucketLabel[bucketOf(openItem)]}
                        onClose={() => setOpenId(null)}
                        closeLabel={t.common.close}
                    >
                        <Link
                            href={routes.crm.leadDetail(openItem.lead.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm font-semibold text-blue-600 hover:bg-gray-100"
                        >
                            {m.actions.openLead}
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                    </ModalHeader>
                    <div className="flex-1 space-y-4 overflow-y-auto p-4">
                        <section className="space-y-1">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{m.panel.draft}</h3>
                            <p className="text-sm font-medium text-gray-900">{openItem.subject}</p>
                            <p className="whitespace-pre-wrap text-sm text-gray-700">
                                {openItem.notes?.trim() || m.panel.noDraft}
                            </p>
                        </section>
                        <section className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{m.panel.history}</h3>
                            {openItem.history.length === 0 ? (
                                <p className="text-sm text-gray-400">{m.noHistory}</p>
                            ) : openItem.history.map((line) => (
                                <div
                                    key={line.id}
                                    className={`rounded-lg border border-gray-100 p-3 ${line.status === 'CANCELLED' ? 'opacity-60' : ''}`}
                                >
                                    <p className="text-sm text-gray-800">{line.summary || line.subject}</p>
                                    {line.subject && line.summary && (
                                        <p className="mt-0.5 text-xs text-gray-500">{line.subject}</p>
                                    )}
                                    <p className="mt-0.5 text-xs text-gray-400">
                                        {[line.channel_code, line.completed_at ? formatDate(line.completed_at) : '']
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                </div>
                            ))}
                        </section>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                disabled={!canApprove || openItem.is_approved || saving}
                                onClick={() => { void approveOne(openItem); }}
                            >
                                {m.actions.approve}
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={!canComplete || saving || !(skipNotes[openItem.id] ?? '').trim()}
                                onClick={() => { void completeOne(openItem.id, skipNotes[openItem.id] ?? ''); }}
                            >
                                {m.actions.skip}
                            </Button>
                        </div>
                        <Field label={m.actions.whatHappened} htmlFor="skip-what-happened">
                            <Textarea
                                id="skip-what-happened"
                                ref={skipRef}
                                rows={3}
                                value={skipNotes[openItem.id] ?? ''}
                                placeholder={m.actions.whatHappenedPlaceholder}
                                onChange={(event) => setSkipNotes((current) => ({
                                    ...current,
                                    [openItem.id]: event.target.value,
                                }))}
                            />
                        </Field>
                    </div>
                </ModalShell>
            )}
        </PageShell>
    );
}
