import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import {
    BLOG_AI_LANGUAGES,
    buildBlogDraftPrompt,
    buildBlogTranslationPrompt,
    normalizeBlogDraft,
    normalizeBlogTranslation,
    resolveDraftLocales,
    resolveTranslationTargets,
} from './blog-ai-draft';
import { BLOG_LOCALES } from './blog.dto';

const CATEGORIES = [
    { id: 'cat-1', name: 'Inventory' },
    { id: 'cat-2', name: 'Product Updates' },
];

const SOURCE = {
    locale: 'en',
    title: 'Cutting dead stock',
    body_md: '## Why it matters\n\nDead stock ties up working capital.',
    excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
    seo_title: 'Cutting dead stock',
    seo_description: 'How small shops free up cash tied in slow-moving stock.',
};

function reply(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        title: 'Cutting dead stock',
        excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
        body_md: '## Why it matters\n\nDead stock ties up working capital.',
        seo_title: 'Cutting dead stock',
        seo_description: 'How small shops free up cash tied in slow-moving stock.',
        slug: 'cutting-dead-stock',
        cover_alt: 'A shopkeeper counting stock on a shelf',
        category: 'Inventory',
        author_name: 'ERP71 Team',
        author_title: 'Retail Operations',
        featured: false,
        audience: 'PUBLIC',
        ...overrides,
    });
}

describe('buildBlogDraftPrompt', () => {
    it('names the target language so a bn tab comes back in Bangla', () => {
        const { systemPrompt } = buildBlogDraftPrompt({
            prompt: 'dead stock',
            locale: 'bn',
            categories: CATEGORIES,
            includeAudience: false,
        });

        expect(systemPrompt).toContain('Bangla');
    });

    it('lists the category names the model is allowed to choose from', () => {
        const { systemPrompt } = buildBlogDraftPrompt({
            prompt: 'dead stock',
            locale: 'en',
            categories: CATEGORIES,
            includeAudience: false,
        });

        expect(systemPrompt).toContain('Inventory');
        expect(systemPrompt).toContain('Product Updates');
    });

    it('asks for an audience only on the platform blog', () => {
        const platform = buildBlogDraftPrompt({
            prompt: 'dead stock',
            locale: 'en',
            categories: CATEGORIES,
            includeAudience: true,
        });
        const tenant = buildBlogDraftPrompt({
            prompt: 'dead stock',
            locale: 'en',
            categories: CATEGORIES,
            includeAudience: false,
        });

        expect(platform.systemPrompt).toContain('IN_APP');
        expect(tenant.systemPrompt).not.toContain('IN_APP');
    });

    it('carries the author brief in the user message, not the system prompt', () => {
        const { userMessage, systemPrompt } = buildBlogDraftPrompt({
            prompt: 'five ways to cut dead stock',
            locale: 'en',
            categories: CATEGORIES,
            includeAudience: false,
        });

        expect(userMessage).toContain('five ways to cut dead stock');
        expect(systemPrompt).not.toContain('five ways to cut dead stock');
    });
});

describe('normalizeBlogDraft', () => {
    it('returns the text fields trimmed, as the requested language', () => {
        const draft = normalizeBlogDraft(reply({ title: '  Cutting dead stock  ' }), {
            categories: CATEGORIES,
            includeAudience: true,
            locale: 'bn',
        });

        expect(draft.translations).toHaveLength(1);
        expect(draft.translations[0].locale).toBe('bn');
        expect(draft.translations[0].title).toBe('Cutting dead stock');
        expect(draft.translations[0].body_md).toContain('Why it matters');
    });

    it('files the copy under English when the caller names no locale', () => {
        const draft = normalizeBlogDraft(reply(), { categories: CATEGORIES, includeAudience: true });

        expect(draft.translations[0].locale).toBe('en');
    });

    it('maps a category name to its id, ignoring case', () => {
        const draft = normalizeBlogDraft(reply({ category: 'inventory' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.category_id).toBe('cat-1');
    });

    // An invented category name must never become a foreign key. Null lands the
    // post in "No category", which the author can fix in one click.
    it('drops a category name that does not exist', () => {
        const draft = normalizeBlogDraft(reply({ category: 'Marketing Tips' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.category_id).toBeNull();
    });

    it('accepts null for the category', () => {
        const draft = normalizeBlogDraft(reply({ category: null }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.category_id).toBeNull();
    });

    it('keeps the real audience values', () => {
        for (const audience of ['PUBLIC', 'IN_APP', 'BOTH']) {
            const draft = normalizeBlogDraft(reply({ audience }), {
                categories: CATEGORIES,
                includeAudience: true,
            });

            expect(draft.audience).toBe(audience);
        }
    });

    it('falls back to BOTH on an audience it does not recognise', () => {
        const draft = normalizeBlogDraft(reply({ audience: 'EVERYONE' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.audience).toBe('BOTH');
    });

    it('omits the audience entirely for the tenant blog', () => {
        const draft = normalizeBlogDraft(reply(), { categories: CATEGORIES, includeAudience: false });

        expect(draft.audience).toBeUndefined();
    });

    it('normalizes a slug the model wrote loosely', () => {
        const draft = normalizeBlogDraft(reply({ slug: 'Cutting Dead Stock!' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.slug).toBe('cutting-dead-stock');
    });

    it('derives the slug from the title when the model omits one', () => {
        const draft = normalizeBlogDraft(reply({ slug: '' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.slug).toBe('cutting-dead-stock');
    });

    it('falls back to the title when the model writes a slug that cannot be slugified', () => {
        const draft = normalizeBlogDraft(reply({ slug: 'মজুদ-কমানো' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.slug).toBe('cutting-dead-stock');
    });

    // slugify() drops non-ASCII rather than transliterating it, so a Bangla
    // title yields ''. Omitting the field lets the backend's resolveSlug pick a
    // fallback instead of the editor sending an empty slug.
    it('omits the slug when neither the slug nor the title has ASCII', () => {
        const draft = normalizeBlogDraft(reply({ slug: '', title: 'মজুদ কমানো' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.slug).toBeUndefined();
    });

    it('omits blank optional fields rather than sending empty strings', () => {
        const draft = normalizeBlogDraft(reply({ excerpt: '  ', seo_title: '', cover_alt: null }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.translations[0].excerpt).toBeUndefined();
        expect(draft.translations[0].seo_title).toBeUndefined();
        expect(draft.cover_alt).toBeUndefined();
    });

    it('coerces featured to a real boolean', () => {
        expect(
            normalizeBlogDraft(reply({ featured: 'yes' }), { categories: CATEGORIES, includeAudience: true }).featured,
        ).toBe(false);
        expect(
            normalizeBlogDraft(reply({ featured: true }), { categories: CATEGORIES, includeAudience: true }).featured,
        ).toBe(true);
    });

    it('parses a reply the model wrapped in a fence', () => {
        const draft = normalizeBlogDraft('```json\n' + reply() + '\n```', {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.translations[0].title).toBe('Cutting dead stock');
    });

    // A draft with no body is not a post. Failing here leaves the editor
    // untouched, which is better than half-filling it.
    it('rejects a reply with no body', () => {
        expect(() =>
            normalizeBlogDraft(reply({ body_md: '   ' }), { categories: CATEGORIES, includeAudience: true }),
        ).toThrow(InternalServerErrorException);
    });

    it('rejects a reply with no title', () => {
        expect(() =>
            normalizeBlogDraft(reply({ title: '' }), { categories: CATEGORIES, includeAudience: true }),
        ).toThrow(InternalServerErrorException);
    });
});

describe('locale registry', () => {
    // The prompt module is the one that decides which locales the assistant
    // accepts, and the DTO is the one that decides which the API accepts. A
    // language added to one and not the other is either a 400 on a language the
    // editor offers, or a request that reaches the model and comes back English.
    it('covers exactly the locales the DTOs validate against', () => {
        expect(Object.keys(BLOG_AI_LANGUAGES).sort()).toEqual([...BLOG_LOCALES].sort());
    });
});

describe('resolveDraftLocales', () => {
    it('keeps the requested order — the first is the one written from the brief', () => {
        expect(resolveDraftLocales({ locales: ['bn', 'en', 'ms'] })).toEqual(['bn', 'en', 'ms']);
    });

    it('falls back to the single-locale field the shop editor sends', () => {
        expect(resolveDraftLocales({ locale: 'ms' })).toEqual(['ms']);
    });

    it('prefers the multi-locale field when both are present', () => {
        expect(resolveDraftLocales({ locale: 'en', locales: ['bn', 'ms'] })).toEqual(['bn', 'ms']);
    });

    it('defaults to English when nothing is asked for', () => {
        expect(resolveDraftLocales({})).toEqual(['en']);
        expect(resolveDraftLocales({ locales: [] })).toEqual(['en']);
    });

    // A duplicate would be a second full round-trip that overwrites the first
    // with a paraphrase of itself.
    it('drops duplicates and anything it cannot write', () => {
        expect(resolveDraftLocales({ locales: ['en', 'EN', ' en ', 'zz'] })).toEqual(['en']);
    });
});

describe('resolveTranslationTargets', () => {
    it('returns the requested targets', () => {
        expect(resolveTranslationTargets('en', ['bn', 'ms'])).toEqual(['bn', 'ms']);
    });

    // Translating a post into its own language spends a round-trip to replace
    // the author's words with a paraphrase of them.
    it('never translates a post into the language it came from', () => {
        expect(resolveTranslationTargets('en', ['en', 'bn'])).toEqual(['bn']);
    });

    it('rejects a request with nothing left to translate into', () => {
        expect(() => resolveTranslationTargets('en', ['en'])).toThrow(BadRequestException);
        expect(() => resolveTranslationTargets('en', ['zz'])).toThrow(BadRequestException);
    });
});

describe('buildBlogTranslationPrompt', () => {
    it('names both languages', () => {
        const { systemPrompt } = buildBlogTranslationPrompt({ source: SOURCE, targetLocale: 'ms' });

        expect(systemPrompt).toContain('English');
        expect(systemPrompt).toContain('Malay');
    });

    it('tells the model to translate rather than rewrite', () => {
        const { systemPrompt } = buildBlogTranslationPrompt({ source: SOURCE, targetLocale: 'bn' });

        expect(systemPrompt).toContain('do not rewrite');
        expect(systemPrompt).toContain('Markdown structure');
    });

    /**
     * The post-level fields are shared by every language: a translation that
     * renamed the slug or moved the post to another category would fight the
     * tab it was translated from.
     */
    it('asks for copy only — never the slug, category or audience', () => {
        const { systemPrompt } = buildBlogTranslationPrompt({ source: SOURCE, targetLocale: 'bn' });

        expect(systemPrompt).not.toContain('"slug"');
        expect(systemPrompt).not.toContain('"category"');
        expect(systemPrompt).not.toContain('IN_APP');
    });

    it('carries the author’s copy in the user message as JSON', () => {
        const { userMessage } = buildBlogTranslationPrompt({ source: SOURCE, targetLocale: 'bn' });
        const parsed = JSON.parse(userMessage.slice(userMessage.indexOf('{')));

        expect(parsed.title).toBe(SOURCE.title);
        expect(parsed.body_md).toBe(SOURCE.body_md);
        expect(parsed.seo_description).toBe(SOURCE.seo_description);
    });

    // An excerpt the author deliberately left blank should stay blank, not come
    // back invented in Bangla.
    it('leaves out the optional fields the source does not have', () => {
        const { userMessage } = buildBlogTranslationPrompt({
            source: { locale: 'en', title: SOURCE.title, body_md: SOURCE.body_md },
            targetLocale: 'bn',
        });
        const parsed = JSON.parse(userMessage.slice(userMessage.indexOf('{')));

        expect(Object.keys(parsed).sort()).toEqual(['body_md', 'title']);
    });
});

describe('normalizeBlogTranslation', () => {
    const translated = (overrides: Record<string, unknown> = {}) =>
        JSON.stringify({
            title: 'মজুদ কমানো',
            excerpt: 'তাকের উপর পড়ে থাকা মজুদ মানে আটকে থাকা টাকা।',
            body_md: '## কেন গুরুত্বপূর্ণ\n\nঅবিক্রীত মজুদ মূলধন আটকে রাখে।',
            seo_title: 'মজুদ কমানো',
            seo_description: 'ছোট দোকান কীভাবে আটকে থাকা টাকা মুক্ত করে।',
            ...overrides,
        });

    it('files the copy under the target locale', () => {
        const row = normalizeBlogTranslation(translated(), 'bn');

        expect(row.locale).toBe('bn');
        expect(row.title).toBe('মজুদ কমানো');
        expect(row.body_md).toContain('কেন গুরুত্বপূর্ণ');
    });

    it('omits optional fields the model left blank', () => {
        const row = normalizeBlogTranslation(translated({ excerpt: '   ', seo_title: null }), 'bn');

        expect(row.excerpt).toBeUndefined();
        expect(row.seo_title).toBeUndefined();
    });

    it('parses a reply the model wrapped in a fence', () => {
        expect(normalizeBlogTranslation('```json\n' + translated() + '\n```', 'bn').title).toBe('মজুদ কমানো');
    });

    // A truncated reply parses to something without a body. Failing here is what
    // lets the service report that one language back as failed instead of
    // patching an empty tab over the author's work.
    it('rejects a translation with no body', () => {
        expect(() => normalizeBlogTranslation(translated({ body_md: '' }), 'bn')).toThrow(
            InternalServerErrorException,
        );
    });
});
