'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft, Phone, Mail, MessageSquare, Plus, UserCheck, Sparkles, Loader2,
    Pencil, ExternalLink, Calendar, Trash2, Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import {
    LeadFormFields,
    LEAD_CONVERSATION_TYPES,
    NextStepFields,
    emptyNextStep,
    leadFormToPayload,
    leadToFormState,
    nextStepFromLead,
    nextStepToPayload,
    validateLeadForm,
    type LeadFormState,
    type NextStepState,
} from '../lead-form-fields';

const typeIcons: Record<string, string> = {
    CALL: '📞', SMS: '💬', WHATSAPP: '🟢', EMAIL: '📧', VISIT: '🏪', ONLINE_MEETING: '💻', NOTE: '📝',
};

const priorityColors: Record<string, string> = {
    LOW: 'bg-slate-50 text-slate-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-rose-50 text-rose-700',
};

type NewConversationState = {
    type: string;
    summary: string;
    outcome: string;
} & NextStepState;

const emptyConversation = (): NewConversationState => ({
    type: 'CALL',
    summary: '',
    outcome: '',
    ...emptyNextStep(),
});

export default function LeadDetailPage() {
    const { id } = useParams();
    const leadId = id as string;
    const router = useRouter();
    const { t } = useI18n();
    const m = t.crm.leads;
    const convTypes = t.crm.leadConversations.types;

    const [lead, setLead] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [conversations, setConversations] = useState<any[]>([]);
    const [conversationsLoading, setConversationsLoading] = useState(false);
    const [showConvForm, setShowConvForm] = useState(false);
    const [showDraftPanel, setShowDraftPanel] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [newConv, setNewConv] = useState<NewConversationState>(emptyConversation);
    const [savingConv, setSavingConv] = useState(false);
    const [converting, setConverting] = useState(false);
    const [draftingMessage, setDraftingMessage] = useState(false);
    const [draftPurpose, setDraftPurpose] = useState('follow_up');
    const [draftChannel, setDraftChannel] = useState('WHATSAPP');
    const [editForm, setEditForm] = useState<LeadFormState | null>(null);
    const [savingLead, setSavingLead] = useState(false);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLead(leadId);
            setLead(data);
        } catch {
            setLead(null);
        } finally {
            setLoading(false);
        }
    }, [leadId]);

    const loadConversations = useCallback(async () => {
        setConversationsLoading(true);
        try {
            const data = await api.getLeadConversations({ leadId, limit: 50 });
            setConversations(data?.items ?? data ?? []);
        } finally {
            setConversationsLoading(false);
        }
    }, [leadId]);

    useEffect(() => { if (leadId) void loadLead(); }, [leadId, loadLead]);
    useEffect(() => { if (leadId) void loadConversations(); }, [leadId, loadConversations]);

    const refreshAll = async () => {
        await Promise.all([loadLead(), loadConversations()]);
    };

    const openConversationForm = () => {
        setNewConv({ ...emptyConversation(), ...nextStepFromLead(lead ?? {}) });
        setShowConvForm(true);
        setShowDraftPanel(false);
    };

    const saveConversation = async () => {
        if (!newConv.summary.trim()) return;
        setSavingConv(true);
        try {
            const payload: Record<string, string> = {
                lead_id: leadId,
                type: newConv.type,
                summary: newConv.summary.trim(),
                ...nextStepToPayload(newConv),
            };
            const outcome = newConv.outcome.trim();
            if (outcome) payload.outcome = outcome;
            await api.createLeadConversation(payload);
            setNewConv(emptyConversation());
            setShowConvForm(false);
            await refreshAll();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.detail.logConversation);
        } finally {
            setSavingConv(false);
        }
    };

    const convertLead = async () => {
        if (!confirm(m.convertConfirm)) return;
        setConverting(true);
        try {
            const result = await api.convertLead(leadId);
            router.push(routes.sales.customerDetail(result.customer.id));
        } catch (err: any) {
            const customerId = err?.customerId ?? err?.response?.customerId;
            if (customerId) {
                alert(m.customerExists);
                router.push(routes.sales.customerDetail(customerId));
            } else {
                alert(err instanceof Error ? err.message : m.convertFailed);
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
                customerContext: { name: lead.name, phone: lead.mobile ?? lead.phone, type: 'lead' },
            });
            setNewConv({
                ...emptyConversation(),
                summary: draft?.message ?? draft?.text ?? draft?.draft ?? '',
                ...nextStepFromLead(lead),
            });
            setShowDraftPanel(false);
            setShowConvForm(true);
        } finally {
            setDraftingMessage(false);
        }
    };

    const startEditing = () => {
        setEditForm(leadToFormState(lead));
        setShowEditForm(true);
    };

    const saveLead = async () => {
        if (!editForm) return;
        const validationError = validateLeadForm(editForm);
        if (validationError === 'INVALID_EMAIL') {
            alert(m.validation?.invalidEmail ?? 'Please enter a valid email address.');
            return;
        }
        if (validationError) return;
        setSavingLead(true);
        try {
            const updated = await api.updateLead(leadId, leadFormToPayload(editForm));
            setLead(updated);
            setShowEditForm(false);
            setEditForm(null);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.detail.saveFailed);
        } finally {
            setSavingLead(false);
        }
    };

    const removeLead = async () => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteLead(leadId);
            router.push(routes.crm.leads);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.deleteFailed);
        }
    };

    if (loading) {
        return <div className="p-8 font-black uppercase tracking-widest text-gray-400">{m.workspace.loading}</div>;
    }
    if (!lead) {
        return <div className="p-8 font-black text-rose-500 uppercase">{m.workspace.notFound}</div>;
    }

    const isConverted = lead.status === 'CONVERTED';
    const statusLabel = (m.statuses as Record<string, string>)[lead.status] ?? lead.status;
    const sourceLabel = (m.sources as Record<string, string>)[lead.source] ?? lead.source;
    const categoryLabel = lead.category ? ((m.categories as Record<string, string>)[lead.category] ?? lead.category) : null;
    const priorityLabel = (m.priorities as Record<string, string>)[lead.priority] ?? lead.priority;

    const socialLinks = [
        { label: m.fields.linkedinUrl, url: lead.linkedin_url },
        { label: m.fields.fbUrl, url: lead.fb_url },
        { label: m.fields.xUrl, url: lead.x_url },
        { label: m.fields.websiteUrl, url: lead.website_url },
    ].filter((l) => l.url);

    return (
        <div className="overflow-y-auto h-full p-8 bg-[#f9fafb] space-y-6">
            <Link href={routes.crm.leads} className="flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors w-fit">
                <ArrowLeft className="w-4 h-4 mr-2" /> {m.workspace.back}
            </Link>

            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                    <div className="w-20 h-20 bg-violet-600 rounded-2xl shadow-xl shadow-violet-500/20 flex items-center justify-center text-white font-black text-3xl uppercase shrink-0">
                        {lead.name.substring(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-3xl font-black tracking-tight">{lead.name}</h1>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700">{statusLabel}</span>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">{sourceLabel}</span>
                            {categoryLabel && (
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">{categoryLabel}</span>
                            )}
                            {lead.priority && (
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${priorityColors[lead.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                                    {priorityLabel}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                            <div className="flex items-center text-sm text-gray-600 font-medium">
                                <Phone className="w-4 h-4 mr-2 text-gray-400" /> {lead.mobile ?? lead.phone}
                            </div>
                            {lead.email && (
                                <div className="flex items-center text-sm text-gray-600 font-medium">
                                    <Mail className="w-4 h-4 mr-2 text-gray-400" /> {lead.email}
                                </div>
                            )}
                        </div>
                        {(lead.remarks ?? lead.notes) && (
                            <p className="text-sm text-gray-500 mt-4">{lead.remarks ?? lead.notes}</p>
                        )}
                        {socialLinks.length > 0 && (
                            <div className="flex flex-wrap gap-3 mt-3">
                                {socialLinks.map((link) => (
                                    <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold">
                                        <ExternalLink className="w-3 h-3" /> {link.label}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        {!isConverted && (
                            <button type="button" onClick={startEditing} className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-gray-50">
                                <Pencil className="w-4 h-4" /> {m.fields.editLead}
                            </button>
                        )}
                        <button type="button" onClick={removeLead} className="inline-flex items-center gap-2 px-4 py-2 border border-rose-200 text-rose-700 rounded-lg text-sm font-semibold hover:bg-rose-50">
                            <Trash2 className="w-4 h-4" /> {t.common.delete}
                        </button>
                        {isConverted && lead.convertedCustomer ? (
                            <Link href={routes.sales.customerDetail(lead.convertedCustomer.id)} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-semibold">
                                <UserCheck className="w-4 h-4" /> {m.viewCustomer}
                            </Link>
                        ) : (
                            <button type="button" onClick={convertLead} disabled={converting} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                                <UserCheck className="w-4 h-4" /> {m.convert}
                            </button>
                        )}
                    </div>
                </div>

                {(lead.next_step || lead.next_step_date || lead.nextStepAssignee) && (
                    <div className="mt-6 p-4 bg-violet-50 rounded-xl border border-violet-100">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-400 mb-2">{m.fields.nextStepSection}</p>
                        {lead.next_step && <p className="text-sm font-medium text-gray-800">{lead.next_step}</p>}
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-600 font-semibold">
                            {lead.next_step_date && (
                                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(lead.next_step_date)}</span>
                            )}
                            {lead.nextStepAssignee && <span>{m.fields.nextStepAssignedTo}: {lead.nextStepAssignee.name}</span>}
                        </div>
                    </div>
                )}
            </div>

            {showEditForm && editForm && !isConverted && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
                    <h2 className="text-lg font-bold text-gray-900">{m.fields.editLead}</h2>
                    <LeadFormFields form={editForm} onChange={setEditForm} teamMembers={teamMembers} />
                    <div className="flex gap-2 pt-2">
                        <button onClick={saveLead} disabled={savingLead} className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                            {savingLead ? <Loader2 className="w-4 h-4 animate-spin" /> : m.detail.saveLead}
                        </button>
                        <button onClick={() => { setShowEditForm(false); setEditForm(null); }} className="px-4 py-2 border text-sm rounded-lg">
                            {t.common.cancel}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-violet-600" />
                        <h2 className="text-sm font-bold text-gray-800">{m.detail.conversations}</h2>
                    </div>
                    {!isConverted && (
                        <div className="flex gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={() => { setShowDraftPanel((v) => !v); setShowConvForm(false); }}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                            >
                                <Sparkles className="w-4 h-4" /> AI Draft
                            </button>
                            <button
                                type="button"
                                onClick={() => (showConvForm ? setShowConvForm(false) : openConversationForm())}
                                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700"
                            >
                                <Plus className="w-4 h-4" /> {m.detail.logConversation}
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-6 space-y-4">
                    {showDraftPanel && !isConverted && (
                        <div className="bg-purple-50 rounded-xl p-4 space-y-3 border border-purple-200">
                            <p className="text-xs font-black uppercase tracking-widest text-purple-400">AI Message Drafter</p>
                            <div className="grid grid-cols-2 gap-3">
                                <select value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                                    {LEAD_CONVERSATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                                </select>
                                <select value={draftPurpose} onChange={(e) => setDraftPurpose(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                                    <option value="follow_up">Follow up</option>
                                    <option value="collection">Collection</option>
                                </select>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={draftMessage} disabled={draftingMessage} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                    {draftingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                    {draftingMessage ? 'Drafting…' : 'Generate draft'}
                                </button>
                                <button onClick={() => setShowDraftPanel(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white">
                                    {t.common.cancel}
                                </button>
                            </div>
                        </div>
                    )}

                    {showConvForm && !isConverted && (
                        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                            <select value={newConv.type} onChange={(e) => setNewConv({ ...newConv, type: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                                {LEAD_CONVERSATION_TYPES.map((type) => (
                                    <option key={type} value={type}>{(convTypes as Record<string, string>)[type] ?? type}</option>
                                ))}
                            </select>
                            <textarea
                                value={newConv.summary}
                                onChange={(e) => setNewConv({ ...newConv, summary: e.target.value })}
                                placeholder={m.detail.summaryPlaceholder}
                                className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none bg-white"
                                rows={4}
                            />
                            <input
                                value={newConv.outcome}
                                onChange={(e) => setNewConv({ ...newConv, outcome: e.target.value })}
                                placeholder={m.detail.outcomePlaceholder}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                            />
                            <NextStepFields state={newConv} onChange={(next) => setNewConv({ ...newConv, ...next })} teamMembers={teamMembers} />
                            <div className="flex gap-2">
                                <button onClick={saveConversation} disabled={savingConv || !newConv.summary.trim()} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                    <Send className="w-4 h-4" /> {m.detail.logConversation}
                                </button>
                                <button onClick={() => setShowConvForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white">
                                    {t.common.cancel}
                                </button>
                            </div>
                        </div>
                    )}

                    {conversationsLoading ? (
                        <div className="py-8 text-center text-gray-400 text-sm">{t.common.loading}</div>
                    ) : conversations.length === 0 ? (
                        <div className="py-12 text-center text-gray-400">
                            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">{m.detail.noConversations}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {conversations.map((conv) => (
                                <div key={conv.id} className="flex gap-3">
                                    <div className="text-xl mt-0.5">{typeIcons[conv.type] ?? '💬'}</div>
                                    <div className="flex-1 bg-white border border-gray-100 rounded-xl p-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                                {(convTypes as Record<string, string>)[conv.type] ?? conv.type}
                                            </span>
                                            <span className="text-xs text-gray-400">{formatDate(conv.created_at)}</span>
                                        </div>
                                        <p className="text-sm text-gray-800">{conv.summary}</p>
                                        {conv.outcome && (
                                            <p className="text-xs text-gray-500 mt-1">{m.workspace.outcome}: {conv.outcome}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}