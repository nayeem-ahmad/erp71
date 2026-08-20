import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BlogAiDraftDto, BLOG_LOCALES } from './blog.dto';

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
});
