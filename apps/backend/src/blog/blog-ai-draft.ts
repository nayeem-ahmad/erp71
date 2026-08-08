import { InternalServerErrorException } from '@nestjs/common';
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

export type BlogAiDraft = {
    title: string;
    body_md: string;
    /** null rather than undefined: the editor clears a stale category with it. */
    category_id: string | null;
    featured: boolean;
    excerpt?: string;
    seo_title?: string;
    seo_description?: string;
    slug?: string;
    cover_alt?: string;
    author_name?: string;
    author_title?: string;
    /** Platform blog only. */
    audience?: string;
};

/**
 * A 600–1000 word body is the bulk of the reply, so the 512-token default that
 * suits a one-paragraph narration would truncate the JSON mid-string and fail
 * the parse.
 */
export const BLOG_DRAFT_MAX_TOKENS = 3000;

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    bn: 'Bangla (Bengali)',
    ms: 'Malay (Bahasa Melayu)',
};

export function buildBlogDraftPrompt(options: {
    prompt: string;
    locale: string;
    categories: BlogAiDraftCategory[];
    includeAudience: boolean;
}): { systemPrompt: string; userMessage: string } {
    const language = LANGUAGE_NAMES[options.locale] ?? LANGUAGE_NAMES.en;
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

export function normalizeBlogDraft(
    raw: string,
    options: { categories: BlogAiDraftCategory[]; includeAudience: boolean },
): BlogAiDraft {
    const parsed = extractJson<Record<string, unknown>>(raw);

    const title = text(parsed.title);
    const body = text(parsed.body_md);
    if (!title || !body) {
        throw new InternalServerErrorException('AI returned an invalid response. Please try again.');
    }

    const categoryName = text(parsed.category).toLowerCase();
    const category = categoryName
        ? options.categories.find((row) => row.name.trim().toLowerCase() === categoryName)
        : undefined;

    const draft: BlogAiDraft = {
        title,
        body_md: body,
        category_id: category?.id ?? null,
        featured: parsed.featured === true,
    };

    assign(draft, 'excerpt', text(parsed.excerpt));
    assign(draft, 'seo_title', text(parsed.seo_title));
    assign(draft, 'seo_description', text(parsed.seo_description));
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

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function assign(draft: BlogAiDraft, key: keyof BlogAiDraft, value: string): void {
    if (value) (draft as Record<string, unknown>)[key] = value;
}
