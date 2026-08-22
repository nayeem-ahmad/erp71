'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Plus, Tags } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Alert, Button, Checkbox, Field, Input, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

type Settings = {
    enabled: boolean;
    title: string | null;
    tagline: string | null;
    storefront_slug: string | null;
    storefront_enabled: boolean;
    shop_name: string | null;
};

type PostRow = {
    id: string;
    slug: string;
    status: string;
    title: string;
    published_at: string | null;
    view_count: number;
    category: { name: string } | null;
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
    PUBLISHED: 'success',
    SCHEDULED: 'warning',
    DRAFT: 'neutral',
    ARCHIVED: 'danger',
};

/**
 * A shop's own blog, managed from Settings.
 *
 * The switch is the first thing on the page because it is the thing that
 * decides whether any of the rest is reachable: `TenantBlogSettings.enabled`
 * defaults to false, and publishing into a blog nobody can open is rejected by
 * the API rather than silently accepted.
 */
export default function StorefrontBlogPage() {
    const { t } = useI18n();
    const m = t.storefront.blog;

    const [settings, setSettings] = useState<Settings | null>(null);
    const [rows, setRows] = useState<PostRow[]>([]);
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [settingsData, postsData] = await Promise.all([
                api.getTenantBlogSettings(),
                api.getTenantBlogPosts({ status: status || undefined }),
            ]);
            setSettings(settingsData);
            setRows(postsData?.rows ?? []);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => {
        void load();
    }, [load]);

    async function patchSettings(patch: Record<string, unknown>) {
        setSaving(true);
        try {
            const updated = await api.updateTenantBlogSettings(patch);
            setSettings(updated);
            toast.success(m.saved);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    const publicHref = settings?.storefront_slug ? `/store/${settings.storefront_slug}/blog` : null;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link href="/settings/blog/categories">
                                <Button variant="secondary" size="sm">
                                    <Tags className="h-4 w-4" />
                                    {m.categories}
                                </Button>
                            </Link>
                            <Link href="/settings/blog/new">
                                <Button size="sm">
                                    <Plus className="h-4 w-4" />
                                    {m.newPost}
                                </Button>
                            </Link>
                        </div>
                    }
                />

                {settings && !settings.storefront_enabled && (
                    <Alert tone="warning">{m.storefrontOff}</Alert>
                )}

                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <label className="flex items-center gap-2 text-sm text-gray-800">
                        <Checkbox
                            checked={!!settings?.enabled}
                            disabled={saving || loading}
                            onChange={(event) => patchSettings({ enabled: event.target.checked })}
                        />
                        {m.enable}
                    </label>
                    <p className="text-xs text-gray-500">{m.enableHint}</p>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={m.blogTitle}>
                            <Input
                                defaultValue={settings?.title ?? ''}
                                onBlur={(event) => {
                                    if (event.target.value !== (settings?.title ?? '')) {
                                        void patchSettings({ title: event.target.value });
                                    }
                                }}
                            />
                        </Field>
                        <Field label={m.tagline}>
                            <Input
                                defaultValue={settings?.tagline ?? ''}
                                onBlur={(event) => {
                                    if (event.target.value !== (settings?.tagline ?? '')) {
                                        void patchSettings({ tagline: event.target.value });
                                    }
                                }}
                            />
                        </Field>
                    </div>

                    {publicHref && settings?.enabled && (
                        <a
                            href={publicHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                            {m.viewPublic}
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}
                </div>

                <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-44">
                    <option value="">{m.allStatuses}</option>
                    {Object.entries(m.status).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">{m.postTitle}</th>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">{t.common.status}</th>
                                <th className="hidden px-3 py-2 text-start text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.category}
                                </th>
                                <th className="hidden px-3 py-2 text-end text-xs font-semibold text-gray-600 md:table-cell">
                                    {t.common.total}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {t.common.loading}
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {m.empty}
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <Link
                                                href={`/settings/blog/${row.id}`}
                                                className="font-medium text-blue-600 hover:underline"
                                            >
                                                {row.title}
                                            </Link>
                                            <div className="mt-0.5 text-xs text-gray-500">/{row.slug}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                                                {(m.status as Record<string, string>)[row.status] ?? row.status}
                                            </StatusBadge>
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">
                                            {row.category?.name ?? '—'}
                                        </td>
                                        <td className="hidden px-3 py-2 text-end text-xs text-gray-600 md:table-cell">
                                            {row.view_count}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </PageShell>
    );
}
