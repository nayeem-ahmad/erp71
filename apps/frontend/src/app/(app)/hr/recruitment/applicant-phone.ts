/**
 * Applicant phone, shared by the new-applicant form and the edit form.
 *
 * Matches `APPLICANT_PHONE_PATTERN` on `CreateApplicantDto`: digits, spaces
 * and hyphens, optional leading +. A blank box is no phone, not an error.
 */
export const APPLICANT_PHONE_PATTERN = /^\+?[0-9\s\-]+$/;

export function applicantPhoneOrNull(phone: string): string | null {
    const trimmed = phone.trim();
    return trimmed === '' ? null : trimmed;
}

/** `'invalid'` when a non-empty phone fails the format check. */
export function applicantPhoneValidationError(phone: string): 'invalid' | null {
    const trimmed = phone.trim();
    if (!trimmed) return null;
    if (trimmed.length > 30 || !APPLICANT_PHONE_PATTERN.test(trimmed)) return 'invalid';
    return null;
}
