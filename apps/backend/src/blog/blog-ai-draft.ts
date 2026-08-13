import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { extractJson } from '../ai/extract-json';
import { slugify } from './blog-slug';
import { BLOG_AUDIENCES, BlogAudience } from './blog-status';

/**
 * The prompt and reply contract for the editors' AI Assistant, shared by the
 * platform blog and the tenant storefront blog.
 *
 * Pure on purpose. The interesting part of this feature is not the HTTP call —
 * it is what happens to a reply that names a category which does not exist, or
 * invents an audience, or writes a slug with spaces in it. Every one of those
 * paths is a unit test here rather than something you find out about in
 * production, and neither service has to be instantiated to run them.
 */

export type BlogAiDraftCategory = { id: string; name: string };

/**
 * One language's copy.
 *
 * The unit both halves of the feature deal in: a generation returns one per
 * requested language, a translation returns one per target language, and the
 * editor patches its locale tabs from either without caring which produced it.
 */
export type BlogAiTranslation = {
    locale: string;
    title: string;
    body_md: string;
    excerpt?: string;
    seo_title?: string;
    seo_description?: string;
};

export type BlogAiDraft = {
    /** In requested order — the first is the one written from the brief. */
    translations: BlogAiTranslation[];
    /** null rather than undefined: the editor clears a stale category with it. */
    category_id: string | null;
    featured: boolean;
    slug?: string;
    cover_alt?: string;
    author_name?: string;
    author_title?: string;
    /** Platform blog only. */
    audience?: string;
    /**
     * Extra languages whose round-trip failed. Present only when something was
     * lost, so the editor can name them rather than quietly returning fewer
     * languages than were asked for.
     */
    failed_locales?: string[];
};

/**
 * A 600–1000 word body is the bulk of the reply, so the 512-token default that
 * suits a one-paragraph narration would truncate the JSON mid-string and fail
 * the parse.
 */
export const BLOG_DRAFT_MAX_TOKENS = 3000;

/**
 * Higher than the generation cap because a translation's length is set by its
 * source, not by an instruction the model follows: the author may be
 * translating a hand-written 2000-word post, and Bangla and Malay both use more
 * tokens than the English they came from. A truncated reply is unparseable, so
 * the ceiling is the cheapest thing to be generous with.
 */
export const BLOG_TRANSLATION_MAX_TOKENS = 6000;

/**
 * The languages the assistant can write in, and what to call them in a prompt.
 *
 * Doubles as the locale registry for this module — `resolveDraftLocales` and
 * `resolveTranslationTargets` accept exactly these keys. A spec pins it against
 * `BLOG_LOCALES` so the two cannot drift.
 */
export const BLOG_AI_LANGUAGES: Record<string, string> = {
    en: 'English',
    bn: 'Bangla (Bengali)',
    ms: 'Malay (Bahasa Melayu)',
};

const DEFAULT_LOCALE = 'en';

function languageName(locale: string): string {
    return BLOG_AI_LANGUAGES[locale] ?? BLOG_AI_LANGUAGES[DEFAULT_LOCALE];
}

function clean(locales: string[]): string[] {
    const known = locales
        .map((locale) => (typeof locale === 'string' ? locale.trim().toLowerCase() : ''))
        .filter((locale) => locale in BLOG_AI_LANGUAGES);
    return [...new Set(known)];
}

/**
 * The languages one generate request should fill, in order.
 *
 * The first is written from the brief and the rest are translated from it, so
 * order is meaningful: it decides which language the model composes in and
 * which ones inherit that structure. `locales` wins when it carries anything —
 * `locale` is the single-language field the tenant editor still sends.
 */
export function resolveDraftLocales(input: { locale?: string; locales?: string[] }): string[] {
    const requested = input.locales?.length ? input.locales : input.locale ? [input.locale] : [];
    const resolved = clean(requested);
    return resolved.length ? resolved : [DEFAULT_LOCALE];
}

/**
 * The languages a translate request should produce.
 *
 * The source is dropped rather than translated into itself — the editor does
 * not offer it, but a request that asks for it would otherwise spend a
 * round-trip to overwrite the author's own words with a paraphrase of them.
 */
export function resolveTranslationTargets(sourceLocale: string, targets: string[]): string[] {
    const source = typeof sourceLocale === 'string' ? sourceLocale.trim().toLowerCase() : '';
    const resolved = clean(targets ?? []).filter((locale) => locale !== source);

    if (!resolved.length) {
        throw new BadRequestException('Choose at least one other language to translate into.');
    }
    return resolved;
}

export function buildBlogDraftPrompt(options: {
    prompt: string;
    locale: string;
    categories: BlogAiDraftCategory[];
    includeAudience: boolean;
}): { systemPrompt: string; userMessage: string } {
    const language = languageName(options.locale);
    const categoryNames = options.categories.map((row) => row.name).join(', ');

    const audienceRule = options.includeAudience
        ? '\n- "audience" is where the post is served: "PUBLIC" for a marketing article on the public website, "IN_APP" for release notes only existing users care about, "BOTH" when it suits both.'
        : '';

    const audienceField = options.includeAudience ? '\n  "audience": "PUBLIC" | "IN_APP" | "BOTH",' : '';

    const systemPrompt = [
        'You are a content writer for ERP71, a retail management platform used by small and medium retailers in Bangladesh.',
        `Write one complete blog post from the author's brief. Write every field in ${language}.`,
        'Money is in Bangladeshi taka — write amounts as ৳1,200.',
        '',
        'Rules:',
        '- "body_md" is Markdown, 600–1000 words. Open with a short paragraph, not a heading. Use ## subheadings, short paragraphs and lists. Do not repeat the title as a heading inside the body.',
        '- "excerpt" is one or two sentences, at most 300 characters.',
        '- "seo_title" is at most 60 characters; "seo_description" at most 155.',
        '- "slug" is lowercase ASCII words separated by hyphens, derived from an English rendering of the title even when the post is not in English.',
        `- "category" must be exactly one of these names, or null if none fits: ${categoryNames || '(no categories exist yet — use null)'}.`,
        '- "cover_alt" describes the photograph that should sit at the top of the post.',
        '- "featured" is true only for a post worth pinning to the top of the index.',
        audienceRule,
        '',
        'Reply with JSON and nothing else — no explanation, no code fence. Use exactly this shape:',
        '{',
        '  "title": string,',
        '  "excerpt": string,',
        '  "body_md": string,',
        '  "seo_title": string,',
        '  "seo_description": string,',
        '  "slug": string,',
        '  "cover_alt": string,',
        '  "category": string | null,',
        '  "author_name": string,',
        '  "author_title": string,',
        `  "featured": boolean${audienceField}`,
        '}',
    ]
        .filter((line) => line !== '')
        .join('\n');

    return { systemPrompt, userMessage: `Brief:\n${options.prompt}` };
}

/**
 * Ask for the same post in another language rather than a second post on the
 * same subject.
 *
 * The distinction is the whole point of this path: a post's translations sit
 * under one slug and one cover, so a Bangla tab that argues something the
 * English tab does not is a bug the reader sees. Nothing post-level is asked
 * for here either — slug, category, audience and cover belong to the post, and
 * a translation that renamed them would fight the tab the author came from.
 */
export function buildBlogTranslationPrompt(options: {
    source: BlogAiTranslation;
    targetLocale: string;
}): { systemPrompt: string; userMessage: string } {
    const from = languageName(options.source.locale);
    const to = languageName(options.targetLocale);

    const systemPrompt = [
        'You are a translator for ERP71, a retail management platform used by small and medium retailers in Bangladesh.',
        `Translate one blog post from ${from} into ${to}.`,
        'Translate it — do not rewrite it, summarise it, expand it or add anything of your own.',
        '',
        'Rules:',
        '- Keep the Markdown structure of "body_md" exactly: the same headings, lists, links, emphasis and paragraph breaks, in the same order.',
        '- Translate for a shopkeeper reading it, not word by word — idioms should read naturally in the target language.',
        '- Leave URLs, code, numbers and product names as they are. ERP71 stays ERP71.',
        '- Money stays in Bangladeshi taka — keep amounts as ৳1,200.',
        '- "seo_title" is at most 60 characters; "seo_description" at most 155.',
        '- Return a field only if the source carries it. Never invent an excerpt or an SEO field the source does not have.',
        '',
        'Reply with JSON and nothing else — no explanation, no code fence. Use exactly this shape:',
        '{',
        '  "title": string,',
        '  "excerpt": string,',
        '  "body_md": string,',
        '  "seo_title": string,',
        '  "seo_description": string',
        '}',
    ].join('\n');

    // JSON rather than labelled sections: a body that itself contains a line
    // like "Title: ..." would otherwise be ambiguous about where a field ends.
    const source: Record<string, string> = {
        title: options.source.title,
        body_md: options.source.body_md,
    };
    for (const key of ['excerpt', 'seo_title', 'seo_description'] as const) {
        const value = text(options.source[key]);
        if (value) source[key] = value;
    }

    return { systemPrompt, userMessage: `Post to translate:\n${JSON.stringify(source, null, 2)}` };
}

export function normalizeBlogDraft(
    raw: string,
    options: { categories: BlogAiDraftCategory[]; includeAudience: boolean; locale?: string },
): BlogAiDraft {
    const parsed = extractJson<Record<string, unknown>>(raw);
    const title = text(parsed.title);

    const categoryName = text(parsed.category).toLowerCase();
    const category = categoryName
        ? options.categories.find((row) => row.name.trim().toLowerCase() === categoryName)
        : undefined;

    const draft: BlogAiDraft = {
        translations: [toTranslation(parsed, options.locale ?? DEFAULT_LOCALE)],
        category_id: category?.id ?? null,
        featured: parsed.featured === true,
    };

    assign(draft, 'cover_alt', text(parsed.cover_alt));
    assign(draft, 'author_name', text(parsed.author_name));
    assign(draft, 'author_title', text(parsed.author_title));

    // Falls back to the title, then to nothing at all: slugify() drops
    // non-ASCII, so a Bangla-only title yields '' and the create endpoint's
    // resolveSlug supplies the fallback rather than us sending an empty slug.
    assign(draft, 'slug', slugify(text(parsed.slug)) || slugify(title));

    if (options.includeAudience) {
        const audience = text(parsed.audience).toUpperCase();
        draft.audience = (BLOG_AUDIENCES as string[]).includes(audience) ? audience : BlogAudience.BOTH;
    }

    return draft;
}

export function normalizeBlogTranslation(raw: string, locale: string): BlogAiTranslation {
    const parsed = extractJson<Record<string, unknown>>(raw);
    return toTranslation(parsed, locale);
}

/**
 * A draft with no title or no body is not a post. Failing here leaves the
 * editor untouched, which is better than half-filling it — and on a
 * multi-language request it costs only the one language, since the caller
 * settles each translation separately.
 */
function toTranslation(parsed: Record<string, unknown>, locale: string): BlogAiTranslation {
    const title = text(parsed.title);
    const body = text(parsed.body_md);
    if (!title || !body) {
        throw new InternalServerErrorException('AI returned an invalid response. Please try again.');
    }

    const translation: BlogAiTranslation = { locale, title, body_md: body };
    assign(translation, 'excerpt', text(parsed.excerpt));
    assign(translation, 'seo_title', text(parsed.seo_title));
    assign(translation, 'seo_description', text(parsed.seo_description));
    return translation;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function assign<T extends object>(target: T, key: keyof T, value: string): void {
    if (value) (target as Record<string, unknown>)[key as string] = value;
}
