'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plug } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, Field, Input, PageShell, Select } from '@/components/ui';
import type { BufferChannel } from '@/components/admin/social/social-post';
import { api, fetchWithAuth } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

type BufferSettings = {
    access_token: string;
    organization_id: string;
    api_url: string;
    default_channel_id: string;
};

const DEFAULTS: BufferSettings = {
    access_token: '',
    organization_id: '',
    api_url: 'https://api.buffer.com',
    default_channel_id: '',
};

export default function PlatformBufferSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.buffer;
    const c = t.admin.platformSettings.common;

    const [settings, setSettings] = useState<BufferSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [channels, setChannels] = useState<BufferChannel[] | null>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/social_buffer')
            .then((d) => {
                setSettings({
                    // The API masks secrets as bullets; blanking it keeps "leave
                    // empty to keep the existing key" honest instead of saving
                    // the mask back over the real value.
                    access_token: d.access_token === '••••••••' ? '' : (d.access_token ?? ''),
                    organization_id: d.organization_id ?? '',
                    api_url: d.api_url || DEFAULTS.api_url,
                    default_channel_id: d.default_channel_id ?? '',
                });
            })
            .catch(() => toast.error(m.loadFailed))
            .finally(() => setLoading(false));
    }, []);

    // Populates the default-channel picker for an install that is already
    // connected, so the operator does not have to paste an id by hand.
    useEffect(() => {
        if (loading) return;
        api.getBufferChannels()
            .then((rows: BufferChannel[]) => setChannels(rows ?? []))
            .catch(() => setChannels(null));
    }, [loading]);

    function set(key: keyof BufferSettings, value: string) {
        setSettings((s) => ({ ...s, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                organization_id: settings.organization_id.trim(),
                api_url: settings.api_url.trim() || DEFAULTS.api_url,
                default_channel_id: settings.default_channel_id.trim(),
            };
            if (settings.access_token) payload.access_token = settings.access_token;

            await fetchWithAuth('/admin/platform-settings/social_buffer', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            setSettings((prev) => ({ ...prev, access_token: '' }));
            toast.success(m.saved);
        } catch (error) {
            toast.error((error as Error).message ?? c.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        setTesting(true);
        try {
            const result = await api.testBufferConnection();
            setChannels(result?.channels ?? []);
            if (result?.channel_count) {
                toast.success(formatMessage(m.test.success, { count: result.channel_count }));
            } else {
                toast.error(m.test.empty);
            }
        } catch (error) {
            toast.error((error as Error).message ?? m.test.failed);
        } finally {
            setTesting(false);
        }
    }

    return (
        <PageShell>
            <div className="mx-auto max-w-2xl space-y-4">
                <PageHeader
                    title={m.title}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        m.title,
                    )}
                />

                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                        <Loader2 className="h-4 w-4 animate-spin" /> {c.loading}
                    </div>
                ) : (
                    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
                        <p className="text-sm leading-relaxed text-gray-500">{m.description}</p>

                        <Field label={m.accessToken.label} hint={m.accessToken.hint}>
                            <Input
                                type="password"
                                autoComplete="new-password"
                                value={settings.access_token}
                                onChange={(event) => set('access_token', event.target.value)}
                                placeholder={m.accessToken.placeholder}
                            />
                        </Field>

                        <Field label={m.organizationId.label} hint={m.organizationId.hint} required>
                            <Input
                                value={settings.organization_id}
                                onChange={(event) => set('organization_id', event.target.value)}
                            />
                        </Field>

                        <Field label={m.apiUrl.label} hint={m.apiUrl.hint}>
                            <Input
                                value={settings.api_url}
                                onChange={(event) => set('api_url', event.target.value)}
                                placeholder={DEFAULTS.api_url}
                            />
                        </Field>

                        <Field
                            label={m.defaultChannel.label}
                            hint={channels?.length ? m.defaultChannel.hint : m.defaultChannel.manualHint}
                        >
                            {channels?.length ? (
                                <Select
                                    value={settings.default_channel_id}
                                    onChange={(event) => set('default_channel_id', event.target.value)}
                                >
                                    <option value="">{m.defaultChannel.none}</option>
                                    {channels.map((channel) => (
                                        <option key={channel.id} value={channel.id}>
                                            {channel.name ?? channel.id}
                                            {channel.service ? ` · ${channel.service}` : ''}
                                        </option>
                                    ))}
                                </Select>
                            ) : (
                                <Input
                                    value={settings.default_channel_id}
                                    onChange={(event) => set('default_channel_id', event.target.value)}
                                    placeholder={m.defaultChannel.manual}
                                />
                            )}
                        </Field>

                        <div className="pt-1">
                            <Button onClick={handleSave} loading={saving} size="md">
                                {saving ? c.saving : c.saveSettings}
                            </Button>
                        </div>
                    </div>
                )}

                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-medium text-gray-500">{m.test.title}</h2>
                    <Button
                        onClick={handleTest}
                        loading={testing}
                        size="md"
                        icon={!testing ? <Plug className="h-4 w-4" /> : undefined}
                    >
                        {testing ? m.test.running : m.test.button}
                    </Button>
                    <p className="text-xs text-gray-400">{c.testHint}</p>

                    {channels && channels.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-gray-600">{m.test.channels}</p>
                            <ul className="mt-1 space-y-1">
                                {channels.map((channel) => (
                                    <li key={channel.id} className="flex items-center gap-2 text-xs text-gray-600">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        <span className="font-medium text-gray-700">
                                            {channel.name ?? channel.id}
                                        </span>
                                        {channel.service && (
                                            <span className="text-gray-400">{channel.service}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>
    );
}
