'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, ArrowLeft, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type SslSettings = { store_id: string; store_password: string; is_sandbox: string };
type BkashSettings = { app_key: string; app_secret: string; username: string; password: string; is_sandbox: string };
type NagadSettings = { merchant_id: string; merchant_private_key: string; merchant_public_key: string; is_sandbox: string };

const SSL_DEFAULTS: SslSettings = { store_id: '', store_password: '', is_sandbox: 'true' };
const BKASH_DEFAULTS: BkashSettings = { app_key: '', app_secret: '', username: '', password: '', is_sandbox: 'true' };
const NAGAD_DEFAULTS: NagadSettings = { merchant_id: '', merchant_private_key: '', merchant_public_key: '', is_sandbox: 'true' };

type Toast = { type: 'success' | 'error'; message: string } | null;

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);
    if (!toast) return null;
    const isOk = toast.type === 'success';
    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${isOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {isOk ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {toast.message}
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
            {children}
            {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
    );
}

function SandboxToggle({
    value, onChange, onLabel, offLabel,
}: {
    value: string;
    onChange: (v: string) => void;
    onLabel: string;
    offLabel: string;
}) {
    const on = value === 'true';
    return (
        <div className="flex items-center gap-3">
            <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onChange(on ? 'false' : 'true')}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${on ? 'bg-amber-500' : 'bg-gray-200'}`}
            >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-gray-600">{on ? onLabel : offLabel}</span>
        </div>
    );
}

function GatewayCard({
    title,
    subtitle,
    saving,
    onSave,
    saveLabel,
    savingLabel,
    children,
}: {
    title: string;
    subtitle: string;
    saving: boolean;
    onSave: () => void;
    saveLabel: string;
    savingLabel: string;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div>
                <h2 className="text-base font-black text-gray-800">{title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
            </div>
            <hr className="border-gray-100" />
            {children}
            <div className="pt-1">
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? savingLabel : saveLabel}
                </button>
            </div>
        </div>
    );
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

export default function PlatformPaymentsSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.payments;
    const c = t.admin.platformSettings.common;
    const [ssl, setSsl] = useState<SslSettings>(SSL_DEFAULTS);
    const [bkash, setBkash] = useState<BkashSettings>(BKASH_DEFAULTS);
    const [nagad, setNagad] = useState<NagadSettings>(NAGAD_DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [savingSSL, setSavingSSL] = useState(false);
    const [savingBkash, setSavingBkash] = useState(false);
    const [savingNagad, setSavingNagad] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        const load = async () => {
            const [sslRes, bkashRes, nagadRes] = await Promise.all([
                fetchWithAuth('/admin/platform-settings/payment_ssl').then((r) => r.json()),
                fetchWithAuth('/admin/platform-settings/payment_bkash').then((r) => r.json()),
                fetchWithAuth('/admin/platform-settings/payment_nagad').then((r) => r.json()),
            ]);
            const s = sslRes?.data ?? sslRes;
            setSsl({ store_id: s.store_id ?? '', store_password: s.store_password === '••••••••' ? '' : (s.store_password ?? ''), is_sandbox: s.is_sandbox ?? 'true' });
            const b = bkashRes?.data ?? bkashRes;
            setBkash({ app_key: b.app_key ?? '', app_secret: b.app_secret === '••••••••' ? '' : (b.app_secret ?? ''), username: b.username ?? '', password: b.password === '••••••••' ? '' : (b.password ?? ''), is_sandbox: b.is_sandbox ?? 'true' });
            const n = nagadRes?.data ?? nagadRes;
            setNagad({ merchant_id: n.merchant_id ?? '', merchant_private_key: n.merchant_private_key === '••••••••' ? '' : (n.merchant_private_key ?? ''), merchant_public_key: n.merchant_public_key ?? '', is_sandbox: n.is_sandbox ?? 'true' });
        };
        load()
            .catch(() => setToast({ type: 'error', message: m.loadFailed }))
            .finally(() => setLoading(false));
    }, []);

    async function saveGroup(group: string, payload: Record<string, string | null>, setSaving: (v: boolean) => void) {
        setSaving(true);
        try {
            const res = await fetchWithAuth(`/admin/platform-settings/${group}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            if (!res.ok) throw new Error('Save failed');
            setToast({ type: 'success', message: c.saved });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? c.saveFailed });
        } finally {
            setSaving(false);
        }
    }

    function handleSaveSSL() {
        const payload: Record<string, string | null> = { store_id: ssl.store_id, is_sandbox: ssl.is_sandbox };
        if (ssl.store_password) payload.store_password = ssl.store_password;
        saveGroup('payment_ssl', payload, setSavingSSL);
        setSsl((s) => ({ ...s, store_password: '' }));
    }

    function handleSaveBkash() {
        const payload: Record<string, string | null> = { app_key: bkash.app_key, username: bkash.username, is_sandbox: bkash.is_sandbox };
        if (bkash.app_secret) payload.app_secret = bkash.app_secret;
        if (bkash.password) payload.password = bkash.password;
        saveGroup('payment_bkash', payload, setSavingBkash);
        setBkash((s) => ({ ...s, app_secret: '', password: '' }));
    }

    function handleSaveNagad() {
        const payload: Record<string, string | null> = { merchant_id: nagad.merchant_id, merchant_public_key: nagad.merchant_public_key, is_sandbox: nagad.is_sandbox };
        if (nagad.merchant_private_key) payload.merchant_private_key = nagad.merchant_private_key;
        saveGroup('payment_nagad', payload, setSavingNagad);
        setNagad((s) => ({ ...s, merchant_private_key: '' }));
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center gap-3">
                    <Link href="/admin/platform-settings" className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                        <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </Link>
                    <CreditCard className="w-5 h-5 text-violet-600" />
                    <h1 className="text-xl font-black tracking-tight">{m.title}</h1>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> {c.loading}
                    </div>
                ) : (
                    <>
                        <GatewayCard title={m.ssl.title} subtitle={m.ssl.subtitle} saving={savingSSL} onSave={handleSaveSSL} saveLabel={c.save} savingLabel={c.saving}>
                            <SandboxToggle value={ssl.is_sandbox} onChange={(v) => setSsl((s) => ({ ...s, is_sandbox: v }))} onLabel={m.sandboxOn} offLabel={m.sandboxOff} />
                            <Field label={m.ssl.storeId}>
                                <input type="text" value={ssl.store_id} onChange={(e) => setSsl((s) => ({ ...s, store_id: e.target.value }))} placeholder="your_store_id" className={inputCls} />
                            </Field>
                            <Field label={m.ssl.storePassword} hint={c.secretHint}>
                                <input type="password" autoComplete="new-password" value={ssl.store_password} onChange={(e) => setSsl((s) => ({ ...s, store_password: e.target.value }))} placeholder={m.ssl.passwordPlaceholder} className={inputCls} />
                            </Field>
                        </GatewayCard>

                        <GatewayCard title={m.bkash.title} subtitle={m.bkash.subtitle} saving={savingBkash} onSave={handleSaveBkash} saveLabel={c.save} savingLabel={c.saving}>
                            <SandboxToggle value={bkash.is_sandbox} onChange={(v) => setBkash((s) => ({ ...s, is_sandbox: v }))} onLabel={m.sandboxOn} offLabel={m.sandboxOff} />
                            <div className="grid grid-cols-2 gap-4">
                                <Field label={m.bkash.appKey}>
                                    <input type="text" value={bkash.app_key} onChange={(e) => setBkash((s) => ({ ...s, app_key: e.target.value }))} placeholder="app_key" className={inputCls} />
                                </Field>
                                <Field label={m.bkash.appSecret} hint={c.secretHint}>
                                    <input type="password" autoComplete="new-password" value={bkash.app_secret} onChange={(e) => setBkash((s) => ({ ...s, app_secret: e.target.value }))} placeholder={m.bkash.leaveBlank} className={inputCls} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <Field label={m.bkash.username}>
                                    <input type="text" value={bkash.username} onChange={(e) => setBkash((s) => ({ ...s, username: e.target.value }))} placeholder="username" className={inputCls} />
                                </Field>
                                <Field label={m.bkash.password} hint={c.secretHint}>
                                    <input type="password" autoComplete="new-password" value={bkash.password} onChange={(e) => setBkash((s) => ({ ...s, password: e.target.value }))} placeholder={m.bkash.leaveBlank} className={inputCls} />
                                </Field>
                            </div>
                        </GatewayCard>

                        <GatewayCard title={m.nagad.title} subtitle={m.nagad.subtitle} saving={savingNagad} onSave={handleSaveNagad} saveLabel={c.save} savingLabel={c.saving}>
                            <SandboxToggle value={nagad.is_sandbox} onChange={(v) => setNagad((s) => ({ ...s, is_sandbox: v }))} onLabel={m.sandboxOn} offLabel={m.sandboxOff} />
                            <Field label={m.nagad.merchantId}>
                                <input type="text" value={nagad.merchant_id} onChange={(e) => setNagad((s) => ({ ...s, merchant_id: e.target.value }))} placeholder="merchant_id" className={inputCls} />
                            </Field>
                            <Field label={m.nagad.publicKey}>
                                <textarea rows={3} value={nagad.merchant_public_key} onChange={(e) => setNagad((s) => ({ ...s, merchant_public_key: e.target.value }))} placeholder={m.nagad.publicKeyPlaceholder} className={`${inputCls} resize-none font-mono text-xs`} />
                            </Field>
                            <Field label={m.nagad.privateKey} hint={c.secretHint}>
                                <textarea rows={3} autoComplete="new-password" value={nagad.merchant_private_key} onChange={(e) => setNagad((s) => ({ ...s, merchant_private_key: e.target.value }))} placeholder={m.nagad.privateKeyPlaceholder} className={`${inputCls} resize-none font-mono text-xs`} />
                            </Field>
                        </GatewayCard>
                    </>
                )}
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
