import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantBlogController } from './tenant-blog.controller';
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

describe('TenantBlogController AI draft route', () => {
    it('requires the blog write permission, not just a login', () => {
        const permissions = Reflect.getMetadata(
            STORE_PERMISSIONS_KEY,
            TenantBlogController.prototype.draftWithAi,
        );

        expect(permissions).toEqual([StorePermission.MANAGE_BLOG]);
    });

    it('keeps the class-level guards in place', () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, TenantBlogController) ?? []).toHaveLength(2);
    });
});
