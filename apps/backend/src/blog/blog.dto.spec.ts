import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BlogAiDraftDto } from './blog.dto';

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

    it('rejects a locale outside the supported set', () => {
        expect(errorsFor(BlogAiDraftDto, { prompt: 'dead stock', locale: 'fr' })).toEqual(['locale']);
    });
});
