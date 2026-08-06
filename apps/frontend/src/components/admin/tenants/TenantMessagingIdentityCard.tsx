'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { api, type AdminTenantMessagingIdentity } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';

type Props = {
    tenantId: string;
    onToast: (message: string) => void;
    onError: (message: string) => void;
};

const EMPTY: AdminTenantMessagingIdentity = {
    email_enabled: false,
    email_from: '',
    email_from_name: '',
    email_reply_to: '',
    whatsapp_enabled: false,
    whatsapp_phone_number_id: '',
    whatsapp_access_token: '',
    whatsapp_api_version: '',
    notes: '',
    updated_at: null,
    updated_by: null,
};

const inputClass =
    'w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300';

/**
 * Platform-admin control for one tenant's own sender. Absent or switched off,
 * the tenant sends from the platform sender — which is the state, and the
 * intended state, for nearly every workspace.
 */
export default function TenantMessagingIdentityCard({ tenantId, onToast, onError }: Props) {
    const { t } = useI18n();
    const mi = t.admin.tenants.messagingIdentity;

    const [draft, setDraft] = useState<AdminTenantMessagingIdentity>(EMPTY);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testRecipient, setTestRecipient] = useState('');
    const [testingChannel, setTestingChannel] = useState<'email' | 'whatsapp' | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.getAdminTenantMessagingIdentity(tenantId)
            .then((identity) => {
                if (!cancelled) setDraft(identity);
            })
            .catch(() => {
                if (!cancelled) setDraft(EMPTY);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tenantId]);

    const set = <K extends keyof AdminTenantMessagingIdentity>(
        key: K,
        value: AdminTenantMessagingIdentity[K],
    ) => setDraft((current) => ({ ...current, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            const saved = await api.updateAdminTenantMessagingIdentity(tenantId, {
                email_enabled: draft.email_enabled,
                email_from: draft.email_from,
                email_from_name: draft.email_from_name,
                email_reply_to: draft.email_reply_to,
                whatsapp_enabled: draft.whatsapp_enabled,
                whatsapp_phone_number_id: draft.whatsapp_phone_number_id,
                whatsapp_access_token: draft.whatsapp_access_token,
                whatsapp_api_version: draft.whatsapp_api_version,
                notes: draft.notes,
            });
            setDraft(saved);
            onToast(mi.saved);
        } catch (err: unknown) {
            onError(err instanceof Error ? err.message : mi.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async (channel: 'email' | 'whatsapp') => {
        if (!testRecipient.trim()) {
            onError(mi.testRecipientRequired);
            return;
        }
        setTestingChannel(channel);
        try {
            const result =
                channel === 'email'
                    ? await api.testAdminTenantMessagingEmail(tenantId, testRecipient.trim())
                    : await api.testAdminTenantMessagingWhatsApp(tenantId, testRecipient.trim());
            // "Sent" alone is not the answer the operator needs — a send that
            // quietly fell back to the platform sender looks identical otherwise.
            onToast(result.sender === 'tenant' ? mi.testSentTenant : mi.testSentPlatform);
        } catch (err: unknown) {
            onError(err instanceof Error ? err.message : mi.testFailed);
        } finally {
            setTestingChannel(null);
        }
    };

    return (
        <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-5 space-y-4">
            <div>
                <p className="text-[10px] font-medium text-blue-400">{mi.badge}</p>
                <h3 className="mt-2 text-lg font-bold tracking-tight text-blue-900">{mi.title}</h3>
                <p className="mt-1 text-xs text-blue-700/80">{mi.description}</p>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-blue-700">
                    <Loader2 className="w-4 h-4 animate-spin" />
                </div>
            ) : (
                <>
                    <div className="rounded-lg border border-blue-100 bg-white p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {mi.emailSection}
                        </p>
                        <label className="flex min-h-touch items-center justify-between gap-3 text-sm font-medium">
                            <span>{mi.emailEnabled}</span>
                            <input
                                type="checkbox"
                                checked={draft.email_enabled}
                                onChange={(event) => set('email_enabled', event.target.checked)}
                                className="h-4 w-4"
                            />
                        </label>
                        {draft.email_enabled ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500">{mi.fromLabel}</label>
                                    <input
                                        type="email"
                                        value={draft.email_from}
                                        onChange={(event) => set('email_from', event.target.value)}
                                        placeholder={mi.fromPlaceholder}
                                        className={`mt-1 ${inputClass}`}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">{mi.fromHint}</p>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-gray-500">{mi.fromNameLabel}</label>
                                        <input
                                            type="text"
                                            value={draft.email_from_name}
                                            onChange={(event) => set('email_from_name', event.target.value)}
                                            placeholder={mi.fromNamePlaceholder}
                                            className={`mt-1 ${inputClass}`}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-500">{mi.replyToLabel}</label>
                                        <input
                                            type="email"
                                            value={draft.email_reply_to}
                                            onChange={(event) => set('email_reply_to', event.target.value)}
                                            placeholder={mi.replyToPlaceholder}
                                            className={`mt-1 ${inputClass}`}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-gray-500">{mi.emailUsingPlatform}</p>
                        )}
                    </div>

                    <div className="rounded-lg border border-blue-100 bg-white p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {mi.whatsappSection}
                        </p>
                        <label className="flex min-h-touch items-center justify-between gap-3 text-sm font-medium">
                            <span>{mi.whatsappEnabled}</span>
                            <input
                                type="checkbox"
                                checked={draft.whatsapp_enabled}
                                onChange={(event) => set('whatsapp_enabled', event.target.checked)}
                                className="h-4 w-4"
                            />
                        </label>
                        {draft.whatsapp_enabled ? (
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-gray-500">
                                            {mi.phoneNumberIdLabel}
                                        </label>
                                        <input
                                            type="text"
                                            value={draft.whatsapp_phone_number_id}
                                            onChange={(event) => set('whatsapp_phone_number_id', event.target.value)}
                                            placeholder={mi.phoneNumberIdPlaceholder}
                                            className={`mt-1 ${inputClass}`}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-500">{mi.apiVersionLabel}</label>
                                        <input
                                            type="text"
                                            value={draft.whatsapp_api_version}
                                            onChange={(event) => set('whatsapp_api_version', event.target.value)}
                                            placeholder={mi.apiVersionPlaceholder}
                                            className={`mt-1 ${inputClass}`}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500">{mi.accessTokenLabel}</label>
                                    <input
                                        type="password"
                                        value={draft.whatsapp_access_token}
                                        onChange={(event) => set('whatsapp_access_token', event.target.value)}
                                        placeholder={mi.accessTokenPlaceholder}
                                        autoComplete="off"
                                        className={`mt-1 ${inputClass}`}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">{mi.accessTokenHint}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-gray-500">{mi.whatsappUsingPlatform}</p>
                        )}
                    </div>

                    <div>
                        <label className="text-xs font-medium text-blue-700/80">{mi.notesLabel}</label>
                        <input
                            type="text"
                            value={draft.notes}
                            onChange={(event) => set('notes', event.target.value)}
                            placeholder={mi.notesPlaceholder}
                            className={`mt-1 ${inputClass}`}
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving}
                            className="inline-flex min-h-touch items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            {mi.save}
                        </button>
                        {draft.updated_at ? (
                            <span className="text-xs text-blue-700/70">
                                {formatMessage(mi.lastUpdated, { date: formatDate(draft.updated_at) })}
                            </span>
                        ) : null}
                    </div>

                    <div className="rounded-lg border border-blue-100 bg-white p-4 space-y-3">
                        <label className="text-xs font-medium text-gray-500">{mi.testLabel}</label>
                        <div className="flex flex-wrap gap-3">
                            <input
                                type="text"
                                value={testRecipient}
                                onChange={(event) => setTestRecipient(event.target.value)}
                                placeholder={
                                    draft.whatsapp_enabled && !draft.email_enabled
                                        ? mi.testPhonePlaceholder
                                        : mi.testEmailPlaceholder
                                }
                                className={`flex-1 min-w-[200px] ${inputClass}`}
                            />
                            <button
                                type="button"
                                onClick={() => void sendTest('email')}
                                disabled={testingChannel !== null}
                                className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                            >
                                {testingChannel === 'email' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                {mi.testEmail}
                            </button>
                            <button
                                type="button"
                                onClick={() => void sendTest('whatsapp')}
                                disabled={testingChannel !== null}
                                className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                            >
                                {testingChannel === 'whatsapp' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                {mi.testWhatsapp}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">{mi.testHint}</p>
                    </div>
                </>
            )}
        </div>
    );
}
