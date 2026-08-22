'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Megaphone, Plus, Send, Eye, Trash2, RefreshCw, Users, Search, Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import type { CampaignRowIssue, ValidCampaignRow } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { PageShell, PageHeader, Button, Input, Select, Textarea, Field, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { dhakaLocalToIso, isoToDhakaLocal } from '@/lib/schedule-time';
import UploadRecipients from './upload-recipients';

interface Campaign {
    id: string;
    name: string;
    description: string | null;
    status: string;
    channel: string;
    subject: string | null;
    target_segment: string | null;
    /** Null on UPLOAD campaigns — the body lives on each recipient row. */
    message: string | null;
    scheduled_at: string | null;
    sent_at: string | null;
    recipient_count: number;
    delivered_count: number;
    failed_count: number;
    attributed_revenue: number | null;
    attributed_orders: number | null;
    created_at: string;
    creator: { name: string | null; email: string } | null;
    recipient_source: string;
    body_format: string;
    progress?: { total: number; sent: number; failed: number; pending: number };
    recipients?: Array<{
        id: string;
        email: string | null;
        name: string | null;
        subject: string | null;
        status: string;
        error: string | null;
    }>;
}

const SEGMENTS = ['ALL', 'VIP', 'At-Risk', 'Regular', 'New'];
const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];
const STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED'];

const columnHelper = createColumnHelper<Campaign>();

const campaignStatusTone: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SCHEDULED: 'info',
    SENDING: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};

const recipientStatusTone: Record<string, StatusBadgeTone> = {
    PENDING: 'neutral',
    SENDING: 'warning',
    SENT: 'success',
    FAILED: 'danger',
    CANCELLED: 'neutral',
};

export default function CrmCampaignsPage() {
    const { t, locale } = useI18n();
    const m = t.crmCampaigns;
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [channelFilter, setChannelFilter] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    // Create modal state
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({
        name: '',
        description: '',
        channel: 'SMS',
        recipient_source: 'SEGMENT',
        body_format: 'TEXT',
        subject: '',
        target_segment: 'ALL',
        message: '',
        scheduled_at: '',
    });
    const [uploadRows, setUploadRows] = useState<ValidCampaignRow[]>([]);
    const [uploadIssues, setUploadIssues] = useState<CampaignRowIssue[]>([]);

    // Detail/send modal state
    const [selected, setSelected] = useState<Campaign | null>(null);
    const [preview, setPreview] = useState<{ count: number; sample: any[] } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [rescheduleValue, setRescheduleValue] = useState('');
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    const loadCampaigns = useCallback(async () => {
        setLoading(true);
        try {
            setCampaigns(await api.getCrmCampaigns(applyCreatedRangeQuery(createdRange)));
        } finally {
            setLoading(false);
        }
    }, [createdRange]);

    useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

    const isEmail = form.channel === 'EMAIL';
    const isUpload = form.recipient_source === 'UPLOAD';
    const canSubmit = isUpload
        ? Boolean(form.name.trim()) && uploadRows.length > 0
        : Boolean(form.name.trim() && form.message.trim() && (!isEmail || form.subject.trim()));

    const resetForm = () => {
        setForm({
            name: '', description: '', channel: 'SMS', recipient_source: 'SEGMENT',
            body_format: 'TEXT', subject: '', target_segment: 'ALL', message: '', scheduled_at: '',
        });
        setUploadRows([]);
        setUploadIssues([]);
    };

    const setSource = (source: string) => {
        setForm((f) => ({ ...f, recipient_source: source, channel: source === 'UPLOAD' ? 'EMAIL' : f.channel }));
        if (source === 'SEGMENT') { setUploadRows([]); setUploadIssues([]); }
    };

    const handleCreate = async () => {
        if (!canSubmit) return;
        setCreating(true);
        try {
            await api.createCrmCampaign(
                isUpload
                    ? {
                          name: form.name,
                          description: form.description || undefined,
                          channel: 'EMAIL',
                          recipient_source: 'UPLOAD',
                          body_format: form.body_format,
                          rows: uploadRows,
                          scheduled_at: dhakaLocalToIso(form.scheduled_at) ?? undefined,
                      }
                    : {
                          name: form.name,
                          description: form.description || undefined,
                          channel: form.channel,
                          recipient_source: 'SEGMENT',
                          body_format: isEmail ? form.body_format : undefined,
                          subject: isEmail ? form.subject : undefined,
                          target_segment: form.target_segment,
                          message: form.message,
                          scheduled_at: dhakaLocalToIso(form.scheduled_at) ?? undefined,
                      },
            );
            toast.success(m.created);
            setShowCreate(false);
            resetForm();
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.createFailed);
        } finally {
            setCreating(false);
        }
    };

    const handleSelect = async (campaign: Campaign) => {
        setSelected(campaign);
        setPreview(null);
        setRescheduleValue(isoToDhakaLocal(campaign.scheduled_at));
        setPreviewLoading(true);
        try {
            const full = await api.getCrmCampaign(campaign.id);
            setSelected(full);
            if (full.status === 'DRAFT' && full.recipient_source === 'SEGMENT') {
                setPreview(await api.previewCampaignRecipients(campaign.id));
            } else {
                setPreview({ count: full.progress?.total ?? full.recipient_count, sample: [] });
            }
        } catch (err: any) {
            // Without this the modal sits open on the stale row it was opened
            // from, with an unhandled rejection and no sign anything failed.
            toast.error(err?.message ?? m.loadFailed);
            setSelected(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!selected) return;
        if (!confirm(m.schedule.cancelConfirm.replace('{name}', selected.name))) return;
        setCancelling(true);
        try {
            await api.cancelCrmCampaign(selected.id);
            toast.success(m.schedule.cancelled);
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.schedule.cancelFailed);
        } finally {
            setCancelling(false);
        }
    };

    const handleReschedule = async () => {
        if (!selected) return;
        setSavingSchedule(true);
        try {
            // Explicitly null, not undefined: clearing the field has to reach
            // the server as "unschedule this", and an undefined key is dropped
            // from the PATCH body, making it a no-op.
            await api.updateCrmCampaign(selected.id, {
                scheduled_at: dhakaLocalToIso(rescheduleValue),
            });
            toast.success(m.schedule.rescheduled);
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.schedule.rescheduleFailed);
        } finally {
            setSavingSchedule(false);
        }
    };

    const handleSend = async () => {
        if (!selected) return;
        const count = preview?.count ?? selected.recipient_count;
        if (!confirm(m.sendConfirm.replace('{name}', selected.name).replace('{count}', String(count)))) return;
        setSending(true);
        try {
            const result = await api.sendCrmCampaign(selected.id);
            toast.success(`Campaign queued for ${result.queued} recipients`);
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.sendFailed);
        } finally {
            setSending(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteCrmCampaign(id);
            toast.success(m.deleted);
            await loadCampaigns();
        } catch {
            toast.error(m.deleteFailed);
        }
    };

    const charCount = form.message.length;
    const smsPages = Math.ceil(charCount / 160) || 0;

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return campaigns.filter((c) => {
            if (statusFilter && c.status !== statusFilter) return false;
            if (channelFilter && c.channel !== channelFilter) return false;
            if (q && !(`${c.name} ${c.subject ?? ''} ${c.message ?? ''}`.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [campaigns, search, statusFilter, channelFilter]);

    const columns: ColumnDef<Campaign, unknown>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => {
                const c = info.row.original;
                return (
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void handleSelect(c)}
                                className="font-semibold text-gray-900 hover:text-primary truncate text-start"
                            >
                                {c.name}
                            </button>
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{c.channel}</span>
                        </div>
                        {c.channel === 'EMAIL' && c.subject && (
                            <p className="text-xs text-gray-600 font-medium truncate">{c.subject}</p>
                        )}
                        {c.message && <p className="text-xs text-gray-400 truncate">{c.message}</p>}
                    </div>
                );
            },
        }),
        columnHelper.accessor((row) => row.target_segment ?? 'ALL', {
            id: 'segment',
            header: m.columns.segment,
            cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
        }),
        columnHelper.accessor('recipient_count', {
            header: m.columns.recipients,
            cell: (info) => {
                const c = info.row.original;
                return (
                    <div className="text-sm">
                        <span className="inline-flex items-center gap-1 text-gray-700">
                            <Users className="w-3.5 h-3.5 text-gray-400" /> {c.recipient_count}
                        </span>
                        {c.status === 'COMPLETED' && (
                            <div className="text-xs mt-0.5">
                                <span className="text-emerald-600 font-medium">{c.delivered_count} delivered</span>
                                {c.failed_count > 0 && <span className="text-danger ms-2">{c.failed_count} failed</span>}
                            </div>
                        )}
                    </div>
                );
            },
        }),
        columnHelper.accessor('status', {
            header: m.columns.status,
            cell: (info) => {
                const status = info.getValue();
                return (
                    <StatusBadge tone={campaignStatusTone[status] ?? 'neutral'}>
                        {status}
                    </StatusBadge>
                );
            },
        }),
        createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => {
                const c = info.row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <button
                            onClick={() => void handleSelect(c)}
                            className="p-1.5 text-gray-400 hover:text-primary rounded-lg hover:bg-primary-light"
                            title={m.viewSend}
                        >
                            <Eye className="w-4 h-4" />
                        </button>
                        {c.status === 'DRAFT' && (
                            <button
                                onClick={() => void handleDelete(c.id)}
                                className="p-1.5 text-gray-400 hover:text-danger rounded-lg hover:bg-danger-light"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [m, t.common, locale]);

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    m.title,
                    'crm',
                )}
                actions={
                    <>
                        <Button variant="secondary" onClick={loadCampaigns} leftIcon={<RefreshCw className="w-4 h-4" />} />
                        <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="w-4 h-4" />}>
                            {m.newCampaign}
                        </Button>
                    </>
                }
            />

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="ps-9"
                    />
                </div>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allStatuses}</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
                <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allChannels}</option>
                    {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                </Select>
                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
            </div>

            <DataTable<Campaign>
                tableId="crm-campaigns"
                title={m.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                emptyMessage={m.emptyMessage}
                emptyIcon={<Megaphone className="w-10 h-10 text-gray-200" />}
            />

            {/* Create modal */}
            {showCreate && (
                <ModalShell size="md" onBackdropClick={() => { setShowCreate(false); resetForm(); }}>
                    <ModalHeader title={m.newCampaign} onClose={() => { setShowCreate(false); resetForm(); }} />
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                        <Field label={m.columns.name} required>
                            <Input
                                type="text"
                                placeholder={m.placeholders.name}
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            />
                        </Field>

                        <Field label={m.upload.recipientsLabel}>
                            <div className="flex gap-4">
                                {[
                                    { value: 'SEGMENT', label: m.upload.sourceSegment },
                                    { value: 'UPLOAD', label: m.upload.sourceUpload },
                                ].map((option) => (
                                    <label key={option.value} className="flex items-center gap-2 cursor-pointer min-h-touch">
                                        <input
                                            type="radio"
                                            name="recipient-source"
                                            value={option.value}
                                            checked={form.recipient_source === option.value}
                                            onChange={() => setSource(option.value)}
                                            className="accent-blue-600"
                                        />
                                        <span className="text-sm font-medium text-gray-700">{option.label}</span>
                                    </label>
                                ))}
                            </div>
                        </Field>

                        {isUpload ? (
                            <UploadRecipients
                                rows={uploadRows}
                                issues={uploadIssues}
                                onChange={(rows, issues) => { setUploadRows(rows); setUploadIssues(issues); }}
                            />
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Channel">
                                        <Select
                                            value={form.channel}
                                            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                                        >
                                            {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
                                        </Select>
                                    </Field>
                                    <Field label="Target Segment">
                                        <Select
                                            value={form.target_segment}
                                            onChange={(e) => setForm((f) => ({ ...f, target_segment: e.target.value }))}
                                        >
                                            {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
                                        </Select>
                                    </Field>
                                </div>

                                {isEmail && (
                                    <Field label={m.subjectLabel} required>
                                        <Input
                                            type="text"
                                            placeholder={m.placeholders.subject}
                                            value={form.subject}
                                            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                                        />
                                    </Field>
                                )}

                                <Field
                                    label="Message"
                                    required
                                    hint={form.channel === 'SMS' ? `${charCount} chars · ${smsPages} SMS page${smsPages !== 1 ? 's' : ''}` : undefined}
                                >
                                    <Textarea
                                        placeholder={m.placeholders.message}
                                        value={form.message}
                                        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                                        rows={4}
                                    />
                                </Field>
                            </>
                        )}

                        {(isEmail || isUpload) && (
                            <Field label={m.upload.bodyFormatLabel}>
                                <div className="flex gap-4">
                                    {[
                                        { value: 'TEXT', label: m.upload.bodyFormatText },
                                        { value: 'HTML', label: m.upload.bodyFormatHtml },
                                    ].map((option) => (
                                        <label key={option.value} className="flex items-center gap-2 cursor-pointer min-h-touch">
                                            <input
                                                type="radio"
                                                name="body-format"
                                                value={option.value}
                                                checked={form.body_format === option.value}
                                                onChange={() => setForm((f) => ({ ...f, body_format: option.value }))}
                                                className="accent-blue-600"
                                            />
                                            <span className="text-sm font-medium text-gray-700">{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </Field>
                        )}

                        <Field
                            label={m.schedule.label}
                            hint={form.scheduled_at ? m.schedule.resolved.replace('{when}', form.scheduled_at.replace('T', ' ')) : undefined}
                        >
                            <Input
                                type="datetime-local"
                                value={form.scheduled_at}
                                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => { setShowCreate(false); resetForm(); }}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={!canSubmit} loading={creating}>
                            {m.createCampaign}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {/* Detail / Send modal */}
            {selected && (
                <ModalShell size="md" onBackdropClick={() => setSelected(null)}>
                    <ModalHeader
                        title={selected.name}
                        onClose={() => setSelected(null)}
                    >
                        <StatusBadge tone={campaignStatusTone[selected.status] ?? 'neutral'}>
                            {selected.status}
                        </StatusBadge>
                    </ModalHeader>
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                        {selected.channel === 'EMAIL' && selected.subject && (
                            <div className="text-sm">
                                <span className="text-gray-400">{m.subjectLabel}</span> <span className="font-medium text-gray-900">{selected.subject}</span>
                            </div>
                        )}

                        {/* An UPLOAD campaign has no campaign-level body — each
                            recipient carries its own — so there is no panel to show. */}
                        {selected.message && (
                            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap">
                                {selected.message}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><span className="text-gray-400">Channel:</span> <span className="font-medium">{selected.channel}</span></div>
                            <div><span className="text-gray-400">{m.segmentLabel}</span> <span className="font-medium">{selected.target_segment ?? 'ALL'}</span></div>
                            {selected.status === 'COMPLETED' && (
                                <>
                                    <div><span className="text-gray-400">Delivered:</span> <span className="font-medium text-emerald-600">{selected.delivered_count}</span></div>
                                    <div><span className="text-gray-400">Failed:</span> <span className={`font-medium ${selected.failed_count > 0 ? 'text-danger' : 'text-gray-600'}`}>{selected.failed_count}</span></div>
                                    <div><span className="text-gray-400">Sent at:</span> <span className="font-medium">{selected.sent_at ? formatDate(selected.sent_at) : '—'}</span></div>
                                    {(selected.attributed_orders ?? 0) > 0 && (
                                        <>
                                            <div><span className="text-gray-400">Attributed sales:</span> <span className="font-medium text-emerald-600">{selected.attributed_orders}</span></div>
                                            <div><span className="text-gray-400">Attributed revenue:</span> <span className="font-medium text-emerald-600">৳{Number(selected.attributed_revenue ?? 0).toLocaleString()}</span></div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        {selected.status === 'DRAFT' && (
                            <div className="bg-primary-light border border-primary-border rounded-lg p-4">
                                {previewLoading ? (
                                    <div className="flex items-center gap-2 text-primary text-sm">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Loading recipients...
                                    </div>
                                ) : preview ? (
                                    <div>
                                        <p className="text-sm font-semibold text-blue-700 mb-2">
                                            <Users className="w-4 h-4 inline me-1" />{preview.count} recipient{preview.count !== 1 ? 's' : ''} will receive this message
                                        </p>
                                        {preview.sample.length > 0 && (
                                            <div className="space-y-1">
                                                {preview.sample.slice(0, 5).map((c: any) => (
                                                    <div key={c.id} className="text-xs text-blue-700">{c.name} · {c.phone}</div>
                                                ))}
                                                {preview.count > 5 && <div className="text-xs text-blue-700/70">+{preview.count - 5} more</div>}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}

                        {selected.progress && selected.progress.total > 0 && (
                            <p className="text-xs text-gray-500">
                                {m.recipients.progress
                                    .replace('{sent}', String(selected.progress.sent))
                                    .replace('{failed}', String(selected.progress.failed))
                                    .replace('{pending}', String(selected.progress.pending))}
                            </p>
                        )}

                        {selected.recipient_source === 'UPLOAD' && (
                            <div>
                                <p className="text-xs font-semibold text-gray-500 mb-2">{m.recipients.title}</p>
                                {selected.recipients && selected.recipients.length > 0 ? (
                                    <>
                                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="bg-gray-50">
                                                        <th className="px-3 py-2 text-start font-semibold text-gray-500">{m.recipients.columnRecipient}</th>
                                                        <th className="px-3 py-2 text-start font-semibold text-gray-500 hidden md:table-cell">{m.recipients.columnSubject}</th>
                                                        <th className="px-3 py-2 text-start font-semibold text-gray-500">{m.recipients.columnStatus}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selected.recipients.map((r) => (
                                                        <tr key={r.id} className="border-t border-gray-100">
                                                            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">
                                                                {r.name ?? r.email}
                                                                <span className="block text-gray-400">{r.email}</span>
                                                            </td>
                                                            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate hidden md:table-cell">{r.subject}</td>
                                                            <td className="px-3 py-2">
                                                                <StatusBadge tone={recipientStatusTone[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
                                                                {r.error && <span className="block text-danger mt-0.5">{r.error}</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {(selected.progress?.total ?? 0) > selected.recipients.length && (
                                            <p className="text-xs text-gray-400 mt-1.5">
                                                {m.recipients.showingFirst
                                                    .replace('{shown}', String(selected.recipients.length))
                                                    .replace('{total}', String(selected.progress?.total ?? 0))}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-400">{m.recipients.none}</p>
                                )}
                            </div>
                        )}

                        {/* DRAFT as well as SCHEDULED: update() allows both, and
                            without DRAFT a draft could never be given a schedule
                            after it was created. */}
                        {['DRAFT', 'SCHEDULED'].includes(selected.status) && (
                            <Field label={m.schedule.label}>
                                <div className="flex gap-2">
                                    <Input
                                        type="datetime-local"
                                        value={rescheduleValue}
                                        onChange={(e) => setRescheduleValue(e.target.value)}
                                    />
                                    <Button variant="secondary" onClick={handleReschedule} loading={savingSchedule}>
                                        {m.schedule.reschedule}
                                    </Button>
                                </div>
                            </Field>
                        )}
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setSelected(null)}>
                            Close
                        </Button>
                        {['SCHEDULED', 'SENDING'].includes(selected.status) && (
                            <Button variant="secondary" onClick={handleCancel} loading={cancelling}>
                                {m.schedule.cancel}
                            </Button>
                        )}
                        {selected.status === 'DRAFT' && (
                            <Button onClick={handleSend} disabled={preview?.count === 0} loading={sending} icon={<Send className="w-4 h-4" />}>
                                {m.sendNow}
                            </Button>
                        )}
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
