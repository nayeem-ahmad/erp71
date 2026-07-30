import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateContactDto, UpdateContactDto } from './crm-contacts.dto';

const errorsFor = <T extends object>(cls: new () => T, payload: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, payload) as object).map((e) => e.property);

describe('contact DTO validation', () => {
    /**
     * The whole point of the ValidateIf spelling: a cleared field has to survive
     * as `''` so the service can null the column. Collapsing it to `undefined`
     * would make an email the scanner misread impossible to remove.
     */
    it('lets a cleared email through as an empty string', () => {
        const dto = plainToInstance(UpdateContactDto, { email: '' });

        expect(errorsFor(UpdateContactDto, { email: '' })).toEqual([]);
        expect(dto.email).toBe('');
    });

    it('lets a cleared owner through as an empty string', () => {
        const dto = plainToInstance(UpdateContactDto, { assigned_to: '' });

        expect(errorsFor(UpdateContactDto, { assigned_to: '' })).toEqual([]);
        expect(dto.assigned_to).toBe('');
    });

    it('still rejects a malformed email', () => {
        expect(errorsFor(UpdateContactDto, { email: 'not-an-email' })).toEqual(['email']);
    });

    it('still rejects an owner that is not a uuid', () => {
        expect(errorsFor(UpdateContactDto, { assigned_to: 'rahim' })).toEqual(['assigned_to']);
    });

    it('accepts a create with nothing but a name', () => {
        expect(errorsFor(CreateContactDto, { name: 'Rafiq Islam' })).toEqual([]);
    });

    it('rejects a capture_source outside the enum', () => {
        expect(errorsFor(CreateContactDto, { name: 'Rafiq', capture_source: 'SCANNED' })).toEqual([
            'capture_source',
        ]);
    });
});
