/**
 * The referral partner's first contact with the platform, in their own language.
 *
 * Every other platform email in this codebase is English-only inline HTML, which
 * is defensible for a receipt a shop owner glances at. It is not defensible here:
 * this is cold outreach to someone in Bangladesh who has agreed to sell for us and
 * has not yet seen a single screen. If the first thing we send cannot be read, the
 * invite fails before the token ever expires.
 *
 * Kept as data rather than a template engine because there are two messages and
 * three locales. The SMS variants are separate strings rather than a truncation of
 * the email: an SMS has to carry the link and nothing else, and Bangla costs ~67
 * characters per segment, so the wording is written to that budget rather than cut
 * to it.
 */

export type EmailLocale = 'en' | 'bn' | 'ms';

const SUPPORTED: readonly EmailLocale[] = ['en', 'bn', 'ms'];

/**
 * Falls back to English for anything unrecognised, including null. `preferred_locale`
 * is user-editable and predates this file, so it can hold values these templates
 * have never heard of.
 */
export function resolveEmailLocale(locale: string | null | undefined): EmailLocale {
    const normalized = (locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
    return (SUPPORTED as readonly string[]).includes(normalized)
        ? (normalized as EmailLocale)
        : 'en';
}

export interface RefereeInviteVars {
    name: string;
    referralCode: string;
    /** Where the partner sets their password. */
    setupLink: string;
    loginLink: string;
    /** The tracking link they hand to prospects. */
    signupLink: string;
    /** Hours the setup link stays valid, so the copy cannot drift from the TTL. */
    expiryHours: number;
}

interface InviteCopy {
    subject: string;
    heading: string;
    greeting: (name: string) => string;
    intro: string;
    bullets: [string, string, string];
    codeLabel: string;
    signupLinkLabel: string;
    instruction: string;
    cta: string;
    /** Takes the hours so the stated expiry always matches the token. */
    expiry: (hours: number) => string;
    loginHint: string;
}

const COPY: Record<EmailLocale, InviteCopy> = {
    en: {
        subject: 'Your ERP71 Referral Partner portal is ready',
        heading: 'Welcome to the ERP71 Referral Partner programme',
        greeting: (name) => `Hi ${name},`,
        intro: 'You have been invited to the ERP71 Referral Partner portal. From there you can:',
        bullets: [
            'See every business that signed up with your referral code',
            'Track commission earned and payments received',
            'Share your referral code, link and QR code',
        ],
        codeLabel: 'Your referral code',
        signupLinkLabel: 'Your signup link',
        instruction: 'To get started, set your password using the button below.',
        cta: 'Set up your password',
        expiry: (hours) =>
            `This link works for ${hours} hours. If it expires, open it anyway — the page will offer to send you a fresh one.`,
        loginHint: 'After that, sign in any time at',
    },
    bn: {
        subject: 'আপনার ERP71 রেফারেল পার্টনার পোর্টাল প্রস্তুত',
        heading: 'ERP71 রেফারেল পার্টনার প্রোগ্রামে স্বাগতম',
        greeting: (name) => `প্রিয় ${name},`,
        intro: 'আপনাকে ERP71 রেফারেল পার্টনার পোর্টালে আমন্ত্রণ জানানো হয়েছে। সেখান থেকে আপনি পারবেন:',
        bullets: [
            'আপনার রেফারেল কোড দিয়ে সাইন আপ করা প্রতিটি ব্যবসা দেখতে',
            'অর্জিত কমিশন ও প্রাপ্ত পেমেন্ট হিসাব রাখতে',
            'আপনার রেফারেল কোড, লিংক ও QR কোড শেয়ার করতে',
        ],
        codeLabel: 'আপনার রেফারেল কোড',
        signupLinkLabel: 'আপনার সাইনআপ লিংক',
        instruction: 'শুরু করতে নিচের বাটনে ক্লিক করে আপনার পাসওয়ার্ড সেট করুন।',
        cta: 'পাসওয়ার্ড সেট করুন',
        expiry: (hours) =>
            `এই লিংকটি ${hours} ঘণ্টা কাজ করবে। মেয়াদ শেষ হলেও লিংকটি খুলুন — পেজ থেকেই নতুন লিংক পাঠানো যাবে।`,
        loginHint: 'এরপর যেকোনো সময় সাইন ইন করুন এখানে:',
    },
    ms: {
        subject: 'Portal Rakan Rujukan ERP71 anda sudah sedia',
        heading: 'Selamat datang ke program Rakan Rujukan ERP71',
        greeting: (name) => `Hai ${name},`,
        intro: 'Anda telah dijemput ke Portal Rakan Rujukan ERP71. Di sana anda boleh:',
        bullets: [
            'Melihat setiap perniagaan yang mendaftar dengan kod rujukan anda',
            'Menjejaki komisen diperoleh dan bayaran diterima',
            'Berkongsi kod rujukan, pautan dan kod QR anda',
        ],
        codeLabel: 'Kod rujukan anda',
        signupLinkLabel: 'Pautan pendaftaran anda',
        instruction: 'Untuk bermula, tetapkan kata laluan anda melalui butang di bawah.',
        cta: 'Tetapkan kata laluan',
        expiry: (hours) =>
            `Pautan ini sah selama ${hours} jam. Jika tamat tempoh, buka juga — halaman itu akan menawarkan pautan baharu.`,
        loginHint: 'Selepas itu, log masuk bila-bila masa di',
    },
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function renderRefereeInviteEmail(
    locale: EmailLocale,
    vars: RefereeInviteVars,
): { subject: string; html: string } {
    const c = COPY[locale];
    // Not escaped here: every interpolation below runs through escapeHtml, and
    // escaping twice renders a literal `&lt;` to the partner rather than the
    // character it stands for.
    const name = vars.name?.trim() || '';
    // Bangla renders as boxes in clients that pick a Latin-only default, so the
    // body carries an explicit stack. Same list the app's print CSS uses.
    const fontStack =
        locale === 'bn'
            ? `'Noto Sans Bengali', 'SolaimanLipi', 'Nikosh', Arial, sans-serif`
            : `Arial, Helvetica, sans-serif`;

    const bullets = c.bullets.map((b) => `  <li>${escapeHtml(b)}</li>`).join('\n');

    return {
        subject: c.subject,
        html: `<div style="font-family: ${fontStack}; line-height: 1.6; color: #111;">
<h2>${escapeHtml(c.heading)}</h2>
<p>${escapeHtml(c.greeting(name))}</p>
<p>${escapeHtml(c.intro)}</p>
<ul>
${bullets}
</ul>
<p><strong>${escapeHtml(c.codeLabel)}:</strong> ${escapeHtml(vars.referralCode)}</p>
<p><strong>${escapeHtml(c.signupLinkLabel)}:</strong> <a href="${escapeHtml(vars.signupLink)}">${escapeHtml(vars.signupLink)}</a></p>
<p>${escapeHtml(c.instruction)}</p>
<p><a href="${escapeHtml(vars.setupLink)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(c.cta)}</a></p>
<p>${escapeHtml(c.expiry(vars.expiryHours))}</p>
<p>${escapeHtml(c.loginHint)} <a href="${escapeHtml(vars.loginLink)}">${escapeHtml(vars.loginLink)}</a></p>
</div>`,
    };
}

/**
 * The same invite, sized for one or two SMS segments.
 *
 * Deliberately drops the referral code and the signup link — the partner gets both
 * on the dashboard the moment they are in, and every character here is paid for.
 * What SMS is for is the one thing email may not deliver in time: the setup link.
 */
export function renderRefereeInviteSms(
    locale: EmailLocale,
    vars: { name: string; setupLink: string },
): string {
    const name = vars.name?.trim() || '';
    switch (locale) {
        case 'bn':
            return `ERP71 রেফারেল পার্টনার: ${name}, পাসওয়ার্ড সেট করে শুরু করুন: ${vars.setupLink}`;
        case 'ms':
            return `ERP71 Rakan Rujukan: ${name}, tetapkan kata laluan anda: ${vars.setupLink}`;
        default:
            return `ERP71 Referral Partner: ${name}, set your password to get started: ${vars.setupLink}`;
    }
}
