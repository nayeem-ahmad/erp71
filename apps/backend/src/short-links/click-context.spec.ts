import { buildClickContext } from './click-context';

/**
 * These cases concentrate on the three ways click analytics goes quietly wrong:
 * a channel bucket that misattributes real traffic, a device parse that files
 * every iPad or bot as a desktop visitor, and unbounded caller-supplied text
 * reaching the table. Each of those produces a number that still looks fine on a
 * dashboard, which is exactly why they need pinning.
 */
describe('buildClickContext', () => {
    const IPHONE =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const IPAD =
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const ANDROID_PHONE =
        'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    const ANDROID_TABLET =
        'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    const WINDOWS_CHROME =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const WINDOWS_EDGE = `${WINDOWS_CHROME} Edg/120.0.0.0`;

    describe('channel', () => {
        it('reads a bare visit with no referrer as direct', () => {
            expect(buildClickContext({ userAgent: WINDOWS_CHROME }).channel).toBe('DIRECT');
        });

        it.each([
            ['google.com', 'SEARCH'],
            ['www.google.com.bd', 'SEARCH'],
            ['news.google.co.uk', 'SEARCH'],
            ['bing.com', 'SEARCH'],
            ['l.facebook.com', 'SOCIAL'],
            ['m.youtube.com', 'SOCIAL'],
            ['t.co', 'SOCIAL'],
            ['mail.google.com', 'EMAIL'],
            ['app.erp71.com', 'INTERNAL'],
            ['somerandomblog.net', 'REFERRAL'],
        ])('buckets a referrer from %s as %s', (host, expected) => {
            expect(buildClickContext({ referrer: `https://${host}/page` }).channel).toBe(expected);
        });

        it('matches known hosts on a label boundary, not as a substring', () => {
            // `notfacebook.com.evil.io` contains "facebook.com". Bucketing it as
            // SOCIAL would let anyone inflate a tenant's social numbers just by
            // registering a lookalike domain.
            expect(buildClickContext({ referrer: 'https://notfacebook.com.evil.io/x' }).channel).toBe('REFERRAL');
            expect(buildClickContext({ referrer: 'https://nogoogle.example.com/x' }).channel).toBe('REFERRAL');
        });

        it('lets a recognised referrer host outrank utm_medium', () => {
            // A Facebook ad is tagged utm_medium=cpc. Reading the medium first
            // would file it under SEARCH — the most common way these buckets rot.
            const context = buildClickContext({
                referrer: 'https://l.facebook.com/',
                query: '?utm_source=facebook&utm_medium=cpc',
            });
            expect(context.channel).toBe('SOCIAL');
        });

        it('falls back to utm_medium when the referrer was stripped', () => {
            // Ad platforms routinely send no Referer at all; without this every
            // paid click would be counted as direct traffic.
            expect(buildClickContext({ query: '?utm_medium=cpc' }).channel).toBe('SEARCH');
            expect(buildClickContext({ query: '?utm_medium=email' }).channel).toBe('EMAIL');
            expect(buildClickContext({ query: '?utm_medium=whatsapp' }).channel).toBe('SOCIAL');
        });

        it('counts a tagged link with no referrer as a referral, not direct', () => {
            expect(buildClickContext({ query: '?utm_source=printed-flyer' }).channel).toBe('REFERRAL');
        });
    });

    describe('referrer_host', () => {
        it('strips www and lowercases', () => {
            expect(buildClickContext({ referrer: 'https://WWW.Example.COM/a/b' }).referrer_host).toBe('example.com');
        });

        it.each([['about:blank'], ['/relative/path'], ['not a url'], ['javascript:alert(1)']])(
            'returns null rather than a fake host for %s',
            (referrer) => {
                expect(buildClickContext({ referrer }).referrer_host).toBeNull();
            },
        );

        it('keeps the raw referrer even when the host cannot be parsed', () => {
            // The raw value is what a better parser could re-derive from later.
            expect(buildClickContext({ referrer: 'about:blank' }).referrer).toBe('about:blank');
        });
    });

    describe('device and browser', () => {
        it.each([
            [IPHONE, 'MOBILE', 'iOS', 'Safari'],
            [IPAD, 'TABLET', 'iOS', 'Safari'],
            [ANDROID_PHONE, 'MOBILE', 'Android', 'Chrome'],
            [ANDROID_TABLET, 'TABLET', 'Android', 'Chrome'],
            [WINDOWS_CHROME, 'DESKTOP', 'Windows', 'Chrome'],
            [WINDOWS_EDGE, 'DESKTOP', 'Windows', 'Edge'],
        ])('classifies %s', (userAgent, device, os, browser) => {
            const context = buildClickContext({ userAgent });
            expect(context.device_type).toBe(device);
            expect(context.os).toBe(os);
            expect(context.browser).toBe(browser);
        });

        it('does not report an iPad as macOS', () => {
            // iPadOS 13+ sends "Macintosh" in its desktop-mode UA; testing macOS
            // before the iOS tokens puts every modern iPad in the desktop bucket.
            expect(buildClickContext({ userAgent: IPAD }).os).toBe('iOS');
        });

        it('does not report Edge as Chrome', () => {
            // Edge's UA ends with Edg/… but still contains "Chrome".
            expect(buildClickContext({ userAgent: WINDOWS_EDGE }).browser).toBe('Edge');
        });
    });

    describe('bots', () => {
        it.each([
            'facebookexternalhit/1.1',
            'WhatsApp/2.23.20.0',
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'curl/8.4.0',
            'TelegramBot (like TwitterBot)',
        ])('flags %s as a bot', (userAgent) => {
            const context = buildClickContext({ userAgent });
            expect(context.is_bot).toBe(true);
            expect(context.device_type).toBe('BOT');
        });

        it('keeps a bot click rather than discarding it', () => {
            // A WhatsApp preview fetch proves the link was shared somewhere. Drop
            // it and "shared but never opened" looks identical to "never shared".
            const context = buildClickContext({ userAgent: 'WhatsApp/2.23.20.0', referrer: 'https://example.com/' });
            expect(context.user_agent).toBe('WhatsApp/2.23.20.0');
            expect(context.referrer_host).toBe('example.com');
        });

        it('treats a missing user agent as a bot, not a desktop visitor', () => {
            // No UA at all is a script. Defaulting to DESKTOP would pad the
            // desktop numbers with traffic that was never a browser.
            const context = buildClickContext({});
            expect(context.device_type).toBe('BOT');
            expect(context.is_bot).toBe(true);
            expect(context.browser).toBeNull();
        });

        it('does not flag a real browser as a bot', () => {
            expect(buildClickContext({ userAgent: WINDOWS_CHROME }).is_bot).toBe(false);
        });
    });

    describe('utm tags', () => {
        it('pulls every tag off the query string', () => {
            const context = buildClickContext({
                query: '?utm_source=fb&utm_medium=cpc&utm_campaign=eid-sale&utm_term=saree&utm_content=variant-a',
            });

            expect(context).toMatchObject({
                utm_source: 'fb',
                utm_medium: 'cpc',
                utm_campaign: 'eid-sale',
                utm_term: 'saree',
                utm_content: 'variant-a',
            });
        });

        it('accepts a query string with or without the leading ?', () => {
            expect(buildClickContext({ query: 'utm_source=fb' }).utm_source).toBe('fb');
        });

        it('keeps the raw query so a tag we do not parse today is not lost', () => {
            expect(buildClickContext({ query: '?fbclid=abc123&gclid=xyz' }).query).toBe('?fbclid=abc123&gclid=xyz');
        });

        it('leaves the tags null when there is no query at all', () => {
            expect(buildClickContext({}).utm_source).toBeNull();
        });
    });

    describe('language', () => {
        it('takes the primary tag off Accept-Language', () => {
            expect(buildClickContext({ language: 'bn-BD,bn;q=0.9,en;q=0.8' }).language).toBe('bn-BD');
        });

        it('rejects a value that is not a language tag', () => {
            expect(buildClickContext({ language: '<script>alert(1)</script>' }).language).toBeNull();
        });
    });

    describe('bounds and hygiene', () => {
        it('caps a referrer that would otherwise bloat the row', () => {
            const huge = `https://example.com/${'a'.repeat(5000)}`;
            expect(buildClickContext({ referrer: huge }).referrer!.length).toBe(2048);
        });

        it('caps an oversized user agent', () => {
            expect(buildClickContext({ userAgent: 'x'.repeat(5000) }).user_agent!.length).toBe(1024);
        });

        it('strips control characters so a header cannot smuggle newlines into a stored value', () => {
            const context = buildClickContext({ referrer: 'https://example.com/\r\nX-Injected: yes' });
            expect(context.referrer).not.toContain('\n');
            expect(context.referrer).not.toContain('\r');
        });

        it('normalises an empty or whitespace-only header to null', () => {
            expect(buildClickContext({ referrer: '   ', userAgent: '' }).referrer).toBeNull();
        });

        it('uppercases the country code so reports do not split BD from bd', () => {
            expect(buildClickContext({ country: 'bd' }).country).toBe('BD');
        });

        it('never throws on garbage input', () => {
            expect(() =>
                buildClickContext({
                    referrer: '%%%not-a-url%%%',
                    query: '%E0%A4%A',
                    language: ';;;;',
                    userAgent: ' ',
                }),
            ).not.toThrow();
        });
    });
});
