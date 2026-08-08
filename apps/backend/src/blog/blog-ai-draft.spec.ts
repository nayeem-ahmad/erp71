import { InternalServerErrorException } from '@nestjs/common';
import { buildBlogDraftPrompt, normalizeBlogDraft } from './blog-ai-draft';

const CATEGORIES = [
    { id: 'cat-1', name: 'Inventory' },
    { id: 'cat-2', name: 'Product Updates' },
];

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
    it('returns the text fields trimmed', () => {
        const draft = normalizeBlogDraft(reply({ title: '  Cutting dead stock  ' }), {
            categories: CATEGORIES,
            includeAudience: true,
        });

        expect(draft.title).toBe('Cutting dead stock');
        expect(draft.body_md).toContain('Why it matters');
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

        expect(draft.excerpt).toBeUndefined();
        expect(draft.seo_title).toBeUndefined();
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

        expect(draft.title).toBe('Cutting dead stock');
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
