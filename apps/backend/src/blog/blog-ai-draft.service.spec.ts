import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
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

const TRANSLATED = JSON.stringify({
    title: 'মজুদ কমানো',
    excerpt: 'তাকের উপর পড়ে থাকা মজুদ মানে আটকে থাকা টাকা।',
    body_md: '## কেন গুরুত্বপূর্ণ\n\nঅবিক্রীত মজুদ মূলধন আটকে রাখে।',
    seo_title: 'মজুদ কমানো',
    seo_description: 'ছোট দোকান কীভাবে আটকে থাকা টাকা মুক্ত করে।',
});

const SOURCE = {
    source_locale: 'en',
    target_locales: ['bn', 'ms'],
    title: 'Cutting dead stock',
    body_md: '## Why it matters\n\nDead stock ties up working capital.',
    excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
};

function usage(text: string) {
    return {
        text,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'anthropic/claude-haiku-4.5',
    };
}

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
        ai.completeUnbilled.mockResolvedValue(usage(REPLY));
        service = new BlogService(db, {} as any, ai);
    });

    it('returns a normalized draft with the category resolved to an id', async () => {
        const draft = await service.draftWithAi({ prompt: 'dead stock', locale: 'en' });

        expect(draft.translations[0].title).toBe('Cutting dead stock');
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

    describe('several languages at once', () => {
        beforeEach(() => {
            ai.completeUnbilled.mockImplementation(async (_model: string, systemPrompt: string) =>
                usage(systemPrompt.startsWith('You are a translator') ? TRANSLATED : REPLY),
            );
        });

        it('returns one translation per requested language, in the order asked for', async () => {
            const draft = await service.draftWithAi({ prompt: 'dead stock', locales: ['en', 'bn', 'ms'] });

            expect(draft.translations.map((row) => row.locale)).toEqual(['en', 'bn', 'ms']);
            expect(draft.failed_locales).toBeUndefined();
        });

        /**
         * The extra languages are translations of the first, not fresh
         * generations from the brief. Three generations would file three
         * different articles — different arguments, different examples — under
         * one slug and one cover.
         */
        it('writes the first language from the brief and translates the rest from it', async () => {
            await service.draftWithAi({ prompt: 'dead stock', locales: ['en', 'bn'] });

            const prompts = ai.completeUnbilled.mock.calls.map(([, systemPrompt]: string[]) => systemPrompt);
            expect(prompts).toHaveLength(2);
            expect(prompts[0]).toContain('You are a content writer');
            expect(prompts[1]).toContain('You are a translator');

            const [, , translateMessage] = ai.completeUnbilled.mock.calls[1];
            expect(translateMessage).toContain('Dead stock ties up working capital');
        });

        it('spends one round-trip for a single language', async () => {
            await service.draftWithAi({ prompt: 'dead stock', locales: ['bn'] });

            expect(ai.completeUnbilled).toHaveBeenCalledTimes(1);
        });

        /**
         * One language failing must not throw away the ones that worked — the
         * author keeps what came back and is told which tabs to retry, rather
         * than losing the whole wait to the weakest of three calls.
         */
        it('keeps the languages that succeeded and names the ones that did not', async () => {
            ai.completeUnbilled.mockImplementation(async (_model: string, systemPrompt: string) => {
                if (!systemPrompt.startsWith('You are a translator')) return usage(REPLY);
                if (systemPrompt.includes('Malay')) throw new Error('rate limited');
                return usage(TRANSLATED);
            });

            const draft = await service.draftWithAi({ prompt: 'dead stock', locales: ['en', 'bn', 'ms'] });

            expect(draft.translations.map((row) => row.locale)).toEqual(['en', 'bn']);
            expect(draft.failed_locales).toEqual(['ms']);
        });

        // A brief that produced nothing usable has no article to translate, so
        // the request fails outright rather than half-succeeding.
        it('fails the whole request when the first language is unusable', async () => {
            ai.completeUnbilled.mockResolvedValue(usage('Sure! Here is your post:'));

            await expect(service.draftWithAi({ prompt: 'dead stock', locales: ['en', 'bn'] })).rejects.toThrow();
        });
    });
});

describe('BlogService.translateWithAi', () => {
    const db = { blogCategory: { findMany: jest.fn() }, blogPost: { update: jest.fn() } } as any;
    const ai = { getDefaultModel: jest.fn(), completeUnbilled: jest.fn(), logUsage: jest.fn() } as any;

    let service: BlogService;

    beforeEach(() => {
        jest.clearAllMocks();
        ai.getDefaultModel.mockResolvedValue('anthropic/claude-haiku-4.5');
        ai.completeUnbilled.mockResolvedValue(usage(TRANSLATED));
        service = new BlogService(db, {} as any, ai);
    });

    it('returns one translation per target language', async () => {
        const result = await service.translateWithAi(SOURCE);

        expect(result.translations.map((row) => row.locale)).toEqual(['bn', 'ms']);
        expect(result.translations[0].title).toBe('মজুদ কমানো');
        expect(ai.completeUnbilled).toHaveBeenCalledTimes(2);
    });

    it('sends the author’s own copy, not a brief', async () => {
        await service.translateWithAi(SOURCE);

        const [, systemPrompt, userMessage] = ai.completeUnbilled.mock.calls[0];
        expect(systemPrompt).toContain('You are a translator');
        expect(userMessage).toContain('Dead stock ties up working capital');
    });

    /**
     * The slug, category, audience and cover are the post's, shared by every
     * language. Reading no categories at all is the cheapest proof that this
     * path cannot change them.
     */
    it('reads nothing about the post and writes nothing', async () => {
        await service.translateWithAi(SOURCE);

        expect(db.blogCategory.findMany).not.toHaveBeenCalled();
        expect(db.blogPost.update).not.toHaveBeenCalled();
    });

    it('never translates a post into the language it came from', async () => {
        const result = await service.translateWithAi({ ...SOURCE, target_locales: ['en', 'bn'] });

        expect(result.translations.map((row) => row.locale)).toEqual(['bn']);
        expect(ai.completeUnbilled).toHaveBeenCalledTimes(1);
    });

    it('rejects a request with no language left to translate into', async () => {
        await expect(service.translateWithAi({ ...SOURCE, target_locales: ['en'] })).rejects.toThrow(
            BadRequestException,
        );
        expect(ai.completeUnbilled).not.toHaveBeenCalled();
    });

    it('keeps the languages that succeeded and names the ones that did not', async () => {
        ai.completeUnbilled.mockImplementation(async (_model: string, systemPrompt: string) => {
            if (systemPrompt.includes('Malay')) throw new Error('terminated');
            return usage(TRANSLATED);
        });

        const result = await service.translateWithAi(SOURCE);

        expect(result.translations.map((row) => row.locale)).toEqual(['bn']);
        expect(result.failed_locales).toEqual(['ms']);
    });

    it('fails when every language failed', async () => {
        ai.completeUnbilled.mockRejectedValue(new Error('terminated'));

        await expect(service.translateWithAi(SOURCE)).rejects.toThrow(InternalServerErrorException);
    });

    // Whatever the source is, a translation is long — the reply carries the
    // whole body back — and Bangla and Malay both spend more tokens than the
    // English they came from. A truncated reply is unparseable.
    it('allows a longer reply than a generation does', async () => {
        await service.translateWithAi(SOURCE);

        const [, , , maxTokens] = ai.completeUnbilled.mock.calls[0];
        expect(maxTokens).toBeGreaterThan(3000);
    });
});
