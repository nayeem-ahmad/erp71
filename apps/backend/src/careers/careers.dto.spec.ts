import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CareersApplyDto, CareersJobQueryDto, UpdateCareersProfileDto } from './careers.dto';

const errorsFor = (cls: any, payload: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, payload) as object).map((e) => e.property);

/**
 * The `ValidateIf` spelling, from the fields the profile form actually exposes.
 * PATCH reads `undefined` as "leave alone", so a cleared text box has to survive
 * as `''` for the service to null the column — and `@IsOptional()` skips only
 * `undefined` and `null`, so without `@ValidateIf` the empty string reaches
 * `@IsUrl()` and the request 400s. Clearing your LinkedIn link is the case.
 */
describe('UpdateCareersProfileDto clearing', () => {
    it('lets a cleared LinkedIn link through', () => {
        expect(errorsFor(UpdateCareersProfileDto, { linkedin_url: '' })).toEqual([]);
    });

    it('lets a cleared portfolio link and CV link through', () => {
        expect(errorsFor(UpdateCareersProfileDto, { portfolio_url: '', resume_url: '' })).toEqual([]);
    });

    it('still rejects a link that is not a URL', () => {
        expect(errorsFor(UpdateCareersProfileDto, { linkedin_url: 'linkedin.com/in/me' })).toEqual([
            'linkedin_url',
        ]);
    });

    it('still requires a protocol, so a bare host is refused', () => {
        expect(errorsFor(UpdateCareersProfileDto, { portfolio_url: 'example.com' })).toEqual([
            'portfolio_url',
        ]);
    });

    it('accepts a full URL', () => {
        expect(
            errorsFor(UpdateCareersProfileDto, { linkedin_url: 'https://linkedin.com/in/me' }),
        ).toEqual([]);
    });

    it('accepts an empty phone and headline, which the service nulls', () => {
        expect(errorsFor(UpdateCareersProfileDto, { phone: '', headline: '' })).toEqual([]);
    });
});

describe('CareersApplyDto', () => {
    it('lets a cleared resume override through, meaning "use my profile CV"', () => {
        expect(errorsFor(CareersApplyDto, { resume_url: '' })).toEqual([]);
    });

    it('coerces expected_salary from the string a form posts', () => {
        const dto = plainToInstance(CareersApplyDto, { expected_salary: '50000' });
        expect(dto.expected_salary).toBe(50_000);
        expect(errorsFor(CareersApplyDto, { expected_salary: '50000' })).toEqual([]);
    });

    it('rejects a negative expected salary', () => {
        expect(errorsFor(CareersApplyDto, { expected_salary: '-1' })).toEqual(['expected_salary']);
    });
});

describe('CareersJobQueryDto', () => {
    it('coerces ?page off the query string to a number', () => {
        expect(plainToInstance(CareersJobQueryDto, { page: '3' }).page).toBe(3);
        expect(errorsFor(CareersJobQueryDto, { page: '3' })).toEqual([]);
    });

    it('rejects a page below 1', () => {
        expect(errorsFor(CareersJobQueryDto, { page: '0' })).toEqual(['page']);
    });

    it('accepts a location filter', () => {
        expect(errorsFor(CareersJobQueryDto, { location: 'Dhaka' })).toEqual([]);
    });

    it('rejects an employment type that is not in the enum', () => {
        expect(errorsFor(CareersJobQueryDto, { employment_type: 'VOLUNTEER' })).toEqual([
            'employment_type',
        ]);
    });

    it('rejects a company filter that is not a uuid', () => {
        expect(errorsFor(CareersJobQueryDto, { company_id: 'rahim-stores' })).toEqual(['company_id']);
    });
});
