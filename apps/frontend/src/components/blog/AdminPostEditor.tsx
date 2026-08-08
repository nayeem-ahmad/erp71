'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, Pencil, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, Checkbox, ConfirmDialog } from '@/components/ui';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import AiDraftModal from '@/components/blog/AiDraftModal';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

const LOCALES = ['en', 'bn', 'ms'] as const;
type Locale = (typeof LOCALES)[number];

type Translation = {
    locale: string;
    title: string;
    excerpt: string;
    body_md: string;
    seo_title: string;
    seo_description: string;
};

type Category = { id: string; name_en: string };

function blankTranslation(locale: string): Translation {
    return { locale, title: '', excerpt: '', body_md: '', seo_title: '', seo_description: '' };
}

/**
 * The authoring surface for a platform blog post.
 *
 * Markdown with a live preview rather than a WYSIWYG. A rich-text editor would
 * mean a new dependency, an HTML sanitizer on both ends and a stored format
 * that is harder to diff than prose; the repo already renders markdown safely
 * and the authors are staff.
 *
 * The locale switcher swaps which translation is being edited. Everything else
 * — slug, category, cover, audience — belongs to the post, not to a language,
 * so it stays put as the tab changes.
 */
export default function AdminPostEditor({ postId }: { postId?: string }) {
    const { t } = useI18n();
    const m = t.admin.blog;
    const e = m.editor;
    const router = useRouter();

    const [locale, setLocale] = useState<Locale>('en');
    const [tab, setTab] = useState<'write' | 'preview'>('write');
    const [translations, setTranslations] = useState<Translation[]>([blankTranslation('en')]);

    const [slug, setSlug] = useState('');
    const [status, setStatus] = useState('DRAFT');
    const [audience, setAudience] = useState('BOTH');
    const [categoryId, setCategoryId] = useState('');
    const [authorName, setAuthorName] = useState('');
    const [authorTitle, setAuthorTitle] = useState('');
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [coverAlt, setCoverAlt] = useState('');
    const [featured, setFeatured] = useState(false);
    const [markEdited, setMarkEdited] = useState(false);
    const [scheduledFor, setScheduledFor] = useState('');

    const [categories, setCategories] = useState<Category[]>([]);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!!postId);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiDraft, setAiDraft] = useState<any>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const current = useMemo(
        () => translations.find((row) => row.locale === locale) ?? blankTranslation(locale),
        [translations, locale],
    );

    useEffect(() => {
        api.getAdminBlogCategories()
            .then((data) => setCategories(Array.isArray(data) ? data : []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        if (!postId) return;
        let cancelled = false;

        api.getAdminBlogPost(postId)
            .then((post) => {
                if (cancelled || !post) return;
                setSlug(post.slug ?? '');
                setStatus(post.status ?? 'DRAFT');
                setAudience(post.audience ?? 'BOTH');
                setCategoryId(post.category_id ?? '');
                setAuthorName(post.author_name ?? '');
                setAuthorTitle(post.author_title ?? '');
                setCoverUrl(post.cover_image_url ?? null);
                setCoverAlt(post.cover_alt ?? '');
                setFeatured(!!post.featured);
                setScheduledFor(post.scheduled_for ? String(post.scheduled_for).slice(0, 16) : '');
                setTranslations(
                    (post.translations ?? []).map((row: any) => ({
                        locale: row.locale,
                        title: row.title ?? '',
                        excerpt: row.excerpt ?? '',
                        body_md: row.body_md ?? '',
                        seo_title: row.seo_title ?? '',
                        seo_description: row.seo_description ?? '',
                    })),
                );
            })
            .catch((error) => toast.error((error as Error).message))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [postId]);

    function patchCurrent(patch: Partial<Translation>) {
        setTranslations((rows) => {
            const existing = rows.find((row) => row.locale === locale);
            if (!existing) return [...rows, { ...blankTranslation(locale), ...patch }];
            return rows.map((row) => (row.locale === locale ? { ...row, ...patch } : row));
        });
    }

    /**
     * A locale the author opened but never typed into is dropped rather than
     * saved empty — an empty `bn` row would otherwise beat the English fallback
     * and serve a blank article to Bangla readers.
     */
    function payload() {
        const filled = translations.filter((row) => row.title.trim() || row.body_md.trim());
        return {
            slug: slug || undefined,
            audience,
            category_id: categoryId || null,
            cover_alt: coverAlt || undefined,
            author_name: authorName || undefined,
            author_title: authorTitle || undefined,
            featured,
            mark_edited: markEdited,
            scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
            translations: filled.map((row) => ({
                locale: row.locale,
                title: row.title,
                excerpt: row.excerpt || undefined,
                body_md: row.body_md,
                seo_title: row.seo_title || undefined,
                seo_description: row.seo_description || undefined,
            })),
        };
    }

    async function save() {
        const body = payload();
        if (!body.translations.some((row) => row.locale === 'en' && row.title.trim() && row.body_md.trim())) {
            toast.error(e.englishRequired);
            return;
        }

        setSaving(true);
        try {
            if (postId) {
                await api.updateAdminBlogPost(postId, body);
                setMarkEdited(false);
                toast.success(e.saved);
            } else {
                const created = await api.createAdminBlogPost(body);
                toast.success(e.saved);
                router.push(`/admin/blog/${created.id}`);
            }
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function run(action: () => Promise<any>, nextStatus?: string) {
        setSaving(true);
        try {
            await action();
            if (nextStatus) setStatus(nextStatus);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function uploadCover(file: File) {
        if (!postId) return;
        setSaving(true);
        try {
            const updated = await api.uploadAdminBlogCover(postId, file);
            setCoverUrl(updated?.cover_image_url ?? null);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    /**
     * Fills the fields but writes nothing — the author reviews in the form and
     * saves through the normal button. Only the open locale tab is patched,
     * because the request asked for that language; the post-level fields
     * (slug, category, audience, author, featured) belong to the post rather
     * than to a language and are always applied.
     */
    function applyDraft(draft: any) {
        patchCurrent({
            title: draft.title ?? '',
            excerpt: draft.excerpt ?? '',
            body_md: draft.body_md ?? '',
            seo_title: draft.seo_title ?? '',
            seo_description: draft.seo_description ?? '',
        });

        if (draft.slug) setSlug(draft.slug);
        setCategoryId(draft.category_id ?? '');
        if (draft.audience) setAudience(draft.audience);
        if (draft.author_name) setAuthorName(draft.author_name);
        if (draft.author_title) setAuthorTitle(draft.author_title);
        if (draft.cover_alt) setCoverAlt(draft.cover_alt);
        setFeatured(!!draft.featured);

        toast.success(e.ai.filled);
    }

    async function generateDraft() {
        setAiLoading(true);
        try {
            const draft = await api.draftAdminBlogPost({ prompt: aiPrompt, locale });
            setAiOpen(false);

            // Confirm only once there is something to apply — a cancelled
            // overwrite should not also have thrown the generation away.
            const hasContent = !!(current.title.trim() || current.excerpt.trim() || current.body_md.trim());
            if (hasContent) {
                setAiDraft(draft);
                return;
            }

            applyDraft(draft);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setAiLoading(false);
        }
    }

    if (loading) return <p className="text-sm text-gray-500">{t.common.loading}</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href="/admin/blog" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {e.back}
                </Link>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="secondary"
                        icon={<Sparkles className="h-4 w-4" />}
                        onClick={() => setAiOpen(true)}
                        disabled={saving}
                    >
                        {e.ai.button}
                    </Button>
                    <Button variant="secondary" onClick={save} loading={saving}>
                        {e.save}
                    </Button>
                    {postId && status !== 'PUBLISHED' && (
                        <Button onClick={() => run(() => api.publishAdminBlogPost(postId), 'PUBLISHED')} disabled={saving}>
                            {e.publish}
                        </Button>
                    )}
                    {postId && status === 'PUBLISHED' && (
                        <Button
                            variant="secondary"
                            onClick={() => run(() => api.unpublishAdminBlogPost(postId), 'DRAFT')}
                            disabled={saving}
                        >
                            {e.unpublish}
                        </Button>
                    )}
                    {postId && (
                        <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
                            {e.delete}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
                        {LOCALES.map((code) => {
                            const filled = translations.some(
                                (row) => row.locale === code && (row.title.trim() || row.body_md.trim()),
                            );
                            return (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => setLocale(code)}
                                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium max-md:min-h-touch ${
                                        locale === code ? 'bg-primary-light text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {code.toUpperCase()}
                                    {!filled && <span className="ml-1 text-gray-400">·</span>}
                                </button>
                            );
                        })}
                        <span className="ml-auto flex items-center gap-1">
                            <Button
                                variant={tab === 'write' ? 'secondary' : 'ghost'}
                                icon={<Pencil className="h-3.5 w-3.5" />}
                                onClick={() => setTab('write')}
                            >
                                {e.write}
                            </Button>
                            <Button
                                variant={tab === 'preview' ? 'secondary' : 'ghost'}
                                icon={<Eye className="h-3.5 w-3.5" />}
                                onClick={() => setTab('preview')}
                            >
                                {e.preview}
                            </Button>
                        </span>
                    </div>

                    <Field label={e.postTitle}>
                        <Input value={current.title} onChange={(event) => patchCurrent({ title: event.target.value })} />
                    </Field>

                    <Field label={e.excerpt}>
                        <Textarea
                            rows={2}
                            value={current.excerpt}
                            onChange={(event) => patchCurrent({ excerpt: event.target.value })}
                        />
                    </Field>

                    {tab === 'write' ? (
                        <Field label={e.body}>
                            <Textarea
                                rows={22}
                                className="font-mono text-xs"
                                value={current.body_md}
                                onChange={(event) => patchCurrent({ body_md: event.target.value })}
                            />
                        </Field>
                    ) : (
                        <div className="min-h-[24rem] rounded-md border border-gray-200 p-4">
                            <ArticleMarkdown content={current.body_md} />
                        </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={e.seoTitle}>
                            <Input value={current.seo_title} onChange={(event) => patchCurrent({ seo_title: event.target.value })} />
                        </Field>
                        <Field label={e.seoDescription}>
                            <Input
                                value={current.seo_description}
                                onChange={(event) => patchCurrent({ seo_description: event.target.value })}
                            />
                        </Field>
                    </div>
                </div>

                <aside className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={e.slug} hint={e.slugHint}>
                        <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
                    </Field>

                    <Field label={e.audience}>
                        <Select value={audience} onChange={(event) => setAudience(event.target.value)}>
                            {Object.entries(m.audience).map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </Select>
                    </Field>

                    <Field label={e.category}>
                        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                            <option value="">{e.noCategory}</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name_en}
                                </option>
                            ))}
                        </Select>
                    </Field>

                    <Field label={e.scheduledFor}>
                        <Input
                            type="datetime-local"
                            value={scheduledFor}
                            onChange={(event) => setScheduledFor(event.target.value)}
                        />
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={e.author}>
                            <Input value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
                        </Field>
                        <Field label={e.authorTitle}>
                            <Input value={authorTitle} onChange={(event) => setAuthorTitle(event.target.value)} />
                        </Field>
                    </div>

                    <div className="space-y-2 border-t border-gray-100 pt-3">
                        <span className="text-xs font-medium text-gray-700">{e.cover}</span>
                        {coverUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverUrl} alt="" className="w-full rounded-md border border-gray-200" />
                        )}
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void uploadCover(file);
                                event.target.value = '';
                            }}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                icon={<Upload className="h-3.5 w-3.5" />}
                                onClick={() => fileInput.current?.click()}
                                // Cover upload posts to the post's own endpoint,
                                // so it needs a saved post to attach to.
                                disabled={!postId || saving}
                            >
                                {e.uploadCover}
                            </Button>
                            {coverUrl && postId && (
                                <Button
                                    variant="ghost"
                                    onClick={() =>
                                        run(async () => {
                                            await api.removeAdminBlogCover(postId);
                                            setCoverUrl(null);
                                        })
                                    }
                                >
                                    {e.removeCover}
                                </Button>
                            )}
                        </div>
                        <Field label={e.coverAlt}>
                            <Input value={coverAlt} onChange={(event) => setCoverAlt(event.target.value)} />
                        </Field>
                    </div>

                    <div className="space-y-2 border-t border-gray-100 pt-3">
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                            <Checkbox checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
                            {e.featured}
                        </label>
                        {postId && (
                            <label className="flex items-center gap-2 text-xs text-gray-700">
                                <Checkbox checked={markEdited} onChange={(event) => setMarkEdited(event.target.checked)} />
                                {e.markEdited}
                            </label>
                        )}
                    </div>
                </aside>
            </div>

            <ConfirmDialog
                open={confirmDelete}
                title={e.delete}
                prompt={e.deleteConfirm}
                confirmLabel={e.delete}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                    setConfirmDelete(false);
                    if (!postId) return;
                    await run(() => api.deleteAdminBlogPost(postId));
                    router.push('/admin/blog');
                }}
            />

            <AiDraftModal
                open={aiOpen}
                prompt={aiPrompt}
                loading={aiLoading}
                labels={{
                    modalTitle: e.ai.modalTitle,
                    promptLabel: e.ai.promptLabel,
                    promptPlaceholder: e.ai.promptPlaceholder,
                    generate: e.ai.generate,
                    cancel: t.common.cancel,
                }}
                onPromptChange={setAiPrompt}
                onClose={() => setAiOpen(false)}
                onGenerate={generateDraft}
            />

            <ConfirmDialog
                open={!!aiDraft}
                title={e.ai.overwriteTitle}
                prompt={e.ai.overwritePrompt}
                confirmLabel={e.ai.generate}
                cancelLabel={t.common.cancel}
                onCancel={() => setAiDraft(null)}
                onConfirm={() => {
                    const draft = aiDraft;
                    setAiDraft(null);
                    applyDraft(draft);
                }}
            />
        </div>
    );
}
