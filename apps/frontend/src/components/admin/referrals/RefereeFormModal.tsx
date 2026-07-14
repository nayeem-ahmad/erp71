'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import type { RefereeRecord } from './types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

type Props = {
    open: boolean;
    mode: 'create' | 'edit';
    referee: RefereeRecord | null;
    onClose: () => void;
    onSaved: (message: string) => void;
};

export default function RefereeFormModal({ open, mode, referee, onClose, onSaved }: Props) {
    const { t } = useI18n();
    const m = t.admin.referrals.form;
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [commissionRate, setCommissionRate] = useState('10');
    const [signupDiscount, setSignupDiscount] = useState('10');
    const [referralCode, setReferralCode] = useState('');
    const [notes, setNotes] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(referee?.name ?? '');
        setEmail(referee?.email ?? '');
        setPhone(referee?.phone ?? '');
        setCommissionRate(String(referee?.commission_rate ?? 10));
        setSignupDiscount(String(referee?.signup_discount ?? 10));
        setReferralCode(referee?.referral_code ?? '');
        setNotes(referee?.notes ?? '');
        setIsActive(referee?.is_active ?? true);
        setError('');
    }, [open, referee]);

    if (!open) return null;

    const handleSave = async () => {
        const commission = parseFloat(commissionRate);
        const discount = parseFloat(signupDiscount);
        if (!name.trim() || !email.trim()) {
            setError(m.saveFailed);
            return;
        }
        if (Number.isNaN(commission) || commission < 0 || commission > 100) {
            setError(m.saveFailed);
            return;
        }
        if (Number.isNaN(discount) || discount < 0 || discount > 100) {
            setError(m.saveFailed);
            return;
        }
        if (mode === 'edit') {
            const code = referralCode.trim().toUpperCase();
            if (!/^[A-Z0-9]{4,20}$/.test(code)) {
                setError(m.codeInvalid);
                return;
            }
        }

        setSaving(true);
        setError('');
        try {
            if (mode === 'create') {
                await api.createAdminReferee({
                    name: name.trim(),
                    email: email.trim(),
                    phone: phone.trim() || undefined,
                    commission_rate: commission,
                    signup_discount: discount,
                    notes: notes.trim() || undefined,
                });
                onSaved(formatMessage(m.createdToast, { name: name.trim() }));
            } else if (referee) {
                await api.updateAdminReferee(referee.id, {
                    name: name.trim(),
                    email: email.trim(),
                    phone: phone.trim() || undefined,
                    referral_code: referralCode.trim().toUpperCase(),
                    commission_rate: commission,
                    signup_discount: discount,
                    notes: notes.trim() || undefined,
                    is_active: isActive,
                });
                onSaved(formatMessage(m.updatedToast, { name: name.trim() }));
            }
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={mode === 'create' ? m.createTitle : m.editTitle} onClose={onClose} />

            <div className="space-y-4 p-6 overflow-y-auto">
                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-medium text-gray-500">{m.nameLabel}</label>
                        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.emailLabel}</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.phoneLabel}</label>
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    {mode === 'edit' && (
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-medium text-gray-500">{m.codeLabel}</label>
                            <input
                                value={referralCode}
                                onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                maxLength={20}
                                className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 font-mono text-sm font-bold tracking-wider outline-none"
                            />
                            <p className="text-xs text-gray-500">{m.codeHint}</p>
                        </div>
                    )}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.commissionLabel}</label>
                        <input type="number" min={0} max={100} step="0.01" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.discountLabel}</label>
                        <input type="number" min={0} max={100} step="0.01" value={signupDiscount} onChange={(e) => setSignupDiscount(e.target.value)} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-medium text-gray-500">{m.notesLabel}</label>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    {mode === 'edit' && (
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 md:col-span-2">
                            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-gray-300" />
                            {m.activeLabel}
                        </label>
                    )}
                </div>
            </div>

            <ModalFooter>
                <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">
                    {m.cancel}
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {saving ? m.saving : m.save}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}