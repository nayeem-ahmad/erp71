import { applicantPhoneOrNull, applicantPhoneValidationError } from './applicant-phone';

describe('applicant phone', () => {
    it('treats an empty phone as no phone', () => {
        expect(applicantPhoneValidationError('')).toBeNull();
        expect(applicantPhoneValidationError('   ')).toBeNull();
        expect(applicantPhoneOrNull('')).toBeNull();
        expect(applicantPhoneOrNull('   ')).toBeNull();
    });

    it('rejects an invalid phone', () => {
        expect(applicantPhoneValidationError('not-a-phone')).toBe('invalid');
        expect(applicantPhoneValidationError('01710000000!')).toBe('invalid');
        expect(applicantPhoneValidationError('1'.repeat(31))).toBe('invalid');
    });

    it('accepts a valid phone', () => {
        expect(applicantPhoneValidationError('01710000000')).toBeNull();
        expect(applicantPhoneValidationError('+880 1710-000000')).toBeNull();
        expect(applicantPhoneOrNull(' 01710000000 ')).toBe('01710000000');
    });
});
