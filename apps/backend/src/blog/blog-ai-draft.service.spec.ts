import { BlogService } from './blog.service';

const REPLY = JSON.stringify({
    title: 'Cutting dead stock',
    excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
    body_md: '## Why it matters\n\nDead stock ties up working capital.',
    seo_title: 'Cutting dead stock',
    seo_description: 'How small shops free up cash tied in slow-moving stock.',
    slug: 'cutting-dead-stock',
    cover_alt: 'A shopkeeper counting stock',
    category: 'Inventory',
    author_name: 'ERP71 Team',
    author_title: 'Retail Operations',
    featured: false,
    audience: 'PUBLIC',
});

describe('BlogService.draftWithAi', () => {
    const db = {
        blogCategory: { findMany: jest.fn() },
        blogPost: { create: jest.fn() },
    } as any;
    const ai = {
        getDefaultModel: jest.fn(),
        completeUnbilled: jest.fn(),
        logUsage: jest.fn(),
    } as any;

    let service: BlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        db.blogCategory.findMany.mockResolvedValue([{ id: 'cat-1', name_en: 'Inventory' }]);
        ai.getDefaultModel.mockResolvedValue('anthropic/claude-haiku-4.5');
        ai.completeUnbilled.mockResolvedValue({
            text: REPLY,
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            model: 'anthropic/claude-haiku-4.5',
        });
        service = new BlogService(db, {} as any, ai);
    });

    it('returns a normalized draft with the category resolved to an id', async () => {
        const draft = await service.draftWithAi({ prompt: 'dead stock', locale: 'en' });

        expect(draft.title).toBe('Cutting dead stock');
        expect(draft.category_id).toBe('cat-1');
        expect(draft.audience).toBe('PUBLIC');
    });

    it('asks the model for an audience, which the tenant blog does not', async () => {
        await service.draftWithAi({ prompt: 'dead stock', locale: 'en' });

        const [, systemPrompt] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('IN_APP');
    });

    it('passes the requested locale through to the prompt', async () => {
        await service.draftWithAi({ prompt: 'dead stock', locale: 'bn' });

        const [, systemPrompt] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('Bangla');
    });

    it('defaults to English when no locale is given', async () => {
        await service.draftWithAi({ prompt: 'dead stock' });

        const [, systemPrompt] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('English');
    });

    // There is no tenant to bill and no AiUsageLog row that could be written
    // against one, so a call that started logging usage would crash on the FK.
    it('writes no usage row', async () => {
        await service.draftWithAi({ prompt: 'dead stock', locale: 'en' });

        expect(ai.logUsage).not.toHaveBeenCalled();
    });

    it('persists nothing', async () => {
        await service.draftWithAi({ prompt: 'dead stock', locale: 'en' });

        expect(db.blogCategory.findMany).toHaveBeenCalledTimes(1);
        expect(db.blogPost.create).not.toHaveBeenCalled();
    });
});
