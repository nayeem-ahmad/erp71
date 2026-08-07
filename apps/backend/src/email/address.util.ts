/**
 * Sender addresses reach us in two shapes: a bare `notify@erp71.com` from the
 * platform settings default, or `Shop Name <hello@shop.com>` once an operator
 * has typed a display name into either field. Brevo's API wants the two parts
 * separately while Resend and SMTP want them joined, so both directions are
 * needed rather than a single canonical form.
 */

export interface EmailAddress {
    email: string;
    name: string | null;
}

/** Splits `Name <addr>` into its parts; a bare address yields a null name. */
export function parseEmailAddress(value: string): EmailAddress {
    const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(value);
    if (!match) {
        return { email: value.trim(), name: null };
    }
    const name = match[1].replace(/^"(.*)"$/, '$1').trim();
    return { email: match[2].trim(), name: name || null };
}

/** Joins the parts back into a header value, quoting a name that needs it. */
export function formatEmailAddress(email: string, name: string | null): string {
    if (!name) return email;
    const escaped = name.replace(/"/g, '\\"');
    return /[",;<>:@]/.test(name) ? `"${escaped}" <${email}>` : `${name} <${email}>`;
}
