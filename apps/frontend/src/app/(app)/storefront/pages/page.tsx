'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Menu as MenuIcon, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, PageShell, StatusBadge } from '@/components/ui';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/format';

type PageRow = {
    id: string;
    slug: string;
    title: string;
    status: string;
    published_at: string | null;
    updated_at: string;
};

type StorefrontSettings = {
    storefront_slug: string | null;
    storefront_enabled: boolean;
};

/**
 * A shop's standing pages — "About us", "Delivery & returns", "Contact".
 *
 * Sits beside the storefront settings rather than under the blog: a page is not
 * a post. It has no date, does not appear in any feed, and is reached from the
 * shop's menu, which is the sibling screen at `/storefront/menu`.
 */
export default function StorefrontPagesPage() {
    const { t, locale } = useI18n();
    const m = t.storefront.pages;

    const [rows, setRows] = useState<PageRow[]>([]);
    const [settings, setSettings] = useState<StorefrontSettings | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [pages, storefront] = await Promise.all([
                api.getStorefrontPages(),
                fetchWithAuth('/tenants/storefront-settings').catch(() => null),
            ]);
            setRows(Array.isArray(pages) ? pages : []);
            setSettings(storefront as StorefrontSettings | null);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const storeSlug = settings?.storefront_slug ?? null;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.storefront,
                        'storefront',
                        [{ label: t.storefront.dashboard.orders.title, href: routes.storefront.root }],
                        m.title,
                    )}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link href={routes.storefront.menu}>
                                <Button variant="secondary" size="sm">
                                    <MenuIcon className="h-4 w-4" />
                                    {m.manageMenu}
                                </Button>
                            </Link>
                            <Link href={routes.storefront.newPage}>
                                <Button size="sm">
                                    <Plus className="h-4 w-4" />
                                    {m.newPage}
                                </Button>
                            </Link>
                        </div>
                    }
                />

                {settings && !settings.storefront_enabled && <Alert tone="warning">{m.storefrontOff}</Alert>}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">
                                    {m.colTitle}
                                </th>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">
                                    {m.colStatus}
                                </th>
                                <th className="hidden px-3 py-2 text-start text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.colUpdated}
                                </th>
                                <th className="hidden px-3 py-2 text-end text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.colAddress}
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
                                                href={routes.storefront.page(row.id)}
                                                className="font-medium text-blue-600 hover:underline"
                                            >
                                                {row.title}
                                            </Link>
                                            <div className="mt-0.5 text-xs text-gray-500 md:hidden">/{row.slug}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge tone={row.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                                                {row.status === 'PUBLISHED' ? m.published : m.draft}
                                            </StatusBadge>
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">
                                            {formatDate(row.updated_at, locale)}
                                        </td>
                                        <td className="hidden px-3 py-2 text-end text-xs text-gray-600 md:table-cell">
                                            {storeSlug && row.status === 'PUBLISHED' ? (
                                                <a
                                                    href={`/store/${storeSlug}/pages/${row.slug}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                                                >
                                                    /{row.slug}
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            ) : (
                                                <span>/{row.slug}</span>
                                            )}
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
