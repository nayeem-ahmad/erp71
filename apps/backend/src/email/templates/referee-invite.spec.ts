import {
    renderRefereeInviteEmail,
    renderRefereeInviteSms,
    resolveEmailLocale,
} from './referee-invite';

describe('referee invite templates', () => {
    const vars = {
        name: 'Rahman Traders',
        referralCode: 'RAHMA1B2C3',
        setupLink: 'https://app.erp71.com/reset-password?token=ABCDEFGHIJKLMNOPQRSTU',
        loginLink: 'https://app.erp71.com/login',
        signupLink: 'https://app.erp71.com/r/RAHMA1B2C3',
        expiryHours: 72,
    };

    describe('resolveEmailLocale', () => {
        it.each([
            ['bn', 'bn'],
            ['BN', 'bn'],
            ['bn-BD', 'bn'],
            ['en_US', 'en'],
            ['ms', 'ms'],
        ])('normalises %s to %s', (input, expected) => {
            expect(resolveEmailLocale(input)).toBe(expected);
        });

        /** `preferred_locale` is user-editable and predates these templates. */
        it.each([[null], [undefined], [''], ['klingon']])('falls back to English for %s', (input) => {
            expect(resolveEmailLocale(input as string | null)).toBe('en');
        });
    });

    it('sends a Bangla partner a Bangla subject and body', () => {
        const { subject, html } = renderRefereeInviteEmail('bn', vars);
        expect(subject).toContain('রেফারেল');
        expect(html).toContain('পাসওয়ার্ড সেট করুন');
        // Bangla renders as boxes in a client that picks a Latin-only default.
        expect(html).toContain('Noto Sans Bengali');
    });

    /**
     * The old copy said "expires in 1 hour" because it was inherited from password
     * resets, and stayed true only by accident. The number now comes from the caller
     * that issued the token.
     */
    it('states the expiry it was given rather than a hard-coded one', () => {
        expect(renderRefereeInviteEmail('en', vars).html).toContain('72 hours');
        expect(renderRefereeInviteEmail('en', { ...vars, expiryHours: 24 }).html).toContain('24 hours');
    });

    it('carries the code, the setup link and the signup link in every locale', () => {
        for (const locale of ['en', 'bn', 'ms'] as const) {
            const { html } = renderRefereeInviteEmail(locale, vars);
            expect(html).toContain(vars.referralCode);
            expect(html).toContain(vars.setupLink);
            expect(html).toContain(vars.signupLink);
        }
    });

    it('escapes a name that contains markup', () => {
        const { html } = renderRefereeInviteEmail('en', { ...vars, name: '<script>x</script>' });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    describe('SMS', () => {
        /**
         * A Bangla SMS is billed at ~67 characters per segment. The wording is
         * written to that budget; this is the guard that keeps an edit from
         * quietly tripling the cost of every invite.
         */
        it('fits a Bangla invite in three segments', () => {
            const message = renderRefereeInviteSms('bn', {
                name: 'Rahman Traders',
                setupLink: vars.setupLink,
            });
            expect(message).toContain(vars.setupLink);
            expect(message.length).toBeLessThanOrEqual(67 * 3);
        });

        it('fits an English invite in a single 160-character segment', () => {
            const message = renderRefereeInviteSms('en', {
                name: 'Rahman Traders',
                setupLink: vars.setupLink,
            });
            expect(message.length).toBeLessThanOrEqual(160);
        });

        /** Every character costs money; the code and signup link are on the dashboard. */
        it('carries the setup link and nothing else', () => {
            const message = renderRefereeInviteSms('en', { name: 'R', setupLink: vars.setupLink });
            expect(message).not.toContain(vars.referralCode);
        });
    });
});
