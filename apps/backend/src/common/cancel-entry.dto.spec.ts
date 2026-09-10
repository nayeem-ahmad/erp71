import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelEntryDto, CANCELLATION_NOTE_MAX_LENGTH } from './cancel-entry.dto';

/**
 * The note is the feature, so its mandatoriness is pinned here rather than left
 * to the two services that consume it. `main.ts` runs the global pipe with
 * `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`, which is
 * what the cases below reproduce.
 */
describe('CancelEntryDto', () => {
    const parse = (payload: unknown) =>
        validate(plainToInstance(CancelEntryDto, payload), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    it('accepts a note that says why', async () => {
        expect(await parse({ note: 'Customer changed their mind at the counter' })).toHaveLength(0);
    });

    it.each([
        ['missing', {}],
        ['null', { note: null }],
        ['empty', { note: '' }],
        // The one that `@IsString()` alone would wave through, and the reason
        // the value is trimmed before validation rather than in the service.
        ['whitespace only', { note: '     ' }],
        ['too short to be a reason', { note: 'x' }],
    ])('rejects a note that is %s', async (_label, payload) => {
        expect((await parse(payload)).length).toBeGreaterThan(0);
    });

    it('stores the trimmed note, not what was typed around it', async () => {
        const dto = plainToInstance(CancelEntryDto, { note: '  Duplicate entry  ' });

        expect(await validate(dto)).toHaveLength(0);
        expect(dto.note).toBe('Duplicate entry');
    });

    it('refuses a note longer than the column is meant to hold', async () => {
        const errors = await parse({ note: 'a'.repeat(CANCELLATION_NOTE_MAX_LENGTH + 1) });

        expect(errors.length).toBeGreaterThan(0);
    });

    it('refuses extra fields, so a cancel body cannot smuggle in a status', async () => {
        expect((await parse({ note: 'Recorded in error', status: 'COMPLETED' })).length)
            .toBeGreaterThan(0);
    });
});
