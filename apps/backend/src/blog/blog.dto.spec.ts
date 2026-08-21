import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BlogAiDraftDto, BlogAiTranslateDto, BLOG_LOCALES } from './blog.dto';

const errorsFor = <T extends object>(cls: new () => T, payload: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, payload) as object).map((e) => e.property);

describe('BlogAiDraftDto validation', () => {
    /**
     * A whitespace-only prompt used to slip past @MinLength(1), which counts
     * the raw string length rather than its content — buying a 3000-max-token
     * model call that has nothing to write about.
     */
    it('rejects a whitespace-only prompt', () => {
        expect(errorsFor(BlogAiDraftDto, { prompt: '   ' })).toEqual(['prompt']);
    });

    it('trims a prompt with leading and trailing whitespace before validating', () => {
        const dto = plainToInstance(BlogAiDraftDto, { prompt: '  dead stock  ' });

        expect(errorsFor(BlogAiDraftDto, { prompt: '  dead stock  ' })).toEqual([]);
        expect(dto.prompt).toBe('dead stock');
    });

    it('accepts a non-empty prompt with no locale', () => {
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock' })).toEqual([]);
    });

    /**
     * `zz` rather than a real language tag on purpose. This assertion used to
     * pass `fr`, which stopped testing anything the day French shipped — the
     * DTO started (correctly) accepting it, and the test failed for a reason
     * that had nothing to do with the DTO. `zz` is unassigned in ISO 639-1, so
     * it cannot become a supported locale; the first expectation guards the
     * fixture itself, so if it somehow ever does, this fails loudly instead of
     * passing vacuously.
     */
    it('rejects a locale outside the supported set', () => {
        expect(BLOG_LOCALES as readonly string[]).not.toContain('zz');
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock', locale: 'zz' })).toEqual(['locale']);
    });

    it('accepts several locales', () => {
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock', locales: ['en', 'bn', 'ms'] })).toEqual([]);
    });

    it('rejects an unsupported locale inside the list', () => {
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock', locales: ['en', 'zz'] })).toEqual(['locales']);
    });

    // Each extra language is another model round-trip, so the list cannot be
    // longer than the set of languages that exist. Derived from BLOG_LOCALES
    // rather than hardcoded: a fixed four-item list stopped exceeding the cap
    // the moment a fourth language shipped.
    it('rejects more locales than there are languages', () => {
        const tooMany = [...BLOG_LOCALES, 'en'];
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock', locales: tooMany })).toEqual(['locales']);
    });
});

describe('BlogAiTranslateDto validation', () => {
    const valid = {
        source_locale: 'en',
        target_locales: ['bn'],
        title: 'Cutting dead stock',
        body_md: '## Why it matters\n\nDead stock ties up working capital.',
    };

    it('accepts a source language, a target and the copy to translate', () => {
        expect(errorsFor(BlogAiTranslateDto, valid)).toEqual([]);
    });

    it('accepts the optional excerpt and SEO fields', () => {
        expect(
            errorsFor(BlogAiTranslateDto, {
                ...valid,
                excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
                seo_title: 'Cutting dead stock',
                seo_description: 'How small shops free up cash tied in slow-moving stock.',
            }),
        ).toEqual([]);
    });

    // Nothing to translate into is a round-trip that produces nothing.
    it('rejects an empty target list', () => {
        expect(errorsFor(BlogAiTranslateDto, { ...valid, target_locales: [] })).toEqual(['target_locales']);
    });

    it('rejects an unsupported language on either side', () => {
        expect(errorsFor(BlogAiTranslateDto, { ...valid, source_locale: 'zz' })).toEqual(['source_locale']);
        expect(errorsFor(BlogAiTranslateDto, { ...valid, target_locales: ['zz'] })).toEqual(['target_locales']);
    });

    /**
     * There is nothing to translate without a body, and a whitespace-only one
     * slips past @MinLength(1) unless it is trimmed first — the same trap the
     * draft prompt had.
     */
    it('rejects copy with no title or no body', () => {
        expect(errorsFor(BlogAiTranslateDto, { ...valid, title: '   ' })).toEqual(['title']);
        expect(errorsFor(BlogAiTranslateDto, { ...valid, body_md: '   ' })).toEqual(['body_md']);
    });
});
