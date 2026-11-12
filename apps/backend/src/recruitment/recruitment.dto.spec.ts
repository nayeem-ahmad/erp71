import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateApplicantDto, CreateApplicationDto, UpdateApplicantDto } from './recruitment.dto';

/**
 * Same pipe as `main.ts`. Phone is optional; a blank is null; a value still
 * has to be a phone number.
 */
describe('CreateApplicantDto phone', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    async function create(payload: Record<string, unknown>) {
        return pipe.transform(payload, { type: 'body', metatype: CreateApplicantDto });
    }

    it('accepts an applicant with no phone and normalises a blank to null', async () => {
        await expect(create({ name: 'Rina Akter' })).resolves.toMatchObject({ name: 'Rina Akter' });
        await expect(create({ name: 'Rina Akter', phone: '' })).resolves.toMatchObject({ phone: null });
        await expect(create({ name: 'Rina Akter', phone: '   ' })).resolves.toMatchObject({ phone: null });
        await expect(create({ name: 'Rina Akter', phone: null })).resolves.toMatchObject({ phone: null });
    });

    it('rejects an invalid phone', async () => {
        await expect(create({ name: 'Rina Akter', phone: 'not-a-phone' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(create({ name: 'Rina Akter', phone: '01710000000!' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid phone', async () => {
        await expect(create({ name: 'Rina Akter', phone: ' 01710000000 ' })).resolves.toMatchObject({
            phone: '01710000000',
        });
        await expect(create({ name: 'Rina Akter', phone: '+880 1710-000000' })).resolves.toMatchObject({
            phone: '+880 1710-000000',
        });
    });

    it('clears the phone on edit when the box is emptied', async () => {
        const updated = await pipe.transform(
            { phone: '' },
            { type: 'body', metatype: UpdateApplicantDto },
        );
        expect(updated.phone).toBeNull();
    });

    it('rejects an invalid phone on an application that types in a new applicant', async () => {
        await expect(pipe.transform(
            { job_post_id: 'post-1', applicant: { name: 'Rina Akter', phone: 'call me' } },
            { type: 'body', metatype: CreateApplicationDto },
        )).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a new application whose applicant has no phone', async () => {
        await expect(pipe.transform(
            { job_post_id: 'post-1', applicant: { name: 'Rina Akter', phone: '' } },
            { type: 'body', metatype: CreateApplicationDto },
        )).resolves.toMatchObject({
            applicant: { name: 'Rina Akter', phone: null },
        });
    });
});
