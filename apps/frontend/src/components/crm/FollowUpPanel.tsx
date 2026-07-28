'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Plus, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export const FOLLOW_UP_TYPES = ['GENERAL', 'COLLECTION', 'BIRTHDAY', 'REORDER_REMINDER'] as const;

const followUpTypeColors: Record<string, string> = {
    GENERAL: 'bg-blue-50 text-blue-700',
    COLLECTION: 'bg-amber-50 text-amber-700',
    BIRTHDAY: 'bg-primary-light text-blue-700',
    REORDER_REMINDER: 'bg-primary-light text-blue-700',
};

const FOLLOW_UP_TYPE_KEYS: Record<string, 'general' | 'collection' | 'birthday' | 'reorderReminder'> = {
    GENERAL: 'general',
    COLLECTION: 'collection',
    BIRTHDAY: 'birthday',
    REORDER_REMINDER: 'reorderReminder',
};

type FollowUp = {
    id: string;
    type: string;
    title: string;
    due_at: string;
    status: string;
    notes: string | null;
};

type FollowUpPanelProps = {
    /** Exactly one of customerId / leadId must be set. */
    customerId?: string;
    leadId?: string;
};

/**
 * Create + list widget for CRM follow-ups against a single customer or lead.
 * Shared by the customer detail page and the lead detail page rather than
 * duplicated — the two previously-separate copies of this form were the reason
 * a lead could never get one created from the UI even though the backend has
 * always supported lead_id.
 */
export default function FollowUpPanel({ customerId, leadId }: Readonly<FollowUpPanelProps>) {
    const { t } = useI18n();
    const m = t.crmFollowUps;

    const [followUps, setFollowUps] = useState<FollowUp[]>([]);
    const [loading, setLoading] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [newFollowUp, setNewFollowUp] = useState({ type: 'GENERAL', title: '', due_at: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const [completingId, setCompletingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getCrmFollowUps(
                customerId ? { customerId } : { leadId },
            );
            setFollowUps(Array.isArray(data) ? data : []);
        } finally {
            setLoading(false);
        }
    }, [customerId, leadId]);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!newFollowUp.title.trim() || !newFollowUp.due_at) return;
        setSaving(true);
        try {
            await api.createCrmFollowUp({
                ...newFollowUp,
                ...(customerId ? { customer_id: customerId } : { lead_id: leadId }),
            });
            setNewFollowUp({ type: 'GENERAL', title: '', due_at: '', notes: '' });
            setShowForm(false);
            await load();
        } finally {
            setSaving(false);
        }
    };

    const complete = async (id: string) => {
        setCompletingId(id);
        try {
            await api.updateCrmFollowUp(id, { status: 'DONE' });
            await load();
        } finally {
            setCompletingId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setShowForm((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover min-h-touch"
                >
                    <Plus className="w-4 h-4" /> {m.panel.add}
                </button>
            </div>

            {showForm && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex gap-2 flex-wrap">
                        {FOLLOW_UP_TYPES.map((type) => (
                            <button
                                type="button"
                                key={type}
                                onClick={() => setNewFollowUp((n) => ({ ...n, type }))}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-touch ${
                                    newFollowUp.type === type ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                {m.types[FOLLOW_UP_TYPE_KEYS[type]]}
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        placeholder={m.panel.titlePlaceholder}
                        value={newFollowUp.title}
                        onChange={(e) => setNewFollowUp((n) => ({ ...n, title: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="flex gap-3">
                        <input
                            type="datetime-local"
                            value={newFollowUp.due_at}
                            onChange={(e) => setNewFollowUp((n) => ({ ...n, due_at: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                            type="text"
                            placeholder={m.panel.notesPlaceholder}
                            value={newFollowUp.notes}
                            onChange={(e) => setNewFollowUp((n) => ({ ...n, notes: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving || !newFollowUp.title.trim() || !newFollowUp.due_at}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 min-h-touch"
                        >
                            <Send className="w-4 h-4" /> {m.panel.save}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 min-h-touch"
                        >
                            {t.common.cancel}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="py-8 text-center text-gray-400 text-sm">{t.common.loading}</div>
            ) : followUps.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{m.panel.noFollowUps}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {followUps.map((followUp) => {
                        const overdue = new Date(followUp.due_at) < new Date() && followUp.status === 'PENDING';
                        return (
                            <div
                                key={followUp.id}
                                className={`flex items-start gap-3 bg-white border rounded-xl p-4 ${overdue ? 'border-red-200' : 'border-gray-100'} ${followUp.status === 'DONE' ? 'opacity-60' : ''}`}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${followUpTypeColors[followUp.type] ?? 'bg-gray-100 text-gray-600'}`}>
                                            {m.types[FOLLOW_UP_TYPE_KEYS[followUp.type]] ?? followUp.type}
                                        </span>
                                        {overdue && <AlertCircle className="w-3.5 h-3.5 text-danger" />}
                                    </div>
                                    <p className={`text-sm font-medium text-gray-800 ${followUp.status === 'DONE' ? 'line-through' : ''}`}>{followUp.title}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">{m.panel.due} {new Date(followUp.due_at).toLocaleString()}</p>
                                    {followUp.notes && <p className="text-xs text-gray-400">{followUp.notes}</p>}
                                </div>
                                {followUp.status === 'PENDING' && (
                                    <button
                                        type="button"
                                        onClick={() => complete(followUp.id)}
                                        disabled={completingId === followUp.id}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0 min-h-touch"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5" /> {m.markDone}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
