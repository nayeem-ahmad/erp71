'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Pencil, Plus, Send, Settings, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, ConfirmDialog, Input, PageShell, Select, StatusBadge } from '@/components/ui';
import PushToBufferModal from '@/components/admin/social/PushToBufferModal';
import SocialPostFormModal from '@/components/admin/social/SocialPostFormModal';
import { formatDateTime, type SocialPost } from '@/components/admin/social/social-post';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
    PUBLISHED: 'success',
    SCHEDULED: 'warning',
    DRAFT: 'neutral',
    FAILED: 'danger',
};

/** Enough of the copy to recognise the post without turning the row into a wall. */
function excerpt(content: string): string {
    return content.length > 120 ? `${content.slice(0, 120)}…` : content;
}

export default function AdminSocialMediaPage() {
    const { t } = useI18n();
    const m = t.admin.socialMedia;

    const [rows, setRows] = useState<SocialPost[]>([]);
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    const [bufferConfigured, setBufferConfigured] = useState(true);
    const [defaultChannelId, setDefaultChannelId] = useState<string | null>(null);

    const [editing, setEditing] = useState<SocialPost | null>(null);
    const [composing, setComposing] = useState(false);
    const [pushing, setPushing] = useState<SocialPost | null>(null);
    const [deleting, setDeleting] = useState<SocialPost | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getAdminSocialPosts({
                status: status || undefined,
                search: search || undefined,
            });
            setRows(data?.rows ?? []);
        } catch (error) {
            toast.error((error as Error).message || m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [status, search, m.loadFailed]);

    useEffect(() => {
        // Debounced so typing in the search box does not fire a request per
        // keystroke; the status select re-runs it immediately via the same path.
        const timer = setTimeout(load, search ? 300 : 0);
        return () => clearTimeout(timer);
    }, [load, search]);

    useEffect(() => {
        api.getBufferStatus()
            .then((data) => {
                setBufferConfigured(Boolean(data?.configured));
                setDefaultChannelId(data?.default_channel_id ?? null);
            })
            // A failed probe should not imply "not configured" — that would put a
            // setup banner in front of a working install after one flaky request.
            .catch(() => undefined);
    }, []);

    function replaceRow(post: SocialPost) {
        setRows((current) => {
            const exists = current.some((row) => row.id === post.id);
            return exists ? current.map((row) => (row.id === post.id ? post : row)) : [post, ...current];
        });
    }

    async function handleDuplicate(post: SocialPost) {
        try {
            const copy = await api.duplicateAdminSocialPost(post.id);
            setRows((current) => [copy, ...current]);
            toast.success(m.duplicated);
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    async function handleDelete() {
        if (!deleting) return;
        try {
            await api.deleteAdminSocialPost(deleting.id);
            setRows((current) => current.filter((row) => row.id !== deleting.id));
            toast.success(m.deleted);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setDeleting(null);
        }
    }

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
                            <Link href={routes.admin.platformSettings.buffer}>
                                <Button variant="secondary" size="sm">
                                    <Settings className="h-4 w-4" />
                                    {m.configure}
                                </Button>
                            </Link>
                            <Button size="sm" onClick={() => setComposing(true)}>
                                <Plus className="h-4 w-4" />
                                {m.newPost}
                            </Button>
                        </div>
                    }
                />

                {!bufferConfigured && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        {m.notConfigured}{' '}
                        <Link
                            href={routes.admin.platformSettings.buffer}
                            className="font-semibold underline"
                        >
                            {m.configure}
                        </Link>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={m.search}
                        className="w-full sm:w-64"
                    />
                    <Select
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        className="w-full sm:w-44"
                    >
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
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                                    {m.columns.post}
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                                    {m.columns.status}
                                </th>
                                <th className="hidden px-3 py-2 text-left text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.columns.networks}
                                </th>
                                <th className="hidden px-3 py-2 text-left text-xs font-semibold text-gray-600 lg:table-cell">
                                    {m.columns.scheduled}
                                </th>
                                <th className="hidden px-3 py-2 text-left text-xs font-semibold text-gray-600 lg:table-cell">
                                    {m.columns.lastPush}
                                </th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                                    {m.columns.actions}
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
                                            {row.title && (
                                                <p className="font-medium text-gray-800">{row.title}</p>
                                            )}
                                            <p className="text-xs text-gray-500">{excerpt(row.content)}</p>
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                                                {(m.status as Record<string, string>)[row.status] ?? row.status}
                                            </StatusBadge>
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">
                                            {row.networks.length
                                                ? row.networks
                                                      .map(
                                                          (network) =>
                                                              (m.networkNames as Record<string, string>)[
                                                                  network
                                                              ] ?? network,
                                                      )
                                                      .join(', ')
                                                : '—'}
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 lg:table-cell">
                                            {formatDateTime(row.scheduled_for)}
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 lg:table-cell">
                                            {formatDateTime(row.last_push_at)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={m.actions.push}
                                                    title={m.actions.push}
                                                    onClick={() => setPushing(row)}
                                                >
                                                    <Send className="h-4 w-4" />
                                                </Button>
                                                {row.status !== 'PUBLISHED' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-label={m.actions.edit}
                                                        title={m.actions.edit}
                                                        onClick={() => setEditing(row)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={m.actions.duplicate}
                                                    title={m.actions.duplicate}
                                                    onClick={() => handleDuplicate(row)}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={m.actions.delete}
                                                    title={m.actions.delete}
                                                    onClick={() => setDeleting(row)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-danger" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {(composing || editing) && (
                <SocialPostFormModal
                    post={editing}
                    onClose={() => {
                        setComposing(false);
                        setEditing(null);
                    }}
                    onSaved={(post) => {
                        replaceRow(post);
                        setComposing(false);
                        setEditing(null);
                    }}
                />
            )}

            {pushing && (
                <PushToBufferModal
                    post={pushing}
                    defaultChannelId={defaultChannelId}
                    onClose={() => setPushing(null)}
                    onPushed={(post) => {
                        replaceRow(post);
                        setPushing(post);
                    }}
                />
            )}

            {deleting && (
                <ConfirmDialog
                    open
                    title={m.actions.delete}
                    prompt={m.deleteConfirm}
                    confirmLabel={m.actions.delete}
                    cancelLabel={m.editor.cancel}
                    danger
                    onConfirm={handleDelete}
                    onCancel={() => setDeleting(null)}
                />
            )}
        </PageShell>
    );
}
