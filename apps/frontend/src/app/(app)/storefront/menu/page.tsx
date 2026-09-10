'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import {
    Alert,
    Button,
    Checkbox,
    ConfirmDialog,
    Field,
    Input,
    PageShell,
    Select,
    StatusBadge,
} from '@/components/ui';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

type LinkedPage = {
    id: string;
    slug: string;
    title: string;
    status: string;
    deleted_at: string | null;
};

type MenuLink = {
    id: string;
    label: string;
    type: 'PAGE' | 'INTERNAL' | 'EXTERNAL';
    page_id: string | null;
    url: string | null;
    sort_order: number;
    visible: boolean;
    open_in_new_tab: boolean;
    page: LinkedPage | null;
};

type PageOption = { id: string; title: string; status: string };

type StorefrontSettings = {
    storefront_slug: string | null;
    storefront_enabled: boolean;
};

type Draft = {
    id: string | null;
    label: string;
    type: MenuLink['type'];
    page_id: string;
    url: string;
    visible: boolean;
    open_in_new_tab: boolean;
};

const EMPTY_DRAFT: Draft = {
    id: null,
    label: '',
    type: 'PAGE',
    page_id: '',
    url: '',
    visible: true,
    open_in_new_tab: false,
};

/**
 * The extra links in a shop's storefront header.
 *
 * Home, Shop and Contact are not listed here because they are not editable:
 * they are the storefront's own spine, and a menu that could remove the way to
 * the products would be a footgun sold as a feature. What an owner controls is
 * what comes after them, and in which order.
 */
export default function StorefrontMenuPage() {
    const { t } = useI18n();
    const m = t.storefront.menu;

    const [rows, setRows] = useState<MenuLink[]>([]);
    const [pages, setPages] = useState<PageOption[]>([]);
    const [settings, setSettings] = useState<StorefrontSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [draft, setDraft] = useState<Draft | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<MenuLink | null>(null);

    const load = useCallback(async () => {
        try {
            const [links, pageRows, storefront] = await Promise.all([
                api.getStorefrontMenuLinks(),
                api.getStorefrontPages(),
                fetchWithAuth('/tenants/storefront-settings').catch(() => null),
            ]);
            setRows(Array.isArray(links) ? links : []);
            setPages(Array.isArray(pageRows) ? pageRows : []);
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

    async function save() {
        if (!draft) return;
        if (!draft.label.trim()) {
            toast.error(m.labelRequired);
            return;
        }
        if (draft.type === 'PAGE' && !draft.page_id) {
            toast.error(m.pageRequired);
            return;
        }
        if (draft.type !== 'PAGE' && !draft.url.trim()) {
            toast.error(m.urlRequired);
            return;
        }

        const payload = {
            label: draft.label.trim(),
            type: draft.type,
            page_id: draft.type === 'PAGE' ? draft.page_id : null,
            url: draft.type === 'PAGE' ? null : draft.url.trim(),
            visible: draft.visible,
            open_in_new_tab: draft.type === 'EXTERNAL' ? draft.open_in_new_tab : false,
        };

        setSaving(true);
        try {
            if (draft.id) {
                await api.updateStorefrontMenuLink(draft.id, payload);
            } else {
                await api.createStorefrontMenuLink(payload);
            }
            setDraft(null);
            toast.success(m.saved);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!confirmRemove) return;
        setSaving(true);
        try {
            await api.deleteStorefrontMenuLink(confirmRemove.id);
            setConfirmRemove(null);
            toast.success(m.saved);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    /**
     * Optimistic: the rows are re-numbered locally so the arrow the owner just
     * clicked does not wait on a round trip, then the whole order is sent.
     */
    async function move(index: number, delta: number) {
        const target = index + delta;
        if (target < 0 || target >= rows.length) return;

        const next = [...rows];
        [next[index], next[target]] = [next[target], next[index]];
        const renumbered = next.map((row, position) => ({ ...row, sort_order: position }));
        setRows(renumbered);

        try {
            await api.reorderStorefrontMenu(
                renumbered.map((row) => ({ id: row.id, sort_order: row.sort_order })),
            );
        } catch (error) {
            toast.error((error as Error).message);
            await load();
        }
    }

    async function toggleVisible(row: MenuLink) {
        setRows((current) =>
            current.map((item) => (item.id === row.id ? { ...item, visible: !item.visible } : item)),
        );
        try {
            // Its own endpoint rather than a full upsert: a link whose page has
            // been deleted is exactly the one an owner reaches to hide, and an
            // upsert would refuse it for pointing at a page that is gone.
            await api.setStorefrontMenuLinkVisibility(row.id, !row.visible);
        } catch (error) {
            toast.error((error as Error).message);
            await load();
        }
    }

    function describe(row: MenuLink) {
        if (row.type === 'PAGE') {
            if (!row.page || row.page.deleted_at) return m.brokenPage;
            if (row.page.status !== 'PUBLISHED') return `${row.page.title} — ${m.draftPage}`;
            return row.page.title;
        }
        if (row.type === 'INTERNAL') {
            if (row.url === '/shop') return m.destShop;
            if (row.url === '/blog') return m.destBlog;
            return m.destHome;
        }
        return row.url ?? '';
    }

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
                            <Link href={routes.storefront.pages}>
                                <Button variant="secondary" size="sm">
                                    <FileText className="h-4 w-4" />
                                    {m.pagesLink}
                                </Button>
                            </Link>
                            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
                                <Plus className="h-4 w-4" />
                                {m.addLink}
                            </Button>
                        </div>
                    }
                />

                {settings && !settings.storefront_enabled && <Alert tone="warning">{m.storefrontOff}</Alert>}

                <Alert tone="info">{m.builtIn}</Alert>

                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {loading ? (
                        <p className="px-3 py-6 text-center text-xs text-gray-500">{t.common.loading}</p>
                    ) : rows.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-gray-500">
                            {pages.length === 0 ? m.noPages : m.empty}
                        </p>
                    ) : (
                        <ul>
                            {rows.map((row, index) => (
                                <li
                                    key={row.id}
                                    className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-0"
                                >
                                    <div className="flex flex-col">
                                        <button
                                            type="button"
                                            aria-label={m.moveUp}
                                            disabled={index === 0}
                                            onClick={() => move(index, -1)}
                                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                        >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={m.moveDown}
                                            disabled={index === rows.length - 1}
                                            onClick={() => move(index, 1)}
                                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                        >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                        </button>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-gray-900">{row.label}</p>
                                        <p className="truncate text-xs text-gray-500">{describe(row)}</p>
                                    </div>

                                    {row.type === 'EXTERNAL' && (
                                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                                    )}

                                    {!row.visible && <StatusBadge tone="neutral">{m.hidden}</StatusBadge>}

                                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                                        <Checkbox checked={row.visible} onChange={() => toggleVisible(row)} />
                                        <span className="hidden sm:inline">{m.visible}</span>
                                    </label>

                                    <button
                                        type="button"
                                        aria-label={m.editLink}
                                        onClick={() =>
                                            setDraft({
                                                id: row.id,
                                                label: row.label,
                                                type: row.type,
                                                page_id: row.page_id ?? '',
                                                url: row.url ?? '',
                                                visible: row.visible,
                                                open_in_new_tab: row.open_in_new_tab,
                                            })
                                        }
                                        className="min-h-touch px-2 text-gray-400 hover:text-blue-600"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={m.removeTitle}
                                        onClick={() => setConfirmRemove(row)}
                                        className="min-h-touch px-2 text-gray-400 hover:text-red-600"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {draft && (
                <ModalShell size="sm" onBackdropClick={() => setDraft(null)}>
                    <ModalHeader
                        title={draft.id ? m.editLink : m.newLink}
                        onClose={() => setDraft(null)}
                        closeLabel={t.common.cancel}
                    />
                    <div className="space-y-3 overflow-y-auto px-4 py-3">
                        <Field label={m.label} required>
                            <Input
                                value={draft.label}
                                placeholder={m.labelPlaceholder}
                                maxLength={60}
                                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                            />
                        </Field>

                        <Field label={m.linkTo}>
                            <Select
                                value={draft.type}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        type: event.target.value as MenuLink['type'],
                                        // The two target columns are exclusive, so
                                        // switching kind clears the one that no
                                        // longer applies rather than leaving a
                                        // stale value to be sent.
                                        page_id: '',
                                        url: event.target.value === 'INTERNAL' ? '/' : '',
                                    })
                                }
                            >
                                <option value="PAGE">{m.typePage}</option>
                                <option value="INTERNAL">{m.typeInternal}</option>
                                <option value="EXTERNAL">{m.typeExternal}</option>
                            </Select>
                        </Field>

                        {draft.type === 'PAGE' && (
                            <Field label={m.page} required hint={pages.length === 0 ? m.noPages : undefined}>
                                <Select
                                    value={draft.page_id}
                                    onChange={(event) => setDraft({ ...draft, page_id: event.target.value })}
                                >
                                    <option value="">{m.choosePage}</option>
                                    {pages.map((page) => (
                                        <option key={page.id} value={page.id}>
                                            {page.title}
                                            {page.status === 'PUBLISHED' ? '' : ` (${t.storefront.pages.draft})`}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}

                        {draft.type === 'INTERNAL' && (
                            <Field label={m.destination} required>
                                <Select
                                    value={draft.url}
                                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                                >
                                    <option value="/">{m.destHome}</option>
                                    <option value="/shop">{m.destShop}</option>
                                    <option value="/blog">{m.destBlog}</option>
                                </Select>
                            </Field>
                        )}

                        {draft.type === 'EXTERNAL' && (
                            <>
                                <Field label={m.url} required>
                                    <Input
                                        type="url"
                                        value={draft.url}
                                        placeholder={m.urlPlaceholder}
                                        onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                                    />
                                </Field>
                                <label className="flex items-center gap-2 text-sm text-gray-800">
                                    <Checkbox
                                        checked={draft.open_in_new_tab}
                                        onChange={(event) =>
                                            setDraft({ ...draft, open_in_new_tab: event.target.checked })
                                        }
                                    />
                                    {m.openInNewTab}
                                </label>
                            </>
                        )}

                        <label className="flex items-center gap-2 text-sm text-gray-800">
                            <Checkbox
                                checked={draft.visible}
                                onChange={(event) => setDraft({ ...draft, visible: event.target.checked })}
                            />
                            {m.visible}
                        </label>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={save} loading={saving}>
                            {m.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            <ConfirmDialog
                open={Boolean(confirmRemove)}
                title={m.removeTitle}
                prompt={m.removeConfirm}
                confirmLabel={m.remove}
                cancelLabel={t.common.cancel}
                danger
                loading={saving}
                onConfirm={remove}
                onCancel={() => setConfirmRemove(null)}
            />
        </PageShell>
    );
}
