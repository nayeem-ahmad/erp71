'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Phone, Mail, MessageSquare, Plus, Trash2, UserCheck,
    Sparkles, Loader2, CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const CONVERSATION_TYPES = ['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'VISIT', 'NOTE'] as const;
const typeIcons: Record<string, string> = {
    CALL: '📞', SMS: '💬', WHATSAPP: '🟢', EMAIL: '📧', VISIT: '🏪', NOTE: '📝',
};

export default function LeadDetailPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const convTypes = t.crm.leadConversations.types;
    const { id } = useParams();
    const router = useRouter();
    const [lead, setLead] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [conversations, setConversations] = useState<any[]>([]);
    const [conversationsLoading, setConversationsLoading] = useState(false);
    const [showConvForm, setShowConvForm] = useState(false);
    const [newConv, setNewConv] = useState({ type: 'CALL', summary: '', outcome: '' });
    const [savingConv, setSavingConv] = useState(false);
    const [converting, setConverting] = useState(false);
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [newTask, setNewTask] = useState({ type: 'FOLLOW_UP', title: '', due_at: '', notes: '' });
    const [savingTask, setSavingTask] = useState(false);
    const [draftingMessage, setDraftingMessage] = useState(false);
    const [draftPurpose, setDraftPurpose] = useState('follow_up');
    const [draftChannel, setDraftChannel] = useState('WHATSAPP');

    const loadLead = useCallback(async () => {
        try {
            const data = await api.getLead(id as string);
            setLead(data);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const loadConversations = useCallback(async () => {
        setConversationsLoading(true);
        try {
            const data = await api.getLeadConversations({ leadId: id as string, limit: 50 });
            setConversations(data?.items ?? data ?? []);
        } finally {
            setConversationsLoading(false);
        }
    }, [id]);

    useEffect(() => { if (id) void loadLead(); }, [id, loadLead]);
    useEffect(() => { if (id) void loadConversations(); }, [id, loadConversations]);

    const saveConversation = async () => {
        if (!newConv.summary.trim()) return;
        setSavingConv(true);
        try {
            await api.createLeadConversation({ ...newConv, lead_id: id });
            setNewConv({ type: 'CALL', summary: '', outcome: '' });
            setShowConvForm(false);
            await Promise.all([loadConversations(), loadLead()]);
        } finally {
            setSavingConv(false);
        }
    };

    const saveTask = async () => {
        if (!newTask.title.trim() || !newTask.due_at) return;
        setSavingTask(true);
        try {
            await api.createCrmTask({ ...newTask, lead_id: id });
            setNewTask({ type: 'FOLLOW_UP', title: '', due_at: '', notes: '' });
            setShowTaskForm(false);
        } finally {
            setSavingTask(false);
        }
    };

    const convertLead = async () => {
        if (!confirm(m.convertConfirm)) return;
        setConverting(true);
        try {
            const result = await api.convertLead(id as string);
            router.push(routes.sales.customerDetail(result.customer.id));
        } catch (err: any) {
            const customerId = err?.customerId ?? err?.response?.customerId;
            if (customerId) {
                alert(m.customerExists);
                router.push(routes.sales.customerDetail(customerId));
            } else {
                alert(m.convertFailed);
            }
        } finally {
            setConverting(false);
        }
    };

    const draftMessage = async () => {
        if (!lead) return;
        setDraftingMessage(true);
        try {
            const draft = await api.aiDraftMessage({
                channel: draftChannel,
                purpose: draftPurpose,
                customerContext: { name: lead.name, phone: lead.phone, type: 'lead' },
            });
            setNewConv((prev) => ({ ...prev, summary: draft?.message ?? draft?.text ?? draft?.draft ?? '' }));
            setShowConvForm(true);
        } finally {
            setDraftingMessage(false);
        }
    };

    if (loading) {
        return <div className="p-6 text-gray-400">Loading...</div>;
    }
    if (!lead) {
        return <div className="p-6 text-gray-500">Lead not found</div>;
    }

    const statusLabel = (m.statuses as Record<string, string>)[lead.status] ?? lead.status;
    const sourceLabel = (m.sources as Record<string, string>)[lead.source] ?? lead.source;
    const isConverted = lead.status === 'CONVERTED';

    return (
        <div className="p-6 w-full max-w-4xl">
            <Link href={routes.crm.leads} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4">
                <ArrowLeft className="w-4 h-4" /> {m.title}
            </Link>

            <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{lead.phone}</span>
                            {lead.email && <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{lead.email}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-50 text-violet-700">{statusLabel}</span>
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-700">{sourceLabel}</span>
                        </div>
                        {lead.notes && <p className="text-sm text-gray-500 mt-3">{lead.notes}</p>}
                    </div>
                    <div className="flex flex-col gap-2">
                        {isConverted && lead.convertedCustomer ? (
                            <Link href={routes.sales.customerDetail(lead.convertedCustomer.id)} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-semibold">
                                <UserCheck className="w-4 h-4" /> {m.viewCustomer}
                            </Link>
                        ) : (
                            <button onClick={convertLead} disabled={converting} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                                <UserCheck className="w-4 h-4" /> {m.convert}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" /> {m.detail.conversations}
                </h2>
                {!isConverted && (
                    <div className="flex items-center gap-2">
                        <button onClick={draftMessage} disabled={draftingMessage} className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50">
                            {draftingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            AI Draft
                        </button>
                        <button onClick={() => setShowTaskForm(!showTaskForm)} className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50">{m.detail.createTask}</button>
                        <button onClick={() => setShowConvForm(!showConvForm)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg">
                            <Plus className="w-3.5 h-3.5" /> {m.detail.logConversation}
                        </button>
                    </div>
                )}
            </div>

            {showTaskForm && !isConverted && (
                <div className="bg-white border rounded-xl p-4 mb-4 space-y-3">
                    <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="Task title" className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input type="datetime-local" value={newTask.due_at} onChange={(e) => setNewTask({ ...newTask, due_at: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <textarea value={newTask.notes} onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })} placeholder="Notes" className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
                    <button onClick={saveTask} disabled={savingTask} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">{m.detail.createTask}</button>
                </div>
            )}

            {showConvForm && !isConverted && (
                <div className="bg-white border rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex gap-2">
                        <select value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
                            {CONVERSATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                        <select value={draftPurpose} onChange={(e) => setDraftPurpose(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
                            <option value="follow_up">Follow up</option>
                            <option value="collection">Collection</option>
                        </select>
                    </div>
                    <select value={newConv.type} onChange={(e) => setNewConv({ ...newConv, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                        {CONVERSATION_TYPES.map((type) => (
                            <option key={type} value={type}>{(convTypes as Record<string, string>)[type] ?? type}</option>
                        ))}
                    </select>
                    <textarea value={newConv.summary} onChange={(e) => setNewConv({ ...newConv, summary: e.target.value })} placeholder="Summary" className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} />
                    <input value={newConv.outcome} onChange={(e) => setNewConv({ ...newConv, outcome: e.target.value })} placeholder="Outcome (optional)" className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <button onClick={saveConversation} disabled={savingConv} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg disabled:opacity-50">{m.detail.logConversation}</button>
                </div>
            )}

            {conversationsLoading ? (
                <div className="text-gray-400 text-sm py-8 text-center">Loading...</div>
            ) : conversations.length === 0 ? (
                <div className="text-gray-500 text-sm py-8 text-center">{m.detail.noConversations}</div>
            ) : (
                <div className="space-y-3">
                    {conversations.map((conv) => (
                        <div key={conv.id} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <span>{typeIcons[conv.type] ?? '💬'}</span>
                                <span className="text-xs font-semibold text-gray-700">{(convTypes as Record<string, string>)[conv.type] ?? conv.type}</span>
                                <span className="text-xs text-gray-400">{formatDate(conv.created_at)}</span>
                            </div>
                            <p className="text-sm text-gray-800">{conv.summary}</p>
                            {conv.outcome && <p className="text-xs text-gray-500 mt-1">Outcome: {conv.outcome}</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}