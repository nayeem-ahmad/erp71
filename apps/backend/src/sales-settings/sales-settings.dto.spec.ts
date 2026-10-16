import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMemberInvoicePrintDto } from './sales-settings.dto';

/**
 * The member's print settings save through this DTO under the global pipe's
 * `forbidNonWhitelisted`, so a field it does not declare is a 400.
 */
describe('UpdateMemberInvoicePrintDto — signature space', () => {
    const parse = (payload: unknown) =>
        validate(plainToInstance(UpdateMemberInvoicePrintDto, payload), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    it('accepts a whole number of mm inside the range', async () => {
        expect(await parse({ signature_space_mm: 5 })).toHaveLength(0);
        expect(await parse({ signature_space_mm: 40 })).toHaveLength(0);
    });

    it('accepts null, which goes back to the built-in gap', async () => {
        expect(await parse({ signature_space_mm: null })).toHaveLength(0);
    });

    it('refuses a gap outside the range, a fraction or text', async () => {
        expect(await parse({ signature_space_mm: 4 })).not.toHaveLength(0);
        expect(await parse({ signature_space_mm: 41 })).not.toHaveLength(0);
        expect(await parse({ signature_space_mm: 12.5 })).not.toHaveLength(0);
        expect(await parse({ signature_space_mm: '20' })).not.toHaveLength(0);
    });
});
