/** The most recipients one uploaded campaign may carry. */
export const CAMPAIGN_UPLOAD_MAX_ROWS = 1000;

/** A row straight out of the spreadsheet, before any checking. */
export interface RawCampaignRow {
    email?: string | null;
    name?: string | null;
    subject?: string | null;
    message?: string | null;
}

/** A row that passed every check, normalised and ready to store. */
export interface ValidCampaignRow {
    /** Trimmed and lower-cased — this is the address that gets emailed. */
    email: string;
    /** The Name cell, or the email local part when that cell was blank. */
    name: string;
    subject: string;
    message: string;
}

export interface CampaignRowIssue {
    /** 1-based data row number; the header row is not counted. */
    line: number;
    /** The email cell exactly as given, so the user can find the row. */
    email: string;
    reason: string;
}

export interface CampaignRowsResult {
    rows: ValidCampaignRow[];
    issues: CampaignRowIssue[];
    /** Set when the whole file is unusable; `rows` is then empty. */
    fileError: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * Checks are ordered: email present, email well-formed, subject, message,
 * then duplicate. A row is reported against the first rule it breaks, so a
 * row never produces two issues.
 */
export function validateCampaignRows(raw: RawCampaignRow[]): CampaignRowsResult {
    if (raw.length === 0) {
        return { rows: [], issues: [], fileError: 'The file has no data rows.' };
    }

    const rows: ValidCampaignRow[] = [];
    const issues: CampaignRowIssue[] = [];
    const seen = new Set<string>();

    raw.forEach((entry, index) => {
        const line = index + 1;
        const rawEmail = clean(entry.email);
        const subject = clean(entry.subject);
        const message = clean(entry.message);
        const email = rawEmail.toLowerCase();

        if (!rawEmail) {
            issues.push({ line, email: rawEmail, reason: 'Email is required.' });
            return;
        }
        if (!EMAIL_PATTERN.test(rawEmail)) {
            issues.push({ line, email: rawEmail, reason: 'Not a valid email address.' });
            return;
        }
        if (!subject) {
            issues.push({ line, email: rawEmail, reason: 'Subject is required.' });
            return;
        }
        if (!message) {
            issues.push({ line, email: rawEmail, reason: 'Message is required.' });
            return;
        }
        if (seen.has(email)) {
            issues.push({ line, email: rawEmail, reason: 'Duplicate of an earlier row.' });
            return;
        }

        seen.add(email);
        rows.push({
            email,
            name: clean(entry.name) || email.split('@')[0],
            subject,
            message,
        });
    });

    if (rows.length > CAMPAIGN_UPLOAD_MAX_ROWS) {
        return {
            rows: [],
            issues,
            fileError: `A campaign can have at most ${CAMPAIGN_UPLOAD_MAX_ROWS.toLocaleString('en-US')} recipients; this file has ${rows.length}.`,
        };
    }
    if (rows.length === 0) {
        return { rows: [], issues, fileError: 'No valid rows found in this file.' };
    }

    return { rows, issues, fileError: null };
}
