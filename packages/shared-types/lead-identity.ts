import { DEFAULT_MOBILE_COUNTRY_CODE, normalizeMobileToE164 } from './phone';

/**
 * Lead de-duplication keys.
 *
 * A lead is the same lead as another when it reaches the same person: the same
 * mobile, the same email, or the same LinkedIn profile. Those three are stored
 * a second time in normalized form (`mobile_norm` / `email_norm` /
 * `linkedin_norm`) so Postgres can enforce uniqueness on them per tenant, which
 * a comparison of the raw display columns cannot do — `01712-345678`,
 * `+8801712345678` and `01712345678` are three strings and one phone number.
 *
 * `fb_url` / `x_url` / `website_url` are deliberately NOT identity keys: they are
 * company-level and genuinely shared across many leads at the same firm.
 *
 * A blank normalizes to NULL, never `''`. Postgres treats NULLs as distinct
 * under a unique index, so any number of leads may be missing a mobile, while
 * two empty strings would collide and fight over the same slot.
 */
export interface LeadIdentity {
    mobile_norm: string | null;
    email_norm: string | null;
    linkedin_norm: string | null;
}

/** Column -> the word a shop owner uses for it, for error messages. */
export const LEAD_IDENTITY_LABELS: Record<keyof LeadIdentity, string> = {
    mobile_norm: 'mobile number',
    email_norm: 'email',
    linkedin_norm: 'LinkedIn profile',
};

export const LEAD_IDENTITY_FIELDS = Object.keys(LEAD_IDENTITY_LABELS) as (keyof LeadIdentity)[];

/**
 * Canonical form of a phone number, for comparison only — the raw value the
 * user typed stays in `mobile` and is what the UI shows.
 *
 * E.164 via the shared helper is the preferred form, so the BD numbers that
 * make up nearly every lead collapse onto one string whichever way they were
 * written. A number the helper rejects (a foreign number in a format we do not
 * model, an extension, a landline) still has to normalize to *something*
 * stable rather than being dropped, or two spellings of it would both import;
 * digits-only is that fallback.
 */
export function normalizeLeadMobile(raw: unknown): string | null {
    const value = raw == null ? '' : String(raw).trim();
    if (!value) return null;

    const e164 = normalizeMobileToE164(DEFAULT_MOBILE_COUNTRY_CODE, value);
    if (e164) return e164;

    const digits = value.replace(/\D/g, '');
    return digits || null;
}

/**
 * Emails are case-insensitive in practice, so `A@Shop.com` and `a@shop.com` are
 * one address. Nothing beyond trim + lowercase: stripping Gmail dots or `+tags`
 * would merge addresses that their owners use to keep contacts apart.
 */
export function normalizeLeadEmail(raw: unknown): string | null {
    const value = raw == null ? '' : String(raw).trim().toLowerCase();
    return value || null;
}

/**
 * Canonical form of a profile URL: scheme, `www.`, query string, fragment and
 * trailing slashes all dropped, the rest lowercased. LinkedIn vanity names are
 * case-insensitive, so `https://www.LinkedIn.com/in/Jane-Doe/?utm_source=x` and
 * `linkedin.com/in/jane-doe` are one profile.
 */
export function normalizeProfileUrl(raw: unknown): string | null {
    const value = raw == null ? '' : String(raw).trim().toLowerCase();
    if (!value) return null;

    const cleaned = value
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/^www\./, '')
        .split(/[?#]/)[0]
        .replace(/\/+$/, '');

    return cleaned || null;
}

/** The three identity columns for a lead's contact details. */
export function leadIdentityOf(input: {
    mobile?: unknown;
    email?: unknown;
    linkedin_url?: unknown;
}): LeadIdentity {
    return {
        mobile_norm: normalizeLeadMobile(input.mobile),
        email_norm: normalizeLeadEmail(input.email),
        linkedin_norm: normalizeProfileUrl(input.linkedin_url),
    };
}

/**
 * The same three columns, but only for the keys a patch actually touches. An
 * `undefined` field is one the caller left alone, and must stay out of the
 * update payload — mapping it to NULL would silently clear the lead's identity
 * (and with it, its protection against a later duplicate).
 */
export function leadIdentityPatch(patch: {
    mobile?: unknown;
    email?: unknown;
    linkedin_url?: unknown;
}): Partial<LeadIdentity> {
    const data: Partial<LeadIdentity> = {};
    if (patch.mobile !== undefined) data.mobile_norm = normalizeLeadMobile(patch.mobile);
    if (patch.email !== undefined) data.email_norm = normalizeLeadEmail(patch.email);
    if (patch.linkedin_url !== undefined) {
        data.linkedin_norm = normalizeProfileUrl(patch.linkedin_url);
    }
    return data;
}

/**
 * Prisma `OR` arms matching any populated identity key, or `[]` when the lead
 * carries none. Callers must treat `[]` as "no duplicate check possible" —
 * an `OR: []` matches nothing in Prisma, but a `where` built from an empty
 * arm list elsewhere would match everything.
 */
export function identityMatchArms(identity: Partial<LeadIdentity>) {
    return LEAD_IDENTITY_FIELDS.filter((field) => identity[field] != null).map((field) => ({
        [field]: identity[field],
    }));
}

/**
 * Stable strings identifying a lead within one import batch, namespaced by
 * column so an email that happens to read like a phone number cannot collide
 * with one. Used to catch two rows of the *same file* describing one lead —
 * the database cannot, because the first row is not committed yet when the
 * second is checked.
 */
export function identityDedupeKeys(identity: Partial<LeadIdentity>): string[] {
    return LEAD_IDENTITY_FIELDS.filter((field) => identity[field] != null).map(
        (field) => `${field}:${identity[field]}`,
    );
}

/** "mobile number" / "email" for the key `identityDedupeKeys` produced. */
export function labelForDedupeKey(key: string): string {
    const field = key.split(':', 1)[0] as keyof LeadIdentity;
    return LEAD_IDENTITY_LABELS[field] ?? field;
}
