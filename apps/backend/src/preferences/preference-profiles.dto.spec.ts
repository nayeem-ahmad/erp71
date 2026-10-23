import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyPreferenceProfileDto } from './preference-profiles.dto';

/**
 * `POST /preference-profiles/:id/apply` binds its body to this DTO under the
 * global pipe (`whitelist`, `forbidNonWhitelisted`, `transform`).
 */
describe('ApplyPreferenceProfileDto', () => {
    const parse = (payload: unknown) =>
        validate(plainToInstance(ApplyPreferenceProfileDto, payload), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    it('accepts a targeted apply', async () => {
        expect(await parse({ sections: ['sidebar'], user_ids: ['u1', 'u2'] })).toHaveLength(0);
    });

    it('accepts an apply to everyone the profile reaches (user_ids omitted)', async () => {
        expect(await parse({ sections: ['sidebar', 'alerts'] })).toHaveLength(0);
    });

    it('refuses user_ids: null, which would otherwise widen a targeted apply to every member', async () => {
        const errors = await parse({ sections: ['sidebar'], user_ids: null });

        expect(errors.map((error) => error.property)).toEqual(['user_ids']);
    });

    it('refuses user_ids that are not a list of ids', async () => {
        expect(await parse({ sections: ['sidebar'], user_ids: 'u1' })).not.toHaveLength(0);
        expect(await parse({ sections: ['sidebar'], user_ids: [1] })).not.toHaveLength(0);
    });
});
