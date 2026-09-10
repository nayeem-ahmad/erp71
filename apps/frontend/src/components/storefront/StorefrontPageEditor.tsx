'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Eye, Pencil, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Field, Input, StatusBadge, Textarea } from '@/components/ui';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { routes } from '@/lib/routes';

type StorefrontSettings = {
    storefront_slug: string | null;
    storefront_enabled: boolean;
};

/**
 * Editor for one of a shop's standing pages.
 *
 * Markdown rather than a rich-text field, and the same `ArticleMarkdown`
 * renderer the storefront itself uses for the preview — so what the owner sees
 * here is what a shopper gets, down to the heading sizes. Raw HTML is not
 * rendered on either side; see that component for why.
 */
export default function StorefrontPageEditor({ pageId }: { pageId?: string }) {
    const { t } = useI18n();
    const m = t.storefront.pages;
    const router = useRouter();

    const [tab, setTab] = useState<'write' | 'preview'>('write');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [slug, setSlug] = useState('');
    const [status, setStatus] = useState('DRAFT');
    const [seoTitle, setSeoTitle] = useState('');
    const [seoDescription, setSeoDescription] = useState('');

    const [storeSlug, setStoreSlug] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(Boolean(pageId));
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        fetchWithAuth('/tenants/storefront-settings')
            .then((settings: StorefrontSettings) => setStoreSlug(settings?.storefront_slug ?? null))
            .catch(() => setStoreSlug(null));
    }, []);

    useEffect(() => {
        if (!pageId) return;
        api.getStorefrontPage(pageId)
            .then((page: any) => {
                setTitle(page.title ?? '');
                setBody(page.body_md ?? '');
                setSlug(page.slug ?? '');
                setStatus(page.status ?? 'DRAFT');
                setSeoTitle(page.seo_title ?? '');
                setSeoDescription(page.seo_description ?? '');
            })
            .catch((error) => toast.error((error as Error).message))
            .finally(() => setLoading(false));
    }, [pageId]);

    function payload() {
        return {
            title: title.trim(),
            body_md: body,
            // Omitted on create so the server derives one from the title; an
            // empty string would be validated as a slug and rejected.
            slug: slug.trim() || undefined,
            seo_title: seoTitle.trim() || undefined,
            seo_description: seoDescription.trim() || undefined,
        };
    }

    async function save() {
        if (!title.trim()) {
            toast.error(m.titleRequired);
            return;
        }
        setSaving(true);
        try {
            if (pageId) {
                const updated = await api.updateStorefrontPage(pageId, payload());
                setSlug(updated.slug ?? slug);
                toast.success(m.saved);
            } else {
                const created = await api.createStorefrontPage(payload());
                toast.success(m.saved);
                router.push(routes.storefront.page(created.id));
            }
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function changeStatus(next: string) {
        if (!pageId) return;
        setSaving(true);
        try {
            const updated = await api.setStorefrontPageStatus(pageId, next);
            setStatus(updated.status ?? next);
            toast.success(m.saved);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!pageId) return;
        setSaving(true);
        try {
            await api.deleteStorefrontPage(pageId);
            toast.success(m.deleted);
            router.push(routes.storefront.pages);
        } catch (error) {
            toast.error((error as Error).message);
            setSaving(false);
        } finally {
            setConfirmDelete(false);
        }
    }

    if (loading) return <p className="text-sm text-gray-500">{t.common.loading}</p>;

    const publicHref = storeSlug && slug ? `/store/${storeSlug}/pages/${slug}` : null;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                    href={routes.storefront.pages}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {m.back}
                </Link>

                <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={status === 'PUBLISHED' ? 'success' : 'neutral'}>
                        {status === 'PUBLISHED' ? m.published : m.draft}
                    </StatusBadge>
                    <Button variant="secondary" onClick={save} loading={saving} disabled={!title.trim()}>
                        {m.save}
                    </Button>
                    {pageId && status !== 'PUBLISHED' && (
                        <Button onClick={() => changeStatus('PUBLISHED')} disabled={saving || !body.trim()}>
                            {m.publish}
                        </Button>
                    )}
                    {pageId && status === 'PUBLISHED' && (
                        <Button variant="secondary" onClick={() => changeStatus('DRAFT')} disabled={saving}>
                            {m.unpublish}
                        </Button>
                    )}
                    {pageId && (
                        <Button
                            variant="danger"
                            icon={<Trash2 className="h-4 w-4" />}
                            onClick={() => setConfirmDelete(true)}
                        >
                            {m.delete}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="flex items-center justify-end gap-1 border-b border-gray-100 pb-3">
                        <Button
                            variant={tab === 'write' ? 'secondary' : 'ghost'}
                            icon={<Pencil className="h-3.5 w-3.5" />}
                            onClick={() => setTab('write')}
                        >
                            {m.write}
                        </Button>
                        <Button
                            variant={tab === 'preview' ? 'secondary' : 'ghost'}
                            icon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => setTab('preview')}
                        >
                            {m.preview}
                        </Button>
                    </div>

                    <Field label={m.pageTitle} required>
                        <Input
                            value={title}
                            placeholder={m.titlePlaceholder}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </Field>

                    {tab === 'write' ? (
                        <Field label={m.body}>
                            <Textarea
                                rows={20}
                                className="font-mono text-xs"
                                value={body}
                                onChange={(event) => setBody(event.target.value)}
                            />
                        </Field>
                    ) : (
                        <div className="min-h-[20rem] rounded-md border border-gray-200 p-4">
                            {body.trim() ? (
                                <ArticleMarkdown content={body} />
                            ) : (
                                <p className="text-sm text-gray-400">{m.emptyPreview}</p>
                            )}
                        </div>
                    )}
                </div>

                <aside className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={m.slug} hint={m.slugHint}>
                        <Input
                            value={slug}
                            onChange={(event) =>
                                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120))
                            }
                        />
                    </Field>

                    {publicHref && status === 'PUBLISHED' && (
                        <a
                            href={publicHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                            {m.view}
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}

                    <Field label={m.seoTitle}>
                        <Input value={seoTitle} onChange={(event) => setSeoTitle(event.target.value)} />
                    </Field>

                    <Field label={m.seoDescription}>
                        <Textarea
                            rows={3}
                            value={seoDescription}
                            onChange={(event) => setSeoDescription(event.target.value)}
                        />
                    </Field>
                </aside>
            </div>

            <ConfirmDialog
                open={confirmDelete}
                title={m.deleteTitle}
                prompt={m.deleteConfirm}
                confirmLabel={m.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={saving}
                onConfirm={remove}
                onCancel={() => setConfirmDelete(false)}
            />
        </div>
    );
}
