'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Input, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type AdminPostRow = {
    id: string;
    slug: string;
    status: string;
    audience: string;
    title: string;
    author_name: string | null;
    category: { id: string; name_en: string } | null;
    published_at: string | null;
    scheduled_for: string | null;
    updated_at: string;
    view_count: number;
    featured: boolean;
    locales: string[];
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
    PUBLISHED: 'success',
    SCHEDULED: 'warning',
    DRAFT: 'neutral',
    ARCHIVED: 'danger',
};

function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminBlogPage() {
    const { t } = useI18n();
    const m = t.admin.blog;

    const [rows, setRows] = useState<AdminPostRow[]>([]);
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getAdminBlogPosts({ status: status || undefined, search: search || undefined });
            setRows(data?.rows ?? []);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [status, search]);

    useEffect(() => {
        // Debounced so typing in the search box does not fire a request per
        // keystroke; the status select re-runs it immediately via the same path.
        const timer = setTimeout(load, search ? 300 : 0);
        return () => clearTimeout(timer);
    }, [load, search]);

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link href="/admin/blog/categories">
                                <Button variant="secondary" size="sm">
                                    <Tags className="h-4 w-4" />
                                    {m.categories}
                                </Button>
                            </Link>
                            <Link href="/admin/blog/new">
                                <Button size="sm">
                                    <Plus className="h-4 w-4" />
                                    {m.newPost}
                                </Button>
                            </Link>
                        </div>
                    }
                />

                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={m.search}
                        className="w-full sm:w-64"
                    />
                    <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-44">
                        <option value="">{m.allStatuses}</option>
                        {Object.entries(m.status).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">{m.columns.title}</th>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">{m.columns.status}</th>
                                <th className="hidden px-3 py-2 text-start text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.columns.audience}
                                </th>
                                <th className="hidden px-3 py-2 text-start text-xs font-semibold text-gray-600 lg:table-cell">
                                    {m.columns.category}
                                </th>
                                <th className="hidden px-3 py-2 text-start text-xs font-semibold text-gray-600 lg:table-cell">
                                    {m.columns.published}
                                </th>
                                <th className="hidden px-3 py-2 text-end text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.columns.views}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {t.common.loading}
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {m.empty}
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <Link
                                                href={`/admin/blog/${row.id}`}
                                                className="font-medium text-blue-600 hover:underline"
                                            >
                                                {row.title}
                                            </Link>
                                            <div className="mt-0.5 text-xs text-gray-500">
                                                /{row.slug} · {row.locales.join(', ')}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                                                {(m.status as Record<string, string>)[row.status] ?? row.status}
                                            </StatusBadge>
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">
                                            {(m.audience as Record<string, string>)[row.audience] ?? row.audience}
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 lg:table-cell">
                                            {row.category?.name_en ?? '—'}
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 lg:table-cell">
                                            {formatDate(row.published_at ?? row.scheduled_for)}
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
