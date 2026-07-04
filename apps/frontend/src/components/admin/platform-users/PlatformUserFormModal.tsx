'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import PhoneNumberField from '@/components/PhoneNumberField';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_MOBILE_COUNTRY_CODE, getMobileCountryOption } from '@erp71/shared-types';

function nationalMobileFromE164(e164: string | null | undefined, countryCode: string): string {
    if (!e164) return '';
    const country = getMobileCountryOption(countryCode);
    if (country && e164.startsWith(country.dial)) {
        return e164.slice(country.dial.length);
    }
    return e164.replace(/^\+\d+/, '');
}

export type PlatformAdminUser = {
    id: string;
    email: string;
    name: string | null;
    mobile: string | null;
    mobile_country_code: string;
};

type Props = {
    open: boolean;
    mode: 'create' | 'edit';
    user: PlatformAdminUser | null;
    onClose: () => void;
    onSaved: () => void;
};

export default function PlatformUserFormModal({ open, mode, user, onClose, onSaved }: Props) {
    const { t } = useI18n();
    const m = t.admin.users.form;
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [mobileCountryCode, setMobileCountryCode] = useState(DEFAULT_MOBILE_COUNTRY_CODE);
    const [mobile, setMobile] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setEmail(user?.email ?? '');
        setName(user?.name ?? '');
        setPassword('');
        setMobileCountryCode(user?.mobile_country_code ?? DEFAULT_MOBILE_COUNTRY_CODE);
        setMobile(nationalMobileFromE164(user?.mobile, user?.mobile_country_code ?? DEFAULT_MOBILE_COUNTRY_CODE));
        setError('');
    }, [open, user]);

    if (!open) return null;

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            if (mode === 'create') {
                await api.createPlatformAdminUser({
                    email,
                    name: name || undefined,
                    password,
                    mobile: mobile || undefined,
                    mobile_country_code: mobileCountryCode,
                });
            } else if (user) {
                await api.updatePlatformAdminUser(user.id, {
                    email,
                    name: name || undefined,
                    mobile,
                    mobile_country_code: mobileCountryCode,
                });
            }
            onSaved();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-lg rounded-3xl bg-white shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
                    <h2 className="text-lg font-black tracking-tight">
                        {mode === 'create' ? m.createTitle : m.editTitle}
                    </h2>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.emailLabel}</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.nameLabel}</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                        />
                    </div>

                    {mode === 'create' && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-500">{m.passwordLabel}</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                minLength={8}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                    )}

                    <PhoneNumberField
                        countryCode={mobileCountryCode}
                        mobile={mobile}
                        onCountryCodeChange={setMobileCountryCode}
                        onMobileChange={setMobile}
                        countryLabel={m.countryLabel}
                        mobileLabel={m.mobileLabel}
                        mobilePlaceholder={m.mobilePlaceholder}
                        idPrefix="platform-user"
                    />
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-2xl bg-gray-100 px-5 py-2.5 text-sm font-black text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    >
                        {m.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-60"
                    >
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {m.saving}</> : m.save}
                    </button>
                </div>
            </div>
        </div>
    );
}