'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, Pencil, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, Checkbox, ConfirmDialog } from '@/components/ui';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import AiDraftModal from '@/components/blog/AiDraftModal';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { getLocaleConfig } from '@/lib/localization/config';
import { toast } from '@/lib/toast';
import { ENABLED_LOCALE_CODES, type SupportedLocaleCode } from '@erp71/shared-types';

const LOCALES = ENABLED_LOCALE_CODES;
type Locale = SupportedLocaleCode;

function languageName(code: string): string {
    return getLocaleConfig(code as Locale).nativeLabel;
}

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
    // What an overwrite confirm would apply. `kind` decides the wording as well
    // as the handler: a generation also rewrites the post-level fields, a
    // translation only touches the language tabs it was asked for.
    const [aiPending, setAiPending] = useState<
        { kind: 'draft'; draft: any } | { kind: 'translation'; rows: any[] } | null
    >(null);
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
     * Replace whole language tabs at once.
     *
     * Separate from patchCurrent because the assistant fills languages the
     * author is not looking at, and one setState per locale would drop all but
     * the last — they would each start from the same stale array.
     */
    function patchTranslations(rows: any[]) {
        setTranslations((existing) => {
            const next = [...existing];
            for (const row of rows) {
                const filled: Translation = {
                    locale: row.locale,
                    title: row.title ?? '',
                    excerpt: row.excerpt ?? '',
                    body_md: row.body_md ?? '',
                    seo_title: row.seo_title ?? '',
                    seo_description: row.seo_description ?? '',
                };
                const index = next.findIndex((item) => item.locale === row.locale);
                if (index >= 0) next[index] = filled;
                else next.push(filled);
            }
            return next;
        });
    }

    /** Whether any of these language tabs would lose words if overwritten. */
    function writtenIn(codes: string[]): boolean {
        return translations.some(
            (row) =>
                codes.includes(row.locale) &&
                (row.title.trim() || row.excerpt.trim() || row.body_md.trim()),
        );
    }

    /**
     * Post-level fields a generation rewrites regardless of which tab is open.
     * Only meaningful on a saved post — on a new one they are still at their
     * defaults and there is nothing to lose.
     */
    function postFieldsSet(): boolean {
        return !!(
            postId &&
            (slug.trim() ||
                categoryId ||
                audience !== 'BOTH' ||
                authorName.trim() ||
                authorTitle.trim() ||
                coverAlt.trim() ||
                featured)
        );
    }

    /** Open the tab that just changed, so the author sees what arrived. */
    function focusFirst(rows: any[]) {
        const first = rows.find((row) => (LOCALES as readonly string[]).includes(row.locale));
        if (first) setLocale(first.locale as Locale);
    }

    /**
     * Each extra language is its own round-trip, so one can fail while the
     * others land. Naming the ones that failed is the difference between "retry
     * Malay" and wondering why a tab is still empty.
     */
    function reportFailures(failed?: string[]) {
        if (!failed?.length) return;
        toast.error(formatMessage(e.ai.someFailed, { languages: failed.map(languageName).join(', ') }));
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
     * saves through the normal button. Every language the assistant returned is
     * patched; the post-level fields (slug, category, audience, author,
     * featured) belong to the post rather than to a language and are applied
     * once.
     */
    function applyDraft(draft: any) {
        const rows = draft.translations ?? [];
        patchTranslations(rows);

        if (draft.slug) setSlug(draft.slug);
        setCategoryId(draft.category_id ?? '');
        if (draft.audience) setAudience(draft.audience);
        if (draft.author_name) setAuthorName(draft.author_name);
        if (draft.author_title) setAuthorTitle(draft.author_title);
        if (draft.cover_alt) setCoverAlt(draft.cover_alt);
        setFeatured(!!draft.featured);

        focusFirst(rows);
        toast.success(e.ai.filled);
    }

    /**
     * A translation is copy and nothing else. The slug, category, audience and
     * cover are the post's, shared by every language, so translating must leave
     * them exactly as the author set them.
     */
    function applyTranslations(rows: any[]) {
        patchTranslations(rows);
        focusFirst(rows);
        toast.success(e.ai.translated);
    }

    async function generateDraft(locales?: string[]) {
        const targets = locales?.length ? locales : [locale];
        setAiLoading(true);
        try {
            const draft = await api.draftAdminBlogPost({ prompt: aiPrompt, locales: targets });
            setAiOpen(false);
            reportFailures(draft?.failed_locales);

            // Confirm only once there is something to apply — a cancelled
            // overwrite should not also have thrown the generation away.
            // For an existing post, applyDraft also overwrites the post-level
            // fields (slug, category, audience, author, featured) unconditionally,
            // so any of those already holding a value counts as content too —
            // not just the language tabs being filled.
            const rows = draft?.translations ?? [];
            if (writtenIn(rows.map((row: any) => row.locale)) || postFieldsSet()) {
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
     * Carry a language tab the author has already written into the others.
     *
     * The copy travels from the editor rather than from the saved post, so this
     * works on an unsaved draft — which is when an author is most likely to
     * want it.
     */
    async function translateDraft({ source, targets }: { source: string; targets: string[] }) {
        const row = translations.find((item) => item.locale === source);
        if (!row?.title.trim() || !row.body_md.trim()) {
            toast.error(e.ai.sourceEmpty);
            return;
        }

        setAiLoading(true);
        try {
            const result = await api.translateAdminBlogPost({
                source_locale: source,
                target_locales: targets,
                title: row.title,
                body_md: row.body_md,
                excerpt: row.excerpt || undefined,
                seo_title: row.seo_title || undefined,
                seo_description: row.seo_description || undefined,
            });
            setAiOpen(false);
            reportFailures(result?.failed_locales);

            const rows = result?.translations ?? [];
            if (!rows.length) return;

            // Only the target tabs can be overwritten here — a translation
            // never touches the post-level fields a generation rewrites.
            if (writtenIn(rows.map((item: any) => item.locale))) {
                setAiPending({ kind: 'translation', rows });
                return;
            }

            applyTranslations(rows);
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
                                    {!filled && <span className="ms-1 text-gray-400">·</span>}
                                </button>
                            );
                        })}
                        <span className="ms-auto flex items-center gap-1">
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
                    modeWrite: e.ai.modeWrite,
                    modeTranslate: e.ai.modeTranslate,
                    languages: e.ai.languages,
                    languagesHint: e.ai.languagesHint,
                    translateFrom: e.ai.translateFrom,
                    translateInto: e.ai.translateInto,
                    translateAction: e.ai.translateAction,
                    translateHint: e.ai.translateHint,
                    nothingToTranslate: e.ai.nothingToTranslate,
                    alreadyWritten: e.ai.alreadyWritten,
                }}
                languages={{
                    options: LOCALES.map((code) => ({
                        code,
                        label: languageName(code),
                        filled: translations.some(
                            (row) => row.locale === code && !!row.title.trim() && !!row.body_md.trim(),
                        ),
                    })),
                    current: locale,
                }}
                onPromptChange={setAiPrompt}
                onClose={() => setAiOpen(false)}
                onGenerate={generateDraft}
                onTranslate={translateDraft}
            />

            <ConfirmDialog
                open={!!aiPending}
                title={e.ai.overwriteTitle}
                prompt={aiPending?.kind === 'translation' ? e.ai.overwriteTranslationPrompt : e.ai.overwritePrompt}
                confirmLabel={e.ai.replace}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setAiPending(null)}
                onConfirm={() => {
                    const pending = aiPending;
                    setAiPending(null);
                    if (!pending) return;
                    if (pending.kind === 'translation') applyTranslations(pending.rows);
                    else applyDraft(pending.draft);
                }}
            />
        </div>
    );
}
