/**
 * Turns the raw request context of a short-link click into the row that gets
 * stored.
 *
 * The shortener records every click rather than only counting it, so this is
 * where "a Referer header and a User-Agent string" becomes something a report
 * can group by: a referrer host, a channel bucket, a browser/OS/device, campaign
 * tags. The raw values are kept alongside the derived ones, so improving the
 * parsing later means re-running it over stored rows rather than having thrown
 * the evidence away.
 *
 * Deliberately free of NestJS and Prisma imports so it can be read and tested as
 * a unit, same as `is-safe-target.ts`.
 *
 * Nothing here throws. A click is best-effort telemetry attached to a redirect
 * someone is waiting on: a header we cannot parse must degrade to `null`, never
 * cost the visitor their destination.
 */

export type ClickChannel = 'DIRECT' | 'SEARCH' | 'SOCIAL' | 'EMAIL' | 'INTERNAL' | 'REFERRAL';
export type ClickDeviceType = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'BOT';

export interface ClickInput {
    referrer?: string | null;
    userAgent?: string | null;
    /** Query string of the `/s/<code>` request, with or without the leading `?`. */
    query?: string | null;
    /** Raw `Accept-Language` header. */
    language?: string | null;
    ipAddress?: string | null;
    country?: string | null;
    city?: string | null;
}

export interface ClickContext {
    referrer: string | null;
    referrer_host: string | null;
    channel: ClickChannel;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    query: string | null;
    user_agent: string | null;
    browser: string | null;
    os: string | null;
    device_type: ClickDeviceType;
    is_bot: boolean;
    ip_address: string | null;
    country: string | null;
    city: string | null;
    language: string | null;
}

/**
 * Every column is fed by an anonymous caller, so each one is bounded on write.
 * The generous ones (referrer, user_agent, query) match what a real browser
 * sends; the tight ones exist so a junk header cannot bloat the table.
 */
const LIMITS = {
    referrer: 2048,
    referrer_host: 255,
    utm: 255,
    query: 2048,
    user_agent: 1024,
    browser: 64,
    os: 64,
    ip_address: 64,
    country: 8,
    city: 128,
    language: 32,
} as const;

/** Hosts whose traffic is search. A trailing dot means "any TLD" (google.com.bd). */
const SEARCH_HOSTS = [
    'google.', 'bing.com', 'duckduckgo.com', 'yahoo.', 'yandex.', 'baidu.com',
    'ecosia.org', 'search.brave.com', 'startpage.com', 'qwant.com', 'ask.com',
];

const SOCIAL_HOSTS = [
    'facebook.com', 'fb.com', 'fb.me', 'messenger.com', 'instagram.com',
    'twitter.com', 'x.com', 't.co',
    'linkedin.com', 'lnkd.in',
    'whatsapp.com', 'wa.me',
    't.me', 'telegram.me', 'telegram.org',
    'tiktok.com', 'youtube.com', 'youtu.be',
    'pinterest.com', 'reddit.com', 'snapchat.com', 'threads.net', 'threads.com',
    'quora.com', 'tumblr.com', 'discord.com',
];

const EMAIL_HOSTS = [
    'mail.google.com', 'outlook.com', 'outlook.live.com', 'outlook.office.com',
    'mail.yahoo.com', 'mail.proton.me', 'zoho.com', 'mail.ru',
];

/** Our own domains — a click arriving from one of these is in-app navigation. */
const INTERNAL_HOSTS = ['erp71.com', 'localhost', '127.0.0.1'];

/**
 * Crawlers and link-preview fetchers.
 *
 * These are recorded rather than dropped: a WhatsApp or Facebook preview fetch
 * is a real signal that the link was shared somewhere, it just is not a human
 * opening it. Flagging lets a report exclude them; dropping would make "shared
 * but never clicked" indistinguishable from "never shared".
 */
const BOT_PATTERNS = [
    'bot', 'crawler', 'crawling', 'spider', 'slurp', 'archiver', 'scraper',
    'facebookexternalhit', 'whatsapp', 'telegram', 'skypeuripreview',
    'bingpreview', 'embedly', 'quora link preview', 'vkshare',
    'curl/', 'wget/', 'python-requests', 'go-http-client', 'okhttp', 'axios/',
    'headlesschrome', 'phantomjs', 'lighthouse', 'pingdom', 'uptimerobot',
    'monitoring', 'preview',
];

/**
 * Control characters in a header are malformed input, not content — they make a
 * stored value unreadable and would smuggle newlines into anything that later
 * prints these rows. Collapsed to spaces before the length cap, so the cap
 * measures real characters.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function clean(value: string | null | undefined, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.replace(CONTROL_CHARS, ' ').trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
}

/**
 * Host of the referring page, lowercased and without `www.`.
 *
 * Returns null for anything that is not an absolute http(s) URL — a browser
 * sending `Referer: about:blank`, or a hand-rolled client sending a bare path,
 * must not end up as a "host" that reports then group by.
 */
function referrerHost(referrer: string | null): string | null {
    if (!referrer) return null;
    try {
        const { hostname, protocol } = new URL(referrer);
        if (protocol !== 'http:' && protocol !== 'https:') return null;
        const host = hostname.toLowerCase();
        return clean(host.startsWith('www.') ? host.slice(4) : host, LIMITS.referrer_host);
    } catch {
        return null;
    }
}

/**
 * Match a host against the lists above on a label boundary, never as a bare
 * substring — that is what keeps `notfacebook.com.evil.io` out of the SOCIAL
 * bucket. A trailing dot in the pattern means "this name under any TLD".
 */
function hostMatches(host: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
        if (!pattern.endsWith('.')) {
            return host === pattern || host.endsWith(`.${pattern}`);
        }
        // `google.` matches google.com, google.com.bd, www stripped already, and
        // subdomains like news.google.co.uk.
        const name = pattern.slice(0, -1);
        return host === name || host.startsWith(`${name}.`) || host.includes(`.${name}.`);
    });
}

/**
 * Coarse acquisition bucket.
 *
 * A recognised referrer host wins over `utm_medium`, because it says where the
 * click physically came from while the medium only says what kind of placement
 * it was. Reading them the other way round files a Facebook ad tagged
 * `utm_medium=cpc` under SEARCH, which is the single most common way these
 * buckets go wrong.
 *
 * `utm_medium` is the fallback rather than the tiebreaker, and it earns its
 * place: paid placements very often arrive with the Referer header stripped, so
 * without it every ad click would land in DIRECT.
 */
function classifyChannel(host: string | null, utmMedium: string | null, utmSource: string | null): ClickChannel {
    if (host) {
        if (hostMatches(host, EMAIL_HOSTS)) return 'EMAIL';
        if (hostMatches(host, SEARCH_HOSTS)) return 'SEARCH';
        if (hostMatches(host, SOCIAL_HOSTS)) return 'SOCIAL';
        if (hostMatches(host, INTERNAL_HOSTS)) return 'INTERNAL';
    }

    const medium = (utmMedium ?? '').toLowerCase();
    if (medium) {
        if (medium.includes('email') || medium.includes('newsletter')) return 'EMAIL';
        if (medium.includes('social') || medium.includes('sms') || medium.includes('whatsapp')) return 'SOCIAL';
        if (medium.includes('cpc') || medium.includes('ppc') || medium.includes('paid') || medium.includes('search')) {
            return 'SEARCH';
        }
    }

    // A referrer we do not recognise is still a referral from somewhere real.
    if (host) return 'REFERRAL';

    // No referrer at all. A utm_source still means the link was placed somewhere
    // deliberately, so calling that "direct" would undercount every campaign
    // whose platform strips the Referer header (most apps do).
    return utmSource ? 'REFERRAL' : 'DIRECT';
}

function isBot(ua: string): boolean {
    const lower = ua.toLowerCase();
    return BOT_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Browser family. Order is the whole trick: Edge and Opera both claim to be
 * Chrome, Chrome claims to be Safari, and every one of them says "Mozilla/5.0".
 * The most specific token has to be tested first.
 */
function parseBrowser(ua: string): string | null {
    const lower = ua.toLowerCase();
    if (lower.includes('edg/') || lower.includes('edga/') || lower.includes('edgios/')) return 'Edge';
    if (lower.includes('opr/') || lower.includes('opera')) return 'Opera';
    if (lower.includes('samsungbrowser')) return 'Samsung Internet';
    if (lower.includes('ucbrowser')) return 'UC Browser';
    if (lower.includes('firefox') || lower.includes('fxios')) return 'Firefox';
    if (lower.includes('crios') || lower.includes('chrome') || lower.includes('chromium')) return 'Chrome';
    if (lower.includes('safari')) return 'Safari';
    if (lower.includes('msie') || lower.includes('trident')) return 'Internet Explorer';
    return null;
}

function parseOs(ua: string): string | null {
    const lower = ua.toLowerCase();
    // iOS-family tokens are checked before macOS: an iPad on iPadOS 13+ reports
    // itself as "Macintosh", so the other order puts every modern iPad on macOS.
    if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod')) return 'iOS';
    if (lower.includes('android')) return 'Android';
    if (lower.includes('windows phone')) return 'Windows Phone';
    if (lower.includes('windows')) return 'Windows';
    if (lower.includes('cros')) return 'ChromeOS';
    if (lower.includes('mac os x') || lower.includes('macintosh')) return 'macOS';
    if (lower.includes('linux')) return 'Linux';
    return null;
}

function parseDeviceType(ua: string, bot: boolean): ClickDeviceType {
    if (bot) return 'BOT';
    const lower = ua.toLowerCase();
    if (lower.includes('ipad') || lower.includes('tablet') || lower.includes('kindle') || lower.includes('playbook')) {
        return 'TABLET';
    }
    // Android's own convention: a tablet sends "Android" without "Mobile".
    if (lower.includes('android') && !lower.includes('mobile')) return 'TABLET';
    if (
        lower.includes('mobi') ||
        lower.includes('iphone') ||
        lower.includes('ipod') ||
        lower.includes('windows phone')
    ) {
        return 'MOBILE';
    }
    return 'DESKTOP';
}

/** Primary language tag, e.g. `bn-BD,bn;q=0.9,en;q=0.8` -> `bn-BD`. */
function parseLanguage(header: string | null): string | null {
    if (!header) return null;
    const first = header.split(',')[0]?.split(';')[0]?.trim();
    if (!first || !/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(first)) return null;
    return clean(first, LIMITS.language);
}

type UtmFields = Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string | null>;

function parseUtm(query: string | null): UtmFields {
    const empty: UtmFields = { source: null, medium: null, campaign: null, term: null, content: null };
    if (!query) return empty;
    try {
        const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
        return {
            source: clean(params.get('utm_source'), LIMITS.utm),
            medium: clean(params.get('utm_medium'), LIMITS.utm),
            campaign: clean(params.get('utm_campaign'), LIMITS.utm),
            term: clean(params.get('utm_term'), LIMITS.utm),
            content: clean(params.get('utm_content'), LIMITS.utm),
        };
    } catch {
        return empty;
    }
}

export function buildClickContext(input: ClickInput = {}): ClickContext {
    const referrer = clean(input.referrer, LIMITS.referrer);
    const host = referrerHost(referrer);
    const query = clean(input.query, LIMITS.query);
    const utm = parseUtm(query);

    const userAgent = clean(input.userAgent, LIMITS.user_agent);
    const bot = userAgent ? isBot(userAgent) : false;

    return {
        referrer,
        referrer_host: host,
        channel: classifyChannel(host, utm.medium, utm.source),
        utm_source: utm.source,
        utm_medium: utm.medium,
        utm_campaign: utm.campaign,
        utm_term: utm.term,
        utm_content: utm.content,
        query,
        user_agent: userAgent,
        browser: userAgent ? clean(parseBrowser(userAgent), LIMITS.browser) : null,
        os: userAgent ? clean(parseOs(userAgent), LIMITS.os) : null,
        // No User-Agent at all is not a browser. Calling it DESKTOP would quietly
        // pad the desktop numbers with scripted traffic.
        device_type: userAgent ? parseDeviceType(userAgent, bot) : 'BOT',
        is_bot: userAgent ? bot : true,
        ip_address: clean(input.ipAddress, LIMITS.ip_address),
        country: clean(input.country, LIMITS.country)?.toUpperCase() ?? null,
        city: clean(input.city, LIMITS.city),
        language: parseLanguage(clean(input.language, 512)),
    };
}
