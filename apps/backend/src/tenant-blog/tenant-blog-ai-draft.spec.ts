import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantBlogController } from './tenant-blog.controller';
import { BLOG_DRAFT_MAX_TOKENS } from '../blog/blog-ai-draft';
import { TenantBlogService } from './tenant-blog.service';

const REPLY = JSON.stringify({
    title: 'Eid hours',
    excerpt: 'We are open late through Eid week.',
    body_md: '## Our Eid hours\n\nWe open at 9am and close at 11pm.',
    seo_title: 'Eid hours',
    seo_description: 'Our opening hours through Eid week.',
    slug: 'eid-hours',
    cover_alt: 'A shopfront lit up in the evening',
    category: 'Announcements',
    author_name: 'Rahim Store',
    author_title: 'Owner',
    featured: true,
    audience: 'PUBLIC',
});

describe('TenantBlogService.draftWithAi', () => {
    const db = { tenantBlogCategory: { findMany: jest.fn() } } as any;
    const ai = {
        enforceCredits: jest.fn(),
        getDefaultModel: jest.fn(),
        completeUnbilled: jest.fn(),
        logUsage: jest.fn(),
    } as any;

    let service: TenantBlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        db.tenantBlogCategory.findMany.mockResolvedValue([{ id: 'cat-9', name: 'Announcements' }]);
        ai.enforceCredits.mockResolvedValue(undefined);
        ai.getDefaultModel.mockResolvedValue('anthropic/claude-haiku-4.5');
        ai.completeUnbilled.mockResolvedValue({
            text: REPLY,
            usage: { prompt_tokens: 20, completion_tokens: 900, total_tokens: 920 },
            model: 'anthropic/claude-haiku-4.5',
        });
        service = new TenantBlogService(db, {} as any, ai);
    });

    it('returns a normalized draft scoped to the tenant categories', async () => {
        const draft = await service.draftWithAi('tenant-1', { prompt: 'eid hours' });

        expect(draft.translations[0].title).toBe('Eid hours');
        expect(draft.category_id).toBe('cat-9');
        expect(db.tenantBlogCategory.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenant_id: 'tenant-1', deleted_at: null } }),
        );
    });

    it('writes in the language the shop asked for', async () => {
        await service.draftWithAi('tenant-1', { prompt: 'eid hours', locale: 'bn' });

        const [, systemPrompt] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('Bangla');
        expect((await service.draftWithAi('tenant-1', { prompt: 'eid hours', locale: 'bn' })).translations[0].locale)
            .toBe('bn');
    });

    /**
     * A shop's post stores one title and one body, so there is nowhere for a
     * second language to go. A request that asked for three would otherwise
     * spend three times the tenant's credits to produce two posts it has to
     * throw away.
     */
    it('writes one language even if the request asks for several', async () => {
        const draft = await service.draftWithAi('tenant-1', { prompt: 'eid hours', locales: ['bn', 'en', 'ms'] });

        expect(draft.translations).toHaveLength(1);
        expect(draft.translations[0].locale).toBe('bn');
        expect(ai.completeUnbilled).toHaveBeenCalledTimes(1);
        expect(ai.logUsage).toHaveBeenCalledTimes(1);
    });

    // A shop has no audience switch — the field does not exist on its posts, so
    // asking the model for one would waste tokens and confuse the reply.
    it('never asks for or returns an audience', async () => {
        const draft = await service.draftWithAi('tenant-1', { prompt: 'eid hours' });

        const [, systemPrompt] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).not.toContain('IN_APP');
        expect(draft.audience).toBeUndefined();
    });

    it('checks the credit balance before spending any', async () => {
        await service.draftWithAi('tenant-1', { prompt: 'eid hours' });

        expect(ai.enforceCredits).toHaveBeenCalledWith('tenant-1');
        expect(ai.enforceCredits.mock.invocationCallOrder[0]).toBeLessThan(
            ai.completeUnbilled.mock.invocationCallOrder[0],
        );
    });

    it('does not call the model when the tenant is out of credits', async () => {
        ai.enforceCredits.mockRejectedValue(new ForbiddenException('AI features are not included in your current plan.'));

        await expect(service.draftWithAi('tenant-1', { prompt: 'eid hours' })).rejects.toThrow(ForbiddenException);
        expect(ai.completeUnbilled).not.toHaveBeenCalled();
    });

    it('bills the tokens it spent to the tenant', async () => {
        await service.draftWithAi('tenant-1', { prompt: 'eid hours' });

        expect(ai.logUsage).toHaveBeenCalledWith(
            'tenant-1',
            'blog_post_draft',
            'anthropic/claude-haiku-4.5',
            expect.objectContaining({ total_tokens: 920 }),
        );
    });

    // The tokens were spent whether or not the reply parsed, so the usage row
    // has to be written before the draft is validated.
    it('bills the call even when the reply is unusable', async () => {
        ai.completeUnbilled.mockResolvedValue({
            text: 'Sure! Here is your post:',
            usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
            model: 'anthropic/claude-haiku-4.5',
        });

        await expect(service.draftWithAi('tenant-1', { prompt: 'eid hours' })).rejects.toThrow();
        expect(ai.logUsage).toHaveBeenCalled();
    });
});

describe('TenantBlogService.translateWithAi', () => {
    const TRANSLATED = JSON.stringify({
        title: 'ঈদের সময় দোকান খোলা',
        excerpt: 'ঈদের সপ্তাহজুড়ে আমরা রাত পর্যন্ত খোলা।',
        body_md: '## আমাদের ঈদের সময়\n\nসকাল ৯টা থেকে রাত ১১টা।',
        seo_title: 'ঈদের সময়',
        seo_description: 'ঈদের সপ্তাহে আমাদের খোলার সময়।',
    });

    const SOURCE = {
        source_locale: 'en',
        target_locales: ['bn'],
        title: 'Eid hours',
        body_md: '## Our Eid hours\n\nWe open at 9am and close at 11pm.',
        excerpt: 'We are open late through Eid week.',
    };

    const db = { tenantBlogCategory: { findMany: jest.fn() } } as any;
    const ai = {
        enforceCredits: jest.fn(),
        getDefaultModel: jest.fn(),
        completeUnbilled: jest.fn(),
        logUsage: jest.fn(),
    } as any;

    let service: TenantBlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        ai.enforceCredits.mockResolvedValue(undefined);
        ai.getDefaultModel.mockResolvedValue('anthropic/claude-haiku-4.5');
        ai.completeUnbilled.mockResolvedValue({
            text: TRANSLATED,
            usage: { prompt_tokens: 400, completion_tokens: 900, total_tokens: 1300 },
            model: 'anthropic/claude-haiku-4.5',
        });
        service = new TenantBlogService(db, {} as any, ai);
    });

    it('returns the post in the language that was asked for', async () => {
        const result = await service.translateWithAi('tenant-1', SOURCE);

        expect(result.translations).toHaveLength(1);
        expect(result.translations[0].locale).toBe('bn');
        expect(result.translations[0].title).toBe('ঈদের সময় দোকান খোলা');
    });

    it('asks for a translation rather than a fresh post', async () => {
        await service.translateWithAi('tenant-1', SOURCE);

        const [, systemPrompt, userMessage] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('Translate one blog post from English into Bangla');
        expect(systemPrompt).toContain('do not rewrite it');
        expect(userMessage).toContain('Eid hours');
        expect(db.tenantBlogCategory.findMany).not.toHaveBeenCalled();
    });

    /**
     * The prompt asks for copy and nothing else, but the endpoint has to be as
     * narrow as the prompt: a shop's post has one slug and one category, and a
     * translation that carried its own would fight the post it belongs to.
     */
    it('returns copy only — never a slug, category or featured flag', async () => {
        const result = await service.translateWithAi('tenant-1', SOURCE);

        expect(Object.keys(result)).toEqual(['translations']);
        expect(result.translations[0]).not.toHaveProperty('slug');
    });

    /**
     * A shop post has one body for a translation to land in. Three targets
     * would spend three times the credits to produce two copies with nowhere
     * to go — the same reason `draftWithAi` writes one language.
     */
    it('translates into one language even if the request asks for several', async () => {
        const result = await service.translateWithAi('tenant-1', {
            ...SOURCE,
            target_locales: ['bn', 'ms', 'ar'],
        });

        expect(result.translations).toHaveLength(1);
        expect(result.translations[0].locale).toBe('bn');
        expect(ai.completeUnbilled).toHaveBeenCalledTimes(1);
    });

    // Translating into the language it is already written in spends a
    // round-trip to replace the author's own words with a paraphrase.
    it('refuses to translate a post into the language it is already in', async () => {
        await expect(
            service.translateWithAi('tenant-1', { ...SOURCE, target_locales: ['en'] }),
        ).rejects.toThrow(BadRequestException);

        expect(ai.completeUnbilled).not.toHaveBeenCalled();
    });

    it('checks the credit balance before spending any', async () => {
        await service.translateWithAi('tenant-1', SOURCE);

        expect(ai.enforceCredits).toHaveBeenCalledWith('tenant-1');
        expect(ai.enforceCredits.mock.invocationCallOrder[0]).toBeLessThan(
            ai.completeUnbilled.mock.invocationCallOrder[0],
        );
    });

    it('does not call the model when the tenant is out of credits', async () => {
        ai.enforceCredits.mockRejectedValue(new ForbiddenException('AI features are not included in your current plan.'));

        await expect(service.translateWithAi('tenant-1', SOURCE)).rejects.toThrow(ForbiddenException);
        expect(ai.completeUnbilled).not.toHaveBeenCalled();
    });

    it('bills the tokens it spent to the tenant', async () => {
        await service.translateWithAi('tenant-1', SOURCE);

        expect(ai.logUsage).toHaveBeenCalledWith(
            'tenant-1',
            'blog_post_translate',
            'anthropic/claude-haiku-4.5',
            expect.objectContaining({ total_tokens: 1300 }),
        );
    });

    // A long post is what makes a translation long, so the ceiling is higher
    // than a generation's — a truncated reply is unparseable.
    it('allows a translation more room than a generation', async () => {
        await service.translateWithAi('tenant-1', SOURCE);

        expect(ai.completeUnbilled.mock.calls[0][3]).toBeGreaterThan(BLOG_DRAFT_MAX_TOKENS);
    });

    it('bills the call even when the reply is unusable', async () => {
        ai.completeUnbilled.mockResolvedValue({
            text: 'Sure! Here is the Bangla version:',
            usage: { prompt_tokens: 400, completion_tokens: 8, total_tokens: 408 },
            model: 'anthropic/claude-haiku-4.5',
        });

        await expect(service.translateWithAi('tenant-1', SOURCE)).rejects.toThrow();
        expect(ai.logUsage).toHaveBeenCalled();
    });
});

describe('TenantBlogController AI draft route', () => {
    it('requires the blog write permission, not just a login', () => {
        const permissions = Reflect.getMetadata(
            STORE_PERMISSIONS_KEY,
            TenantBlogController.prototype.draftWithAi,
        );

        expect(permissions).toEqual([StorePermission.MANAGE_BLOG]);
    });

    /**
     * Translating writes nothing and publishes nothing — it fills the editor
     * and the author still has to save — so it sits with drafting rather than
     * with the permission that puts a post on the shop's public page.
     */
    it('holds translating to the same permission as drafting', () => {
        const permissions = Reflect.getMetadata(
            STORE_PERMISSIONS_KEY,
            TenantBlogController.prototype.translateWithAi,
        );

        expect(permissions).toEqual([StorePermission.MANAGE_BLOG]);
    });

    it('keeps the class-level guards in place', () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, TenantBlogController) ?? []).toHaveLength(2);
    });
});
