import { validateCampaignRows, CAMPAIGN_UPLOAD_MAX_ROWS } from './campaign-rows';

const row = (over: Record<string, string> = {}) => ({
    email: 'rahim@example.com',
    name: 'Rahim Uddin',
    subject: 'Eid offer',
    message: 'Hello',
    ...over,
});

describe('validateCampaignRows', () => {
    it('accepts a well-formed row and normalises the email', () => {
        const result = validateCampaignRows([row({ email: '  Rahim@Example.COM ' })]);
        expect(result.fileError).toBeNull();
        expect(result.issues).toEqual([]);
        expect(result.rows).toEqual([
            { email: 'rahim@example.com', name: 'Rahim Uddin', subject: 'Eid offer', message: 'Hello' },
        ]);
    });

    it('falls back to the email local part when the name is blank', () => {
        const result = validateCampaignRows([row({ name: '   ' })]);
        expect(result.rows[0].name).toBe('rahim');
    });

    it('rejects a row with no email', () => {
        const result = validateCampaignRows([row({ email: '' })]);
        expect(result.rows).toEqual([]);
        expect(result.issues).toEqual([{ line: 1, email: '', reason: 'Email is required.' }]);
    });

    it('rejects a malformed email', () => {
        const result = validateCampaignRows([row({ email: 'not-an-email' })]);
        expect(result.issues).toEqual([
            { line: 1, email: 'not-an-email', reason: 'Not a valid email address.' },
        ]);
    });

    it('rejects a blank subject and a blank message', () => {
        const result = validateCampaignRows([
            row({ email: 'a@example.com', subject: '' }),
            row({ email: 'b@example.com', message: '  ' }),
        ]);
        expect(result.issues).toEqual([
            { line: 1, email: 'a@example.com', reason: 'Subject is required.' },
            { line: 2, email: 'b@example.com', reason: 'Message is required.' },
        ]);
    });

    it('keeps the first of a repeated email and reports the rest, ignoring case', () => {
        const result = validateCampaignRows([
            row({ subject: 'First' }),
            row({ email: 'RAHIM@example.com', subject: 'Second' }),
        ]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].subject).toBe('First');
        expect(result.issues).toEqual([
            { line: 2, email: 'RAHIM@example.com', reason: 'Duplicate of an earlier row.' },
        ]);
    });

    it('rejects an empty file', () => {
        expect(validateCampaignRows([]).fileError).toBe('The file has no data rows.');
    });

    it('rejects a file over the row cap', () => {
        const many = Array.from({ length: CAMPAIGN_UPLOAD_MAX_ROWS + 1 }, (_, i) =>
            row({ email: `p${i}@example.com` }),
        );
        const result = validateCampaignRows(many);
        expect(result.fileError).toBe(
            'A campaign can have at most 1,000 recipients; this file has 1001.',
        );
        expect(result.rows).toEqual([]);
    });

    it('rejects a file whose every row failed validation', () => {
        const result = validateCampaignRows([row({ email: '' })]);
        expect(result.fileError).toBe('No valid rows found in this file.');
    });

    it('treats missing keys the same as blank cells', () => {
        const result = validateCampaignRows([{ email: 'a@example.com', subject: 'Hi', message: 'Yo' }]);
        expect(result.rows[0].name).toBe('a');
    });
});
