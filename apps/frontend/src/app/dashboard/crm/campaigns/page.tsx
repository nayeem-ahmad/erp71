'use client';

import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Plus, Send, Eye, Trash2, RefreshCw, Users, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';

interface Campaign {
    id: string;
    name: string;
    description: string | null;
    status: string;
    channel: string;
    target_segment: string | null;
    message: string;
    scheduled_at: string | null;
    sent_at: string | null;
    recipient_count: number;
    delivered_count: number;
    failed_count: number;
    created_at: string;
    creator: { name: string | null; email: string } | null;
}

const SEGMENTS = ['ALL', 'VIP', 'At-Risk', 'Regular', 'New'];
const CHANNELS = ['SMS', 'EMAIL'];

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
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Create modal state
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({
        name: '',
        description: '',
        channel: 'SMS',
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

    const handleCreate = async () => {
        if (!form.name.trim() || !form.message.trim()) return;
        setCreating(true);
        try {
            await api.createCrmCampaign({
                ...form,
                scheduled_at: form.scheduled_at || undefined,
                description: form.description || undefined,
            });
            showToast('Campaign created', 'success');
            setShowCreate(false);
            setForm({ name: '', description: '', channel: 'SMS', target_segment: 'ALL', message: '', scheduled_at: '' });
            await loadCampaigns();
        } catch {
            showToast('Failed to create campaign', 'error');
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
        if (!confirm(`Send "${selected.name}" to ${preview?.count ?? selected.recipient_count} recipients now?`)) return;
        setSending(true);
        try {
            const result = await api.sendCrmCampaign(selected.id);
            showToast(`Campaign queued for ${result.queued} recipients`, 'success');
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            showToast(err?.message ?? 'Failed to send', 'error');
        } finally {
            setSending(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this campaign?')) return;
        try {
            await api.deleteCrmCampaign(id);
            showToast('Campaign deleted', 'success');
            await loadCampaigns();
        } catch {
            showToast('Failed to delete', 'error');
        }
    };

    const charCount = form.message.length;
    const smsPages = Math.ceil(charCount / 160) || 0;

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {toast && <Toast {...toast} onClose={() => setToast(null)} />}

            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Megaphone className="w-6 h-6 text-violet-600" /> CRM Campaigns
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">Send bulk SMS to customer segments</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={loadCampaigns} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <RefreshCw className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700"
                    >
                        <Plus className="w-4 h-4" /> New Campaign
                    </button>
                </div>
            </div>

            {/* Campaign list */}
            {loading ? (
                <div className="py-16 text-center text-gray-400 font-medium uppercase tracking-widest text-sm">Loading...</div>
            ) : campaigns.length === 0 ? (
                <div className="py-20 text-center">
                    <Megaphone className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">No campaigns yet</p>
                    <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-violet-600 hover:underline">
                        Create your first campaign
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {campaigns.map((c) => (
                        <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 hover:border-gray-300 transition-colors">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                        {c.status}
                                    </span>
                                    <span className="text-xs text-gray-400 font-medium uppercase">{c.channel}</span>
                                    {c.target_segment && c.target_segment !== 'ALL' && (
                                        <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full font-medium">
                                            {c.target_segment}
                                        </span>
                                    )}
                                </div>
                                <h3 className="font-semibold text-gray-900">{c.name}</h3>
                                <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{c.message}</p>
                                <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {c.recipient_count} recipients</span>
                                    {c.status === 'COMPLETED' && (
                                        <>
                                            <span className="text-emerald-600 font-medium">{c.delivered_count} delivered</span>
                                            {c.failed_count > 0 && <span className="text-rose-500">{c.failed_count} failed</span>}
                                        </>
                                    )}
                                    <span>{formatDate(c.created_at)}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => handleSelect(c)}
                                    className="p-2 text-gray-400 hover:text-violet-600 rounded-lg hover:bg-violet-50"
                                    title="View / Send"
                                >
                                    <Eye className="w-4 h-4" />
                                </button>
                                {c.status === 'DRAFT' && (
                                    <button
                                        onClick={() => handleDelete(c.id)}
                                        className="p-2 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50"
                                        title="Delete"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
                        <h2 className="text-lg font-bold text-gray-900">New Campaign</h2>

                        <input
                            type="text"
                            placeholder="Campaign name *"
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

                        <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">Message *</label>
                            <textarea
                                placeholder="Your message text..."
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
                                disabled={creating || !form.name.trim() || !form.message.trim()}
                                className="flex-1 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                            >
                                {creating ? 'Creating...' : 'Create Campaign'}
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

                        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap">
                            {selected.message}
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><span className="text-gray-400">Channel:</span> <span className="font-medium">{selected.channel}</span></div>
                            <div><span className="text-gray-400">Segment:</span> <span className="font-medium">{selected.target_segment ?? 'ALL'}</span></div>
                            {selected.status === 'COMPLETED' && (
                                <>
                                    <div><span className="text-gray-400">Delivered:</span> <span className="font-medium text-emerald-600">{selected.delivered_count}</span></div>
                                    <div><span className="text-gray-400">Failed:</span> <span className={`font-medium ${selected.failed_count > 0 ? 'text-rose-500' : 'text-gray-600'}`}>{selected.failed_count}</span></div>
                                    <div><span className="text-gray-400">Sent at:</span> <span className="font-medium">{selected.sent_at ? formatDate(selected.sent_at) : '—'}</span></div>
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
                                    <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send Now'}
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
        </div>
    );
}
