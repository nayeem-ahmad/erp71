'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import {
    ArrowLeft, Phone, Mail, ShoppingBag, CreditCard, MapPin, Building2,
    FolderTree, Map, ChevronLeft, ChevronRight, MessageSquare, Wallet,
    Plus, Trash2, CheckCircle2, Send, ClipboardList, AlertCircle, Sparkles, Loader2,
} from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';

type Tab = 'history' | 'interactions' | 'credit' | 'tasks';

const TASK_TYPES = ['FOLLOW_UP', 'COLLECTION', 'BIRTHDAY', 'REORDER_REMINDER'] as const;

const taskTypeColors: Record<string, string> = {
    FOLLOW_UP: 'bg-blue-50 text-blue-700', COLLECTION: 'bg-amber-50 text-amber-700',
    BIRTHDAY: 'bg-rose-50 text-rose-700', REORDER_REMINDER: 'bg-violet-50 text-violet-700',
};

const TASK_TYPE_KEYS: Record<string, 'followUp' | 'collection' | 'birthday' | 'reorderReminder'> = {
    FOLLOW_UP: 'followUp',
    COLLECTION: 'collection',
    BIRTHDAY: 'birthday',
    REORDER_REMINDER: 'reorderReminder',
};

const INTERACTION_TYPES = ['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'VISIT', 'NOTE'] as const;
const typeIcons: Record<string, string> = {
    CALL: '📞', SMS: '💬', WHATSAPP: '🟢', EMAIL: '📧', VISIT: '🏪', NOTE: '📝',
};

export default function CustomerProfile() {
    const { t } = useI18n();
    const { id } = useParams();
    const router = useRouter();
    const [customer, setCustomer] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('history');

    // Purchase history state
    const [history, setHistory] = useState<any>(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyLoading, setHistoryLoading] = useState(false);

    // Interactions state
    const [interactions, setInteractions] = useState<any[]>([]);
    const [interactionsLoading, setInteractionsLoading] = useState(false);
    const [showInteractionForm, setShowInteractionForm] = useState(false);
    const [newInteraction, setNewInteraction] = useState({ type: 'CALL', summary: '', outcome: '' });
    const [savingInteraction, setSavingInteraction] = useState(false);

    // AI message drafting state
    const [draftingMessage, setDraftingMessage] = useState(false);
    const [draftPurpose, setDraftPurpose] = useState('follow_up');
    const [draftChannel, setDraftChannel] = useState('WHATSAPP');
    const [showDraftPanel, setShowDraftPanel] = useState(false);

    // Tasks state
    const [tasks, setTasks] = useState<any[]>([]);
    const [tasksLoading, setTasksLoading] = useState(false);
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [newTask, setNewTask] = useState({ type: 'FOLLOW_UP', title: '', due_at: '', notes: '' });
    const [savingTask, setSavingTask] = useState(false);
    const [completingTask, setCompletingTask] = useState<string | null>(null);

    // Credit state
    const [creditLedger, setCreditLedger] = useState<any>(null);
    const [creditLoading, setCreditLoading] = useState(false);
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentNote, setPaymentNote] = useState('');
    const [savingPayment, setSavingPayment] = useState(false);

    useEffect(() => {
        if (id) void loadCustomer();
    }, [id]);

    useEffect(() => {
        if (id) void loadHistory(historyPage);
    }, [id, historyPage]);

    useEffect(() => {
        if (id && activeTab === 'interactions') void loadInteractions();
        if (id && activeTab === 'credit') void loadCredit();
        if (id && activeTab === 'tasks') void loadTasks();
    }, [id, activeTab]);

    const loadCustomer = async () => {
        try {
            const data = await api.getCustomer(id as string);
            setCustomer(data);
        } finally {
            setLoading(false);
        }
    };

    const loadHistory = useCallback(async (page: number) => {
        setHistoryLoading(true);
        try {
            const data = await api.getCustomerPurchaseHistory(id as string, { page, limit: 10 });
            setHistory(data);
        } finally {
            setHistoryLoading(false);
        }
    }, [id]);

    const loadInteractions = async () => {
        setInteractionsLoading(true);
        try {
            const data = await api.getCrmInteractions({ customerId: id as string, limit: 50 });
            setInteractions(data?.items ?? data ?? []);
        } finally {
            setInteractionsLoading(false);
        }
    };

    const loadTasks = async () => {
        setTasksLoading(true);
        try {
            const data = await api.getCrmTasks({ customerId: id as string, limit: 50 });
            setTasks(data?.items ?? data ?? []);
        } finally {
            setTasksLoading(false);
        }
    };

    const saveTask = async () => {
        if (!newTask.title.trim() || !newTask.due_at) return;
        setSavingTask(true);
        try {
            await api.createCrmTask({ ...newTask, customer_id: id });
            setNewTask({ type: 'FOLLOW_UP', title: '', due_at: '', notes: '' });
            setShowTaskForm(false);
            await loadTasks();
        } finally {
            setSavingTask(false);
        }
    };

    const completeTask = async (taskId: string) => {
        setCompletingTask(taskId);
        try {
            await api.updateCrmTask(taskId, { status: 'DONE' });
            await loadTasks();
        } finally {
            setCompletingTask(null);
        }
    };

    const loadCredit = async () => {
        setCreditLoading(true);
        try {
            const data = await api.getCustomerCreditLedger(id as string);
            setCreditLedger(data);
        } finally {
            setCreditLoading(false);
        }
    };

    const saveInteraction = async () => {
        if (!newInteraction.summary.trim()) return;
        setSavingInteraction(true);
        try {
            await api.createCrmInteraction({ ...newInteraction, customer_id: id });
            setNewInteraction({ type: 'CALL', summary: '', outcome: '' });
            setShowInteractionForm(false);
            await loadInteractions();
        } finally {
            setSavingInteraction(false);
        }
    };

    const deleteInteraction = async (interactionId: string) => {
        if (!confirm(t.customers.profile.deleteInteractionConfirm)) return;
        await api.deleteCrmInteraction(interactionId);
        await loadInteractions();
    };

    const handleDraftMessage = async () => {
        if (!customer) return;
        setDraftingMessage(true);
        try {
            const result = await api.aiDraftMessage({
                channel: draftChannel.toLowerCase(),
                purpose: draftPurpose,
                customerContext: {
                    name: customer.name,
                    phone: customer.phone,
                    total_spent: customer.total_spent,
                    due_balance: customer.due_balance,
                    segment: customer.segment_category,
                    last_contacted_at: customer.last_contacted_at,
                },
            });
            setNewInteraction((n) => ({ ...n, type: draftChannel as any, summary: result.draft }));
            setShowDraftPanel(false);
            setShowInteractionForm(true);
        } catch (err: any) {
            alert(err.message ?? 'AI drafting failed.');
        } finally {
            setDraftingMessage(false);
        }
    };

    const savePayment = async () => {
        const amt = parseFloat(paymentAmount);
        if (isNaN(amt) || amt <= 0) return;
        setSavingPayment(true);
        try {
            await api.recordCreditPayment(id as string, { amount: amt, notes: paymentNote });
            setPaymentAmount('');
            setPaymentNote('');
            setShowPaymentForm(false);
            await loadCredit();
            await loadCustomer();
        } finally {
            setSavingPayment(false);
        }
    };

    if (loading) return <div className="p-8 font-black uppercase tracking-widest text-gray-400">{t.customers.profile.loading}</div>;
    if (!customer) return <div className="p-8 font-black text-rose-500 uppercase">{t.customers.profile.notFound}</div>;

    const segmentClass =
        customer.segment_category === 'VIP' ? 'bg-emerald-50 text-emerald-600' :
        customer.segment_category === 'At-Risk' ? 'bg-rose-50 text-rose-600' :
        'bg-gray-100 text-gray-600';

    return (
        <div className="overflow-y-auto h-full p-8 bg-[#f9fafb] space-y-6">
            <button onClick={() => router.back()} className="flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2" /> {t.customers.profile.back}
            </button>

            {/* Profile Header */}
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex items-start space-x-6">
                <div className="w-20 h-20 bg-blue-600 rounded-2xl shadow-xl shadow-blue-500/20 flex items-center justify-center text-white font-black text-3xl uppercase overflow-hidden">
                    {customer.profile_pic_url
                        ? <img src={customer.profile_pic_url} alt={customer.name} className="w-full h-full object-cover" />
                        : customer.name.substring(0, 2)}
                </div>
                <div className="flex-1">
                    <div className="flex items-center flex-wrap gap-2">
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{customer.name}</h1>
                        <span className="font-mono text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">{customer.customer_code}</span>
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${customer.customer_type === 'ORGANIZATION' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                            {customer.customer_type || t.customers.profile.individual}
                        </span>
                        {customer.segment_category && (
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${segmentClass}`}>
                                {customer.segment_category}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                        <div className="flex items-center text-sm text-gray-600 font-medium"><Phone className="w-4 h-4 mr-2 text-gray-400" /> {customer.phone}</div>
                        {customer.email && <div className="flex items-center text-sm text-gray-600 font-medium"><Mail className="w-4 h-4 mr-2 text-gray-400" /> {customer.email}</div>}
                        {customer.address && <div className="flex items-center text-sm text-gray-600 font-medium"><MapPin className="w-4 h-4 mr-2 text-gray-400" /> {customer.address}</div>}
                    </div>
                </div>
                <div className="text-right shrink-0 space-y-2">
                    <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">{t.customers.profile.lifetimeValue}</p>
                        <p className="text-4xl font-black text-blue-600">{formatBDT(Number(customer.total_spent))}</p>
                        {history && (
                            <p className="text-xs text-gray-400 font-bold mt-1">{formatMessage(history.total !== 1 ? t.customers.profile.transactionsPlural : t.customers.profile.transactions, { count: history.total })}</p>
                        )}
                    </div>
                    {Number(customer.due_balance) > 0 && (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-0.5">{t.customers.profile.dueBalance}</p>
                            <p className="text-xl font-black text-rose-600">{formatBDT(Number(customer.due_balance))}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoCard label={t.customers.profile.customerGroup} value={customer.customerGroup?.name || '—'} icon={<FolderTree className="w-5 h-5 text-blue-600" />} />
                <InfoCard label={t.customers.profile.territory} value={customer.territory?.name || '—'} icon={<Map className="w-5 h-5 text-emerald-600" />} />
                <InfoCard label={t.customers.profile.creditLimit} value={customer.credit_limit ? `৳${Number(customer.credit_limit).toLocaleString()}` : '—'} icon={<CreditCard className="w-5 h-5 text-amber-600" />} />
                <InfoCard label={t.customers.profile.defaultDiscount} value={customer.default_discount_pct ? `${Number(customer.default_discount_pct)}%` : '—'} icon={<Building2 className="w-5 h-5 text-purple-600" />} />
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="border-b border-gray-100 flex">
                    {([
                        { key: 'history', label: t.customers.profile.tabs.history, icon: <ShoppingBag className="w-4 h-4" /> },
                        { key: 'interactions', label: t.customers.profile.tabs.interactions, icon: <MessageSquare className="w-4 h-4" /> },
                        { key: 'credit', label: t.customers.profile.tabs.credit, icon: <Wallet className="w-4 h-4" /> },
                        { key: 'tasks', label: t.customers.profile.tabs.tasks, icon: <ClipboardList className="w-4 h-4" /> },
                    ] as const).map(({ key, label, icon }) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 ${
                                activeTab === key
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {icon} {label}
                        </button>
                    ))}
                </div>

                {/* Tab: Purchase History */}
                {activeTab === 'history' && (
                    <div>
                        {historyLoading ? (
                            <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">{t.common.loading}</div>
                        ) : !history || history.data?.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">{t.customers.profile.noTransactions}</div>
                        ) : (
                            <>
                                <div className="divide-y divide-gray-50">
                                    {history.data.map((sale: any) => (
                                        <div key={sale.id} className="p-6 hover:bg-gray-50/50">
                                            <div className="flex justify-between items-start mb-4">
                                                <div>
                                                    <h3 className="font-black text-sm">{sale.serial_number}</h3>
                                                    <p className="text-xs text-gray-500 font-medium">{new Date(sale.created_at).toLocaleString()}</p>
                                                    {sale.payments?.length > 0 && (
                                                        <div className="flex gap-1 mt-1">
                                                            {sale.payments.map((p: any, i: number) => (
                                                                <span key={i} className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                                                                    {p.payment_method}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-black">{formatBDT(Number(sale.amount_paid))}</p>
                                                    <p className={`text-[10px] font-black uppercase tracking-widest ${sale.status === 'COMPLETED' ? 'text-emerald-500' : 'text-gray-400'}`}>{sale.status}</p>
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                                                {sale.items?.map((item: any) => (
                                                    <div key={item.id} className="flex justify-between text-sm">
                                                        <span className="font-medium text-gray-700">{item.quantity}x {item.product?.name || t.customers.profile.unknownItem}</span>
                                                        <span className="font-bold">{formatBDT(Number(item.price_at_sale) * item.quantity)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {history.totalPages > 1 && (
                                    <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                                        <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={history.page === 1} className="flex items-center gap-1 text-sm font-bold text-gray-600 disabled:opacity-40">
                                            <ChevronLeft className="w-4 h-4" /> {t.customers.profile.previous}
                                        </button>
                                        <span className="text-xs text-gray-400">{formatMessage(t.customers.profile.totalTransactions, { count: history.total })}</span>
                                        <button onClick={() => setHistoryPage((p) => Math.min(history.totalPages, p + 1))} disabled={history.page === history.totalPages} className="flex items-center gap-1 text-sm font-bold text-gray-600 disabled:opacity-40">
                                            {t.customers.profile.next} <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Tab: Interactions */}
                {activeTab === 'interactions' && (
                    <div className="p-6 space-y-4">
                        <div className="flex justify-end gap-2 flex-wrap">
                            <button
                                onClick={() => { setShowDraftPanel((v) => !v); setShowInteractionForm(false); }}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                            >
                                <Sparkles className="w-4 h-4" /> AI Draft
                            </button>
                            <button
                                onClick={() => { setShowInteractionForm((v) => !v); setShowDraftPanel(false); }}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                <Plus className="w-4 h-4" /> {t.customers.profile.logInteraction}
                            </button>
                        </div>

                        {showDraftPanel && (
                            <div className="bg-purple-50 rounded-xl p-4 space-y-3 border border-purple-200">
                                <p className="text-xs font-black uppercase tracking-widest text-purple-400">AI Message Drafter</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600 mb-1">Channel</label>
                                        <select
                                            value={draftChannel}
                                            onChange={(e) => setDraftChannel(e.target.value)}
                                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                                        >
                                            <option value="WHATSAPP">WhatsApp</option>
                                            <option value="SMS">SMS</option>
                                            <option value="EMAIL">Email</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600 mb-1">Purpose</label>
                                        <select
                                            value={draftPurpose}
                                            onChange={(e) => setDraftPurpose(e.target.value)}
                                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                                        >
                                            <option value="follow_up">Follow-up</option>
                                            <option value="payment_reminder">Payment reminder</option>
                                            <option value="promotion">Promotion</option>
                                            <option value="birthday">Birthday</option>
                                            <option value="reorder_reminder">Reorder reminder</option>
                                        </select>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    AI will draft a ready-to-send message using {customer?.name}&apos;s profile. The draft will pre-fill the interaction form below.
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleDraftMessage}
                                        disabled={draftingMessage}
                                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                    >
                                        {draftingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                        {draftingMessage ? 'Drafting…' : 'Generate draft'}
                                    </button>
                                    <button onClick={() => setShowDraftPanel(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {showInteractionForm && (
                            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                                <div className="flex gap-2 flex-wrap">
                                    {INTERACTION_TYPES.map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setNewInteraction((n) => ({ ...n, type: t }))}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                                newInteraction.type === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                            }`}
                                        >
                                            {typeIcons[t]} {t}
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    placeholder={t.customers.profile.summary}
                                    value={newInteraction.summary}
                                    onChange={(e) => setNewInteraction((n) => ({ ...n, summary: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none"
                                    rows={3}
                                />
                                <input
                                    type="text"
                                    placeholder={t.customers.profile.outcome}
                                    value={newInteraction.outcome}
                                    onChange={(e) => setNewInteraction((n) => ({ ...n, outcome: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={saveInteraction}
                                        disabled={savingInteraction || !newInteraction.summary.trim()}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                    >
                                        <Send className="w-4 h-4" /> Save
                                    </button>
                                    <button onClick={() => setShowInteractionForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {interactionsLoading ? (
                            <div className="py-8 text-center text-gray-400 text-sm">{t.common.loading}</div>
                        ) : interactions.length === 0 ? (
                            <div className="py-12 text-center text-gray-400">
                                <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">{t.customers.profile.noInteractions}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {interactions.map((interaction: any) => (
                                    <div key={interaction.id} className="flex gap-3 group">
                                        <div className="text-xl mt-0.5">{typeIcons[interaction.type] ?? '💬'}</div>
                                        <div className="flex-1 bg-white border border-gray-100 rounded-xl p-4">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{interaction.type}</span>
                                                    <span className="text-xs text-gray-400 ml-2">{interaction.direction}</span>
                                                    <p className="text-sm text-gray-800 mt-1">{interaction.summary}</p>
                                                    {interaction.outcome && (
                                                        <p className="text-xs text-gray-500 mt-1">→ {interaction.outcome}</p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => deleteInteraction(interaction.id)}
                                                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-500 transition-opacity ml-2"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                                                <span>{formatDate(interaction.created_at)}</span>
                                                {interaction.creator && <span>{t.customers.profile.by} {interaction.creator.name || interaction.creator.email}</span>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab: Credit / Due */}
                {activeTab === 'credit' && (
                    <div className="p-6 space-y-4">
                        {creditLoading ? (
                            <div className="py-8 text-center text-gray-400 text-sm">{t.common.loading}</div>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className={`rounded-xl p-4 border ${Number(creditLedger?.due_balance) > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                        <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">{t.customers.profile.dueBalance}</p>
                                        <p className={`text-2xl font-black ${Number(creditLedger?.due_balance) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {formatBDT(creditLedger?.due_balance ?? 0)}
                                        </p>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                                        <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">{t.customers.profile.creditLimit}</p>
                                        <p className="text-2xl font-black text-gray-700">
                                            {creditLedger?.credit_limit ? formatBDT(creditLedger.credit_limit) : '—'}
                                        </p>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-center">
                                        <div className="text-center">
                                            <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${creditLedger?.credit_enabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                                            <p className="text-xs font-bold text-gray-500">{creditLedger?.credit_enabled ? t.customers.profile.creditEnabled : t.customers.profile.creditDisabled}</p>
                                        </div>
                                    </div>
                                </div>

                                {Number(creditLedger?.due_balance) > 0 && (
                                    <div>
                                        {!showPaymentForm ? (
                                            <button
                                                onClick={() => setShowPaymentForm(true)}
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
                                            >
                                                <CheckCircle2 className="w-4 h-4" /> {t.customers.profile.recordPayment}
                                            </button>
                                        ) : (
                                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                                                <h3 className="font-bold text-sm text-gray-700">{t.customers.profile.recordPayment}</h3>
                                                <div className="flex gap-3">
                                                    <input
                                                        type="number"
                                                        placeholder={t.customers.profile.amountPlaceholder}
                                                        value={paymentAmount}
                                                        onChange={(e) => setPaymentAmount(e.target.value)}
                                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder={t.customers.profile.notesOptional}
                                                        value={paymentNote}
                                                        onChange={(e) => setPaymentNote(e.target.value)}
                                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={savePayment}
                                                        disabled={savingPayment || !paymentAmount}
                                                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                                    >
                                                        {t.customers.profile.confirmPayment}
                                                    </button>
                                                    <button onClick={() => setShowPaymentForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
                                                        {t.common.cancel}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Credit transaction history */}
                                {creditLedger?.items?.length > 0 ? (
                                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                                <tr>
                                                    <th className="text-left px-4 py-3">{t.customers.profile.creditColumns.date}</th>
                                                    <th className="text-left px-4 py-3">{t.customers.profile.creditColumns.type}</th>
                                                    <th className="text-right px-4 py-3">{t.customers.profile.creditColumns.amount}</th>
                                                    <th className="text-right px-4 py-3">{t.customers.profile.balanceAfter}</th>
                                                    <th className="text-left px-4 py-3">{t.customers.profile.creditColumns.notes}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {creditLedger.items.map((tx: any) => (
                                                    <tr key={tx.id} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 text-gray-500">{formatDate(tx.created_at)}</td>
                                                        <td className="px-4 py-3">
                                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                                tx.type === 'PAYMENT' ? 'bg-emerald-50 text-emerald-700' :
                                                                tx.type === 'CREDIT_SALE' ? 'bg-rose-50 text-rose-700' :
                                                                'bg-gray-100 text-gray-600'
                                                            }`}>{tx.type}</span>
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-bold ${tx.type === 'PAYMENT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {tx.type === 'PAYMENT' ? '-' : '+'}{formatBDT(Number(tx.amount))}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-700 font-medium">{formatBDT(Number(tx.balance_after))}</td>
                                                        <td className="px-4 py-3 text-gray-400">{tx.notes ?? '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-10 text-center text-gray-400">
                                        <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">{t.customers.profile.noCreditTransactions}</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Tab: Tasks */}
                {activeTab === 'tasks' && (
                    <div className="p-6 space-y-4">
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowTaskForm((v) => !v)}
                                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700"
                            >
                                <Plus className="w-4 h-4" /> {t.customers.profile.addTask}
                            </button>
                        </div>

                        {showTaskForm && (
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                                <div className="flex gap-2 flex-wrap">
                                    {TASK_TYPES.map((taskType) => (
                                        <button
                                            key={taskType}
                                            onClick={() => setNewTask((n) => ({ ...n, type: taskType }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                newTask.type === taskType ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                            }`}
                                        >
                                            {t.crmTasks.types[TASK_TYPE_KEYS[taskType]]}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    placeholder={t.customers.profile.taskTitle}
                                    value={newTask.title}
                                    onChange={(e) => setNewTask((n) => ({ ...n, title: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                />
                                <div className="flex gap-3">
                                    <input
                                        type="datetime-local"
                                        value={newTask.due_at}
                                        onChange={(e) => setNewTask((n) => ({ ...n, due_at: e.target.value }))}
                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                    />
                                    <input
                                        type="text"
                                        placeholder={t.customers.profile.notesOptional}
                                        value={newTask.notes}
                                        onChange={(e) => setNewTask((n) => ({ ...n, notes: e.target.value }))}
                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={saveTask}
                                        disabled={savingTask || !newTask.title.trim() || !newTask.due_at}
                                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                    >
                                        <Send className="w-4 h-4" /> {t.customers.profile.saveTask}
                                    </button>
                                    <button onClick={() => setShowTaskForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">{t.common.cancel}</button>
                                </div>
                            </div>
                        )}

                        {tasksLoading ? (
                            <div className="py-8 text-center text-gray-400 text-sm">{t.common.loading}</div>
                        ) : tasks.length === 0 ? (
                            <div className="py-12 text-center text-gray-400">
                                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">{t.customers.profile.noTasks}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {tasks.map((task: any) => {
                                    const overdue = new Date(task.due_at) < new Date() && task.status === 'PENDING';
                                    return (
                                        <div key={task.id} className={`flex items-start gap-3 bg-white border rounded-xl p-4 ${overdue ? 'border-rose-200' : 'border-gray-100'} ${task.status === 'DONE' ? 'opacity-60' : ''}`}>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${taskTypeColors[task.type] ?? 'bg-gray-100 text-gray-600'}`}>
                                                        {t.crmTasks.types[TASK_TYPE_KEYS[task.type]] ?? task.type}
                                                    </span>
                                                    {overdue && <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                                                </div>
                                                <p className={`text-sm font-medium text-gray-800 ${task.status === 'DONE' ? 'line-through' : ''}`}>{task.title}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">{t.customers.profile.due} {new Date(task.due_at).toLocaleString()}</p>
                                                {task.notes && <p className="text-xs text-gray-400">{task.notes}</p>}
                                            </div>
                                            {task.status === 'PENDING' && (
                                                <button
                                                    onClick={() => completeTask(task.id)}
                                                    disabled={completingTask === task.id}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0"
                                                >
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Done
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function InfoCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
    return (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">{icon}</div>
            <div>
                <p className="text-gray-500 font-bold text-[10px] uppercase tracking-widest">{label}</p>
                <h3 className="text-lg font-black tracking-tight">{value}</h3>
            </div>
        </div>
    );
}
