'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Phone, Mail, MessageSquare, Plus, UserCheck, Sparkles, Loader2,
    Pencil, X, ExternalLink, Calendar, Trash2,
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
} from './lead-form-fields';

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

type LeadWorkspaceDialogProps = {
    leadId: string;
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
    teamMembers: any[];
};

export function LeadWorkspaceDialog({
    leadId,
    onClose,
    onChanged,
    onDeleted,
    teamMembers,
}: LeadWorkspaceDialogProps) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const convTypes = t.crm.leadConversations.types;
    const router = useRouter();

    const [lead, setLead] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [conversations, setConversations] = useState<any[]>([]);
    const [conversationsLoading, setConversationsLoading] = useState(false);
    const [showConvDialog, setShowConvDialog] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [newConv, setNewConv] = useState<NewConversationState>(emptyConversation);
    const [savingConv, setSavingConv] = useState(false);
    const [converting, setConverting] = useState(false);
    const [draftingMessage, setDraftingMessage] = useState(false);
    const [draftPurpose, setDraftPurpose] = useState('follow_up');
    const [draftChannel, setDraftChannel] = useState('WHATSAPP');
    const [editForm, setEditForm] = useState<LeadFormState | null>(null);
    const [savingLead, setSavingLead] = useState(false);

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLead(leadId);
            setLead(data);
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

    useEffect(() => { void loadLead(); }, [loadLead]);
    useEffect(() => { void loadConversations(); }, [loadConversations]);

    const refreshAll = async () => {
        await Promise.all([loadLead(), loadConversations()]);
        onChanged();
    };

    const openConversationDialog = () => {
        setNewConv({ ...emptyConversation(), ...nextStepFromLead(lead ?? {}) });
        setShowConvDialog(true);
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
            setShowConvDialog(false);
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
            setShowConvDialog(true);
        } finally {
            setDraftingMessage(false);
        }
    };

    const openEditDialog = () => {
        setEditForm(leadToFormState(lead));
        setShowEditDialog(true);
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
            setShowEditDialog(false);
            setEditForm(null);
            onChanged();
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
            onDeleted();
            onClose();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.deleteFailed);
        }
    };

    const isConverted = lead?.status === 'CONVERTED';

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 shrink-0">
                        <h2 className="text-lg font-bold text-gray-900 truncate">
                            {loading ? m.workspace.loading : (lead?.name ?? m.title)}
                        </h2>
                        <div className="flex items-center gap-2 shrink-0">
                            {!loading && lead && !isConverted && (
                                <>
                                    <button
                                        type="button"
                                        onClick={draftMessage}
                                        disabled={draftingMessage}
                                        className="hidden sm:flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50"
                                    >
                                        {draftingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        AI Draft
                                    </button>
                                    <button
                                        type="button"
                                        onClick={openConversationDialog}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg font-semibold"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> {m.detail.logConversation}
                                    </button>
                                </>
                            )}
                            <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400">{t.common.loading}</div>
                    ) : !lead ? (
                        <div className="flex-1 flex items-center justify-center text-gray-500">{m.workspace.notFound}</div>
                    ) : (
                        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
                            <div className="lg:w-[42%] border-b lg:border-b-0 lg:border-r border-gray-200 overflow-y-auto p-5">
                                <LeadInfoPanel
                                    lead={lead}
                                    m={m}
                                    t={t}
                                    isConverted={isConverted}
                                    onEdit={openEditDialog}
                                    onDelete={removeLead}
                                    onConvert={convertLead}
                                    converting={converting}
                                />
                            </div>

                            <div className="lg:w-[58%] flex flex-col min-h-0 flex-1">
                                <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
                                    <MessageSquare className="w-4 h-4 text-gray-500" />
                                    <span className="text-sm font-semibold text-gray-800">{m.detail.conversations}</span>
                                </div>

                                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                                    {conversationsLoading ? (
                                        <div className="text-gray-400 text-sm text-center py-8">{t.common.loading}</div>
                                    ) : conversations.length === 0 ? (
                                        <div className="text-gray-500 text-sm text-center py-8">{m.detail.noConversations}</div>
                                    ) : (
                                        conversations.map((conv) => (
                                            <div key={conv.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span>{typeIcons[conv.type] ?? '💬'}</span>
                                                    <span className="text-xs font-semibold text-gray-700">{(convTypes as Record<string, string>)[conv.type] ?? conv.type}</span>
                                                    <span className="text-xs text-gray-400">{formatDate(conv.created_at)}</span>
                                                </div>
                                                <p className="text-sm text-gray-800">{conv.summary}</p>
                                                {conv.outcome && <p className="text-xs text-gray-500 mt-1">{m.workspace.outcome}: {conv.outcome}</p>}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {showConvDialog && !isConverted && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 shrink-0">
                            <h3 className="text-base font-bold text-gray-900">{m.detail.logConversation}</h3>
                            <button
                                type="button"
                                onClick={() => setShowConvDialog(false)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="overflow-y-auto p-5 space-y-3">
                            <div className="flex gap-2">
                                <select value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)} className="border rounded-lg px-2 py-1 text-xs bg-white">
                                    {LEAD_CONVERSATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                                </select>
                                <select value={draftPurpose} onChange={(e) => setDraftPurpose(e.target.value)} className="border rounded-lg px-2 py-1 text-xs bg-white">
                                    <option value="follow_up">Follow up</option>
                                    <option value="collection">Collection</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={draftMessage}
                                    disabled={draftingMessage}
                                    className="flex items-center gap-1 px-2 py-1 text-xs border rounded-lg hover:bg-gray-50 ml-auto"
                                >
                                    {draftingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                    AI Draft
                                </button>
                            </div>
                            <select value={newConv.type} onChange={(e) => setNewConv({ ...newConv, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                                {LEAD_CONVERSATION_TYPES.map((type) => (
                                    <option key={type} value={type}>{(convTypes as Record<string, string>)[type] ?? type}</option>
                                ))}
                            </select>
                            <textarea value={newConv.summary} onChange={(e) => setNewConv({ ...newConv, summary: e.target.value })} placeholder={m.detail.summaryPlaceholder} className="w-full border rounded-lg px-3 py-2 text-sm bg-white" rows={4} />
                            <input value={newConv.outcome} onChange={(e) => setNewConv({ ...newConv, outcome: e.target.value })} placeholder={m.detail.outcomePlaceholder} className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                            <NextStepFields state={newConv} onChange={(next) => setNewConv({ ...newConv, ...next })} teamMembers={teamMembers} />
                        </div>
                        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
                            <button onClick={saveConversation} disabled={savingConv} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg disabled:opacity-50">
                                {m.detail.logConversation}
                            </button>
                            <button onClick={() => setShowConvDialog(false)} className="px-4 py-2 border text-sm rounded-lg bg-white">
                                {t.common.cancel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditDialog && editForm && !isConverted && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 my-8">
                        <div className="flex items-center justify-between gap-4">
                            <h3 className="text-base font-bold text-gray-900">{m.fields.editLead}</h3>
                            <button
                                type="button"
                                onClick={() => { setShowEditDialog(false); setEditForm(null); }}
                                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <LeadFormFields form={editForm} onChange={setEditForm} teamMembers={teamMembers} />
                        <div className="flex gap-2 pt-2">
                            <button onClick={saveLead} disabled={savingLead} className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                                {savingLead ? <Loader2 className="w-4 h-4 animate-spin" /> : m.detail.saveLead}
                            </button>
                            <button onClick={() => { setShowEditDialog(false); setEditForm(null); }} className="px-4 py-2 border text-sm rounded-lg">
                                {t.common.cancel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function LeadInfoPanel({
    lead, m, t, isConverted, onEdit, onDelete, onConvert, converting,
}: {
    lead: any;
    m: any;
    t: any;
    isConverted: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onConvert: () => void;
    converting: boolean;
}) {
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
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{lead.mobile ?? lead.phone}</span>
                {lead.email && <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{lead.email}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-50 text-violet-700">{statusLabel}</span>
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-700">{sourceLabel}</span>
                {categoryLabel && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">{categoryLabel}</span>}
                {lead.priority && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${priorityColors[lead.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                        {priorityLabel}
                    </span>
                )}
            </div>
            {(lead.remarks ?? lead.notes) && <p className="text-sm text-gray-500">{lead.remarks ?? lead.notes}</p>}
            {socialLinks.length > 0 && (
                <div className="flex flex-wrap gap-3">
                    {socialLinks.map((link) => (
                        <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                            <ExternalLink className="w-3 h-3" /> {link.label}
                        </a>
                    ))}
                </div>
            )}
            {(lead.next_step || lead.next_step_date || lead.nextStepAssignee) && (
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">{m.fields.nextStepSection}</p>
                    {lead.next_step && <p className="text-sm text-gray-800">{lead.next_step}</p>}
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                        {lead.next_step_date && (
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(lead.next_step_date)}</span>
                        )}
                        {lead.nextStepAssignee && <span>{m.fields.nextStepAssignedTo}: {lead.nextStepAssignee.name}</span>}
                    </div>
                </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
                {!isConverted && (
                    <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-semibold hover:bg-gray-50">
                        <Pencil className="w-4 h-4" /> {m.fields.editLead}
                    </button>
                )}
                <button type="button" onClick={onDelete} className="inline-flex items-center gap-2 px-3 py-2 border border-rose-200 text-rose-700 rounded-lg text-sm font-semibold hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" /> {t.common.delete}
                </button>
                {isConverted && lead.convertedCustomer ? (
                    <Link href={routes.sales.customerDetail(lead.convertedCustomer.id)} className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-semibold">
                        <UserCheck className="w-4 h-4" /> {m.viewCustomer}
                    </Link>
                ) : (
                    <button type="button" onClick={onConvert} disabled={converting} className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                        <UserCheck className="w-4 h-4" /> {m.convert}
                    </button>
                )}
            </div>
        </div>
    );
}