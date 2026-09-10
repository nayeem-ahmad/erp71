'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, Pencil, Sparkles, Trash2, Upload } from 'lucide-react';
import { ENABLED_LOCALE_CODES, hasPlanEntitlement, type SupportedLocaleCode } from '@erp71/shared-types';
import { Button, Checkbox, ConfirmDialog, Field, Input, Select, Textarea } from '@/components/ui';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import AiDraftModal from '@/components/blog/AiDraftModal';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { getLocaleConfig } from '@/lib/localization/config';
import { toast } from '@/lib/toast';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { resolveTenantPlanFeatures } from '@/lib/plan-entitlements';

type Category = { id: string; name: string };

function languageName(code: string): string {
    return getLocaleConfig(code as SupportedLocaleCode).nativeLabel;
}

/**
 * A shop's post editor.
 *
 * Single-language, unlike the platform editor: a shop writes in whichever
 * language it speaks to its own customers in, and asking a corner-shop owner to
 * maintain three translations of a sale announcement would leave the feature
 * unused. The platform blog carries translations because it addresses the whole
 * customer base at once.
 *
 * Which is not the same as being stuck in one language. A shop that drafted in
 * Bangla and wants to speak to its English-reading customers can have the AI
 * Assistant turn the post it has into another language; because the post keeps
 * one copy, that rewrites it rather than adding a tab, so it goes through the
 * same replace-confirm a generation does.
 */
export default function TenantPostEditor({ postId }: { postId?: string }) {
    const { t, locale } = useI18n();
    const m = t.storefront.blog;
    const router = useRouter();
    const { aiChat: aiChatEnabled } = usePlatformFeatures();
    const { planCode, features: rawPlanFeatures } = useTenantPlanFeatures();
    // Same two gates as every other AI feature (see (app)/layout.tsx): the
    // platform kill switch and the plan entitlement. The server already
    // enforces the entitlement via enforceCredits, but showing the button to
    // every non-premium shop means the failure only surfaces after the owner
    // has typed a brief and pressed Generate.
    const canUseAi = aiChatEnabled && hasPlanEntitlement(resolveTenantPlanFeatures(planCode, rawPlanFeatures), 'premiumAi');

    const [tab, setTab] = useState<'write' | 'preview'>('write');
    const [title, setTitle] = useState('');
    const [excerpt, setExcerpt] = useState('');
    const [body, setBody] = useState('');
    const [slug, setSlug] = useState('');
    const [status, setStatus] = useState('DRAFT');
    const [categoryId, setCategoryId] = useState('');
    const [seoTitle, setSeoTitle] = useState('');
    const [seoDescription, setSeoDescription] = useState('');
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [coverAlt, setCoverAlt] = useState('');
    const [authorName, setAuthorName] = useState('');
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
    // What the assistant produced and is waiting to be allowed to apply. A
    // generation rewrites the post-level fields too; a translation only the
    // words — so the confirm has to know which it is holding.
    const [aiPending, setAiPending] = useState<
        { kind: 'draft'; draft: any } | { kind: 'translation'; copy: any; locale: string } | null
    >(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        api.getTenantBlogCategories()
            .then((data) => setCategories(Array.isArray(data) ? data : []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        if (!postId) return;
        let cancelled = false;

        api.getTenantBlogPost(postId)
            .then((post) => {
                if (cancelled || !post) return;
                setTitle(post.title ?? '');
                setExcerpt(post.excerpt ?? '');
                setBody(post.body_md ?? '');
                setSlug(post.slug ?? '');
                setStatus(post.status ?? 'DRAFT');
                setCategoryId(post.category_id ?? '');
                setSeoTitle(post.seo_title ?? '');
                setSeoDescription(post.seo_description ?? '');
                setCoverUrl(post.cover_image_url ?? null);
                setCoverAlt(post.cover_alt ?? '');
                setAuthorName(post.author_name ?? '');
                setFeatured(!!post.featured);
                setScheduledFor(post.scheduled_for ? String(post.scheduled_for).slice(0, 16) : '');
            })
            .catch((error) => toast.error((error as Error).message))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [postId]);

    async function save() {
        if (!title.trim() || !body.trim()) return;
        setSaving(true);
        try {
            const payload = {
                title,
                body_md: body,
                excerpt: excerpt || undefined,
                slug: slug || undefined,
                category_id: categoryId || null,
                seo_title: seoTitle || undefined,
                seo_description: seoDescription || undefined,
                cover_alt: coverAlt || undefined,
                author_name: authorName || undefined,
                featured,
                mark_edited: markEdited,
                scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
            };

            if (postId) {
                await api.updateTenantBlogPost(postId, payload);
                setMarkEdited(false);
                toast.success(m.saved);
            } else {
                const created = await api.createTenantBlogPost(payload);
                toast.success(m.saved);
                router.push(`/settings/blog/${created.id}`);
            }
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    /**
     * Fills the fields for review; nothing is written until the owner saves.
     *
     * One language: a shop's post has a single title and body, so the assistant
     * is asked for one and the first translation it returns is that one.
     */
    function applyDraft(draft: any) {
        const copy = draft?.translations?.[0] ?? {};
        setTitle(copy.title ?? '');
        setExcerpt(copy.excerpt ?? '');
        setBody(copy.body_md ?? '');
        setSeoTitle(copy.seo_title ?? '');
        setSeoDescription(copy.seo_description ?? '');
        if (draft.slug) setSlug(draft.slug);
        setCategoryId(draft.category_id ?? '');
        if (draft.author_name) setAuthorName(draft.author_name);
        if (draft.cover_alt) setCoverAlt(draft.cover_alt);
        setFeatured(!!draft.featured);

        toast.success(m.ai.filled);
    }

    /**
     * Swap the post's words for their translation.
     *
     * Only the words: the slug, category, cover, author and featured flag
     * belong to the post rather than to the language it is written in, and a
     * translation that rewrote the slug would break every link to the article.
     * An excerpt or SEO field the source did not have is cleared rather than
     * left behind in the old language.
     */
    function applyTranslation(copy: any) {
        setTitle(copy.title ?? '');
        setExcerpt(copy.excerpt ?? '');
        setBody(copy.body_md ?? '');
        setSeoTitle(copy.seo_title ?? '');
        setSeoDescription(copy.seo_description ?? '');

        toast.success(m.ai.translated);
    }

    async function generateDraft(locales?: string[]) {
        setAiLoading(true);
        try {
            const draft = await api.draftTenantBlogPost({ prompt: aiPrompt, locale: locales?.[0] ?? locale });
            setAiOpen(false);

            if (title.trim() || excerpt.trim() || body.trim()) {
                setAiPending({ kind: 'draft', draft });
                return;
            }

            applyDraft(draft);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setAiLoading(false);
        }
    }

    /**
     * Turn the post the owner is looking at into another language.
     *
     * The copy travels from the editor rather than from the saved post, so a
     * draft that has never been saved translates just as well — which is when
     * an author is most likely to want it. One target, because the post has one
     * body for the translation to land in.
     *
     * Always confirmed: unlike the platform editor, where a translation fills a
     * language tab that was empty, here it overwrites the only copy there is.
     */
    async function translateDraft({ source, targets }: { source: string; targets: string[] }) {
        const [target] = targets;
        if (!target) return;

        if (!title.trim() || !body.trim()) {
            toast.error(m.ai.sourceEmpty);
            return;
        }

        setAiLoading(true);
        try {
            const result = await api.translateTenantBlogPost({
                source_locale: source,
                target_locales: [target],
                title,
                body_md: body,
                excerpt: excerpt || undefined,
                seo_title: seoTitle || undefined,
                seo_description: seoDescription || undefined,
            });
            setAiOpen(false);

            const copy = result?.translations?.[0];
            if (copy) setAiPending({ kind: 'translation', copy, locale: target });
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setAiLoading(false);
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

    if (loading) return <p className="text-sm text-gray-500">{t.common.loading}</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href="/settings/blog" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {m.back}
                </Link>

                <div className="flex flex-wrap items-center gap-2">
                    {canUseAi && (
                        <Button
                            variant="secondary"
                            icon={<Sparkles className="h-4 w-4" />}
                            onClick={() => setAiOpen(true)}
                            disabled={saving}
                        >
                            {m.ai.button}
                        </Button>
                    )}
                    <Button variant="secondary" onClick={save} loading={saving} disabled={!title.trim() || !body.trim()}>
                        {m.save}
                    </Button>
                    {postId && status !== 'PUBLISHED' && (
                        <Button onClick={() => run(() => api.publishTenantBlogPost(postId), 'PUBLISHED')} disabled={saving}>
                            {m.publish}
                        </Button>
                    )}
                    {postId && status === 'PUBLISHED' && (
                        <Button
                            variant="secondary"
                            onClick={() => run(() => api.setTenantBlogPostStatus(postId, 'DRAFT'), 'DRAFT')}
                            disabled={saving}
                        >
                            {m.unpublish}
                        </Button>
                    )}
                    {postId && (
                        <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
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

                    <Field label={m.postTitle} required>
                        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                    </Field>

                    <Field label={m.excerpt}>
                        <Textarea rows={2} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} />
                    </Field>

                    {tab === 'write' ? (
                        <Field label={m.body} required>
                            <Textarea
                                rows={20}
                                className="font-mono text-xs"
                                value={body}
                                onChange={(event) => setBody(event.target.value)}
                            />
                        </Field>
                    ) : (
                        <div className="min-h-[20rem] rounded-md border border-gray-200 p-4">
                            <ArticleMarkdown content={body} />
                        </div>
                    )}
                </div>

                <aside className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={m.slug} hint={m.slugHint}>
                        <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
                    </Field>

                    <Field label={m.category}>
                        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                            <option value="">{m.noCategory}</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </Select>
                    </Field>

                    <Field label={m.scheduledFor}>
                        <Input
                            type="datetime-local"
                            value={scheduledFor}
                            onChange={(event) => setScheduledFor(event.target.value)}
                        />
                    </Field>

                    <Field label={m.author}>
                        <Input value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
                    </Field>

                    <div className="space-y-2 border-t border-gray-100 pt-3">
                        <span className="text-xs font-medium text-gray-700">{m.cover}</span>
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
                                if (file && postId) {
                                    void run(async () => {
                                        const updated = await api.uploadTenantBlogCover(postId, file);
                                        setCoverUrl(updated?.cover_image_url ?? null);
                                    });
                                }
                                event.target.value = '';
                            }}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                icon={<Upload className="h-3.5 w-3.5" />}
                                onClick={() => fileInput.current?.click()}
                                disabled={!postId || saving}
                            >
                                {m.uploadCover}
                            </Button>
                            {coverUrl && postId && (
                                <Button
                                    variant="ghost"
                                    onClick={() =>
                                        run(async () => {
                                            await api.removeTenantBlogCover(postId);
                                            setCoverUrl(null);
                                        })
                                    }
                                >
                                    {m.removeCover}
                                </Button>
                            )}
                        </div>
                        <Field label={m.coverAlt}>
                            <Input value={coverAlt} onChange={(event) => setCoverAlt(event.target.value)} />
                        </Field>
                    </div>

                    <div className="grid gap-3 border-t border-gray-100 pt-3">
                        <Field label={m.seoTitle}>
                            <Input value={seoTitle} onChange={(event) => setSeoTitle(event.target.value)} />
                        </Field>
                        <Field label={m.seoDescription}>
                            <Input value={seoDescription} onChange={(event) => setSeoDescription(event.target.value)} />
                        </Field>
                    </div>

                    <div className="space-y-2 border-t border-gray-100 pt-3">
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                            <Checkbox checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
                            {m.featured}
                        </label>
                        {postId && (
                            <label className="flex items-center gap-2 text-xs text-gray-700">
                                <Checkbox checked={markEdited} onChange={(event) => setMarkEdited(event.target.checked)} />
                                {m.markEdited}
                            </label>
                        )}
                    </div>
                </aside>
            </div>

            <ConfirmDialog
                open={confirmDelete}
                title={m.delete}
                prompt={m.deleteConfirm}
                confirmLabel={m.delete}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                    setConfirmDelete(false);
                    if (!postId) return;
                    await run(() => api.deleteTenantBlogPost(postId));
                    router.push('/settings/blog');
                }}
            />

            <AiDraftModal
                open={aiOpen}
                prompt={aiPrompt}
                loading={aiLoading}
                labels={{
                    modalTitle: m.ai.modalTitle,
                    promptLabel: m.ai.promptLabel,
                    promptPlaceholder: m.ai.promptPlaceholder,
                    generate: m.ai.generate,
                    cancel: t.common.cancel,
                    modeWrite: m.ai.modeWrite,
                    modeTranslate: m.ai.modeTranslate,
                    translateFrom: m.ai.translateFrom,
                    translateInto: m.ai.translateInto,
                    translateAction: m.ai.translateAction,
                    translateHint: m.ai.translateHint,
                    nothingToTranslate: m.ai.nothingToTranslate,
                }}
                languages={{
                    // No `filled` flags: the post has one body, and only the
                    // owner knows which language they wrote it in.
                    options: ENABLED_LOCALE_CODES.map((code) => ({ code, label: languageName(code) })),
                    current: locale,
                    singleCopy: true,
                    hasCopy: !!title.trim() && !!body.trim(),
                }}
                onPromptChange={setAiPrompt}
                onClose={() => setAiOpen(false)}
                onGenerate={generateDraft}
                onTranslate={translateDraft}
            />

            <ConfirmDialog
                open={!!aiPending}
                title={aiPending?.kind === 'translation' ? m.ai.translateTitle : m.ai.overwriteTitle}
                prompt={
                    aiPending?.kind === 'translation'
                        ? formatMessage(m.ai.translatePrompt, { language: languageName(aiPending.locale) })
                        : m.ai.overwritePrompt
                }
                confirmLabel={aiPending?.kind === 'translation' ? m.ai.translateAction : m.ai.replace}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setAiPending(null)}
                onConfirm={() => {
                    const pending = aiPending;
                    setAiPending(null);
                    if (!pending) return;
                    if (pending.kind === 'translation') applyTranslation(pending.copy);
                    else applyDraft(pending.draft);
                }}
            />
        </div>
    );
}
