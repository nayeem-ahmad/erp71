'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Megaphone, Plus, Send, Eye, Trash2, RefreshCw, Users, CheckCircle2, XCircle, Clock, Search } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { DataTable } from '@/components/data-table';
import { PageShell, PageHeader, Button } from '@/components/ui/compact';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface Campaign {
    id: string;
    name: string;
    description: string | null;
    status: string;
    channel: string;
    subject: string | null;
    target_segment: string | null;
    message: string;
    scheduled_at: string | null;
    sent_at: string | null;
    recipient_count: number;
    delivered_count: number;
    failed_count: number;
    attributed_revenue: number | null;
    attributed_orders: number | null;
    created_at: string;
    creator: { name: string | null; email: string } | null;
}

const SEGMENTS = ['ALL', 'VIP', 'At-Risk', 'Regular', 'New'];
const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];
const STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED'];

const columnHelper = createColumnHelper<Campaign>();

const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    SCHEDULED: 'bg-blue-50 text-blue-700',
    SENDING: 'bg-amber-50 text-amber-700',
    COMPLETED: 'bg-emerald-50 text-emerald-700',
    CANCELLED: 'bg-rose-50 text-rose-700',
};

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
            {type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {message}
        </div>
    );
}

export default function CrmCampaignsPage() {
    const { t } = useI18n();
    const m = t.crmCampaigns;
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [channelFilter, setChannelFilter] = useState('');

    // Create modal state
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({
        name: '',
        description: '',
        channel: 'SMS',
        subject: '',
        target_segment: 'ALL',
        message: '',
        scheduled_at: '',
    });

    // Detail/send modal state
    const [selected, setSelected] = useState<Campaign | null>(null);
    const [preview, setPreview] = useState<{ count: number; sample: any[] } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [sending, setSending] = useState(false);

    const loadCampaigns = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getCrmCampaigns({ limit: 50 });
            setCampaigns(data?.items ?? data ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

    const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

    const isEmail = form.channel === 'EMAIL';
    const canSubmit = form.name.trim() && form.message.trim() && (!isEmail || form.subject.trim());

    const handleCreate = async () => {
        if (!canSubmit) return;
        setCreating(true);
        try {
            await api.createCrmCampaign({
                ...form,
                subject: isEmail ? form.subject : undefined,
                scheduled_at: form.scheduled_at || undefined,
                description: form.description || undefined,
            });
            showToast(m.created, 'success');
            setShowCreate(false);
            setForm({ name: '', description: '', channel: 'SMS', subject: '', target_segment: 'ALL', message: '', scheduled_at: '' });
            await loadCampaigns();
        } catch (err: any) {
            showToast(err?.message ?? m.createFailed, 'error');
        } finally {
            setCreating(false);
        }
    };

    const handleSelect = async (campaign: Campaign) => {
        setSelected(campaign);
        setPreview(null);
        if (campaign.status === 'DRAFT') {
            setPreviewLoading(true);
            try {
                const data = await api.previewCampaignRecipients(campaign.id);
                setPreview(data);
            } finally {
                setPreviewLoading(false);
            }
        }
    };

    const handleSend = async () => {
        if (!selected) return;
        const count = preview?.count ?? selected.recipient_count;
        if (!confirm(m.sendConfirm.replace('{name}', selected.name).replace('{count}', String(count)))) return;
        setSending(true);
        try {
            const result = await api.sendCrmCampaign(selected.id);
            showToast(`Campaign queued for ${result.queued} recipients`, 'success');
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            showToast(err?.message ?? m.sendFailed, 'error');
        } finally {
            setSending(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteCrmCampaign(id);
            showToast(m.deleted, 'success');
            await loadCampaigns();
        } catch {
            showToast(m.deleteFailed, 'error');
        }
    };

    const charCount = form.message.length;
    const smsPages = Math.ceil(charCount / 160) || 0;

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return campaigns.filter((c) => {
            if (statusFilter && c.status !== statusFilter) return false;
            if (channelFilter && c.channel !== channelFilter) return false;
            if (q && !(`${c.name} ${c.subject ?? ''} ${c.message}`.toLowerCase().includes(q))) return false;
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
                                className="font-semibold text-gray-900 hover:text-violet-600 truncate text-left"
                            >
                                {c.name}
                            </button>
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{c.channel}</span>
                        </div>
                        {c.channel === 'EMAIL' && c.subject && (
                            <p className="text-xs text-gray-600 font-medium truncate">{c.subject}</p>
                        )}
                        <p className="text-xs text-gray-400 truncate">{c.message}</p>
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
                                {c.failed_count > 0 && <span className="text-rose-500 ml-2">{c.failed_count} failed</span>}
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
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {status}
                    </span>
                );
            },
        }),
        columnHelper.accessor('created_at', {
            header: m.columns.created,
            cell: (info) => <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>,
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => {
                const c = info.row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <button
                            onClick={() => void handleSelect(c)}
                            className="p-1.5 text-gray-400 hover:text-violet-600 rounded-lg hover:bg-violet-50"
                            title={m.viewSend}
                        >
                            <Eye className="w-4 h-4" />
                        </button>
                        {c.status === 'DRAFT' && (
                            <button
                                onClick={() => void handleDelete(c.id)}
                                className="p-1.5 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50"
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
    ], [m, t.common]);

    return (
        <PageShell>
            {toast && <Toast {...toast} onClose={() => setToast(null)} />}

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
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allStatuses}</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allChannels}</option>
                    {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                </select>
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
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
                        <h2 className="text-lg font-bold text-gray-900">{m.newCampaign}</h2>

                        <input
                            type="text"
                            placeholder={m.placeholders.name}
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Channel</label>
                                <select
                                    value={form.channel}
                                    onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                >
                                    {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Target Segment</label>
                                <select
                                    value={form.target_segment}
                                    onChange={(e) => setForm((f) => ({ ...f, target_segment: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                >
                                    {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>

                        {isEmail && (
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">{m.subjectLabel}</label>
                                <input
                                    type="text"
                                    placeholder={m.placeholders.subject}
                                    value={form.subject}
                                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">Message *</label>
                            <textarea
                                placeholder={m.placeholders.message}
                                value={form.message}
                                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none"
                                rows={4}
                            />
                            {form.channel === 'SMS' && (
                                <p className="text-xs text-gray-400 mt-1">
                                    {charCount} chars · {smsPages} SMS page{smsPages !== 1 ? 's' : ''}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">Schedule (optional)</label>
                            <input
                                type="datetime-local"
                                value={form.scheduled_at}
                                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={handleCreate}
                                disabled={creating || !canSubmit}
                                className="flex-1 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                            >
                                {creating ? m.creating : m.createCampaign}
                            </button>
                            <button
                                onClick={() => setShowCreate(false)}
                                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Detail / Send modal */}
            {selected && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[selected.status]}`}>
                                    {selected.status}
                                </span>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                        </div>

                        {selected.channel === 'EMAIL' && selected.subject && (
                            <div className="text-sm">
                                <span className="text-gray-400">{m.subjectLabel}</span> <span className="font-medium text-gray-900">{selected.subject}</span>
                            </div>
                        )}

                        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap">
                            {selected.message}
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><span className="text-gray-400">Channel:</span> <span className="font-medium">{selected.channel}</span></div>
                            <div><span className="text-gray-400">{m.segmentLabel}</span> <span className="font-medium">{selected.target_segment ?? 'ALL'}</span></div>
                            {selected.status === 'COMPLETED' && (
                                <>
                                    <div><span className="text-gray-400">Delivered:</span> <span className="font-medium text-emerald-600">{selected.delivered_count}</span></div>
                                    <div><span className="text-gray-400">Failed:</span> <span className={`font-medium ${selected.failed_count > 0 ? 'text-rose-500' : 'text-gray-600'}`}>{selected.failed_count}</span></div>
                                    <div><span className="text-gray-400">Sent at:</span> <span className="font-medium">{selected.sent_at ? formatDate(selected.sent_at) : '—'}</span></div>
                                    {(selected.attributed_orders ?? 0) > 0 && (
                                        <>
                                            <div><span className="text-gray-400">Attributed sales:</span> <span className="font-medium text-violet-600">{selected.attributed_orders}</span></div>
                                            <div><span className="text-gray-400">Attributed revenue:</span> <span className="font-medium text-violet-600">৳{Number(selected.attributed_revenue ?? 0).toLocaleString()}</span></div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        {selected.status === 'DRAFT' && (
                            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                                {previewLoading ? (
                                    <div className="flex items-center gap-2 text-violet-600 text-sm">
                                        <Clock className="w-4 h-4 animate-spin" /> Loading recipients...
                                    </div>
                                ) : preview ? (
                                    <div>
                                        <p className="text-sm font-bold text-violet-700 mb-2">
                                            <Users className="w-4 h-4 inline mr-1" />{preview.count} recipient{preview.count !== 1 ? 's' : ''} will receive this message
                                        </p>
                                        {preview.sample.length > 0 && (
                                            <div className="space-y-1">
                                                {preview.sample.slice(0, 5).map((c: any) => (
                                                    <div key={c.id} className="text-xs text-violet-600">{c.name} · {c.phone}</div>
                                                ))}
                                                {preview.count > 5 && <div className="text-xs text-violet-400">+{preview.count - 5} more</div>}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}

                        {selected.status === 'DRAFT' && (
                            <div className="flex gap-3">
                                <button
                                    onClick={handleSend}
                                    disabled={sending || (preview?.count === 0)}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                                >
                                    <Send className="w-4 h-4" /> {sending ? m.sending : m.sendNow}
                                </button>
                                <button onClick={() => setSelected(null)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600">
                                    Close
                                </button>
                            </div>
                        )}
                        {selected.status !== 'DRAFT' && (
                            <button onClick={() => setSelected(null)} className="w-full py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600">
                                Close
                            </button>
                        )}
                    </div>
                </div>
            )}
        </PageShell>
    );
}
