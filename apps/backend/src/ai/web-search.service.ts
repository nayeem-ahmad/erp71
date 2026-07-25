import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AiService, type WebCitation } from './ai.service';

/**
 * Outside-world lookups for the data chatbot.
 *
 * Everything else the assistant can reach is the tenant's own database, where a
 * query is cheap, private, and trustworthy by construction. None of those three
 * hold here, so this service carries the guards the rest of the tool layer does
 * not need: a per-tenant daily spend ceiling, a refusal to spend anything on a
 * question the internal tools should have answered, and — for page fetches — a
 * network allow-list, because a URL chosen by a language model is a URL chosen
 * by whoever wrote the page it came from.
 */

/** Search summary length. The citations matter more than the prose. */
const SEARCH_MAX_TOKENS = 1200;

/** Bytes read from a fetched page before we stop. Well past any article. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Characters of extracted text handed back to the model. */
const MAX_PAGE_CHARS = 8_000;
const PAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

const FETCHABLE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'];

/**
 * Ranges a fetch must never reach. The interesting entries are not the obvious
 * loopback ones: 169.254.169.254 (link-local) is the cloud metadata endpoint
 * that turns a page fetch into credential theft, and 100.64/10 is carrier-grade
 * NAT, which on a VPS host is other tenants.
 */
const BLOCKED_V4: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
];

const BLOCKED_V6: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['64:ff9b::', 96],
];

function buildBlockList(): BlockList {
    const list = new BlockList();
    for (const [net, prefix] of BLOCKED_V4) list.addSubnet(net, prefix, 'ipv4');
    for (const [net, prefix] of BLOCKED_V6) list.addSubnet(net, prefix, 'ipv6');
    return list;
}

const BLOCKED_ADDRESSES = buildBlockList();

/**
 * First-person references to the business, which make a query nonsense as a web
 * search: the open web has no record of *this* shop's sales. Their presence is a
 * reliable sign the model reached for the web when it should have reached for a
 * report tool, so we refuse before spending a search fee.
 */
const FIRST_PERSON = /\b(my|our|ours|we|us)\b/i;
const INTERNAL_NOUN =
    /\b(sales?|revenue|turnover|stock|inventory|customers?|suppliers?|dues?|profits?|expenses?|invoices?|purchases?|cash|receivables?|payables?|margins?|branch(es)?|employees?|salar(y|ies)|vouchers?|ledgers?)\b/i;

export interface WebSearchResult {
    query: string;
    answer: string;
    sources: Array<{ url: string; title: string }>;
    excerpts: Array<{ url: string; content: string }>;
    note?: string;
}

export interface WebPageResult {
    url: string;
    title: string | null;
    text: string;
    truncated: boolean;
}

/** Thrown for a condition the model should hear about and work around. */
export class WebToolRefusal extends Error {}

@Injectable()
export class WebSearchService {
    private readonly logger = new Logger(WebSearchService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly ai: AiService,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    /** Whether the platform operator has turned paid web lookups on at all. */
    async isEnabled(): Promise<boolean> {
        const raw = await this.platformSettings.getRawValue('ai', 'web_search_enabled');
        return String(raw ?? 'false').toLowerCase() === 'true';
    }

    // ── Search ───────────────────────────────────────────────────────────────

    async search(tenantId: string, rawQuery: string): Promise<{ result: WebSearchResult; creditsUsed: number }> {
        const query = rawQuery.trim();
        if (query.length < 3) {
            throw new WebToolRefusal('Give a search query of at least a few words.');
        }

        if (FIRST_PERSON.test(query) && INTERNAL_NOUN.test(query)) {
            throw new WebToolRefusal(
                `"${query}" asks about this business's own records, which are not on the public web. ` +
                    'Use the internal report tools for that. If you meant to look up an external figure — a market ' +
                    'rate, a regulation, a brand — search for it without referring to "my" or "our" business.',
            );
        }

        await this.enforceDailyCap(tenantId);

        const [model, engine, maxResults] = await Promise.all([
            this.ai.getWebSearchModel(),
            this.getEngine(),
            this.getMaxResults(),
        ]);

        const { text, citations, usage } = await this.ai.callOpenRouterWithWebSearch(
            model,
            query,
            { engine, maxResults, systemPrompt: this.buildSearchPrompt() },
            SEARCH_MAX_TOKENS,
        );
        const creditsUsed = await this.ai.logUsage(tenantId, 'web_search', model, usage);

        if (citations.length === 0) {
            return {
                result: {
                    query,
                    answer: text,
                    sources: [],
                    excerpts: [],
                    note:
                        'The search returned no citable sources. Treat the summary above as unverified — say you ' +
                        'could not confirm it rather than presenting it as fact.',
                },
                creditsUsed,
            };
        }

        return {
            result: {
                query,
                answer: text,
                sources: citations.map((c) => ({ url: c.url, title: c.title })),
                excerpts: this.trimExcerpts(citations),
                note:
                    'These are public web sources, not this business\'s records. Attribute any figure you take from ' +
                    'them to its source and give the date if the page states one.',
            },
            creditsUsed,
        };
    }

    private buildSearchPrompt(): string {
        return [
            'You are a research step inside a business assistant, not the assistant itself.',
            'Search the web for the query and report what the sources actually say.',
            'Rules:',
            '- Report only what is in the sources. If they disagree, say so and give both figures.',
            '- Always state the date or period a figure applies to when a source gives one.',
            '- If the sources do not answer the query, say exactly that. Do not fall back on your own knowledge.',
            '- Be dense and factual. No preamble, no advice, no formatting beyond short paragraphs.',
        ].join('\n');
    }

    /**
     * Search results carry a chunk of page text each, which is the bulk of what a
     * multi-source search costs on the next round-trip. Trimming per source keeps
     * a five-result search from crowding out the rest of the conversation.
     */
    private trimExcerpts(citations: WebCitation[]): Array<{ url: string; content: string }> {
        const perSource = Math.max(Math.floor(MAX_PAGE_CHARS / Math.max(citations.length, 1)), 400);
        return citations
            .filter((c) => c.content)
            .map((c) => ({
                url: c.url,
                content: c.content.length > perSource ? `${c.content.slice(0, perSource)}…` : c.content,
            }));
    }

    private async getEngine(): Promise<string> {
        const raw = (await this.platformSettings.getRawValue('ai', 'web_search_engine'))?.trim();
        return raw || 'exa';
    }

    private async getMaxResults(): Promise<number> {
        const raw = await this.platformSettings.getRawValue('ai', 'web_search_max_results');
        const parsed = Number(raw ?? 5);
        if (!Number.isFinite(parsed)) return 5;
        return Math.min(Math.max(Math.trunc(parsed), 1), 10);
    }

    /**
     * A search is billed per request by the search provider, so this ceiling
     * bounds real money rather than tokens. Counted from the usage log, which
     * already records one row per search under the `web_search` feature.
     */
    private async enforceDailyCap(tenantId: string): Promise<void> {
        const raw = await this.platformSettings.getRawValue('ai', 'web_search_daily_cap');
        const cap = Number(raw ?? 50);
        if (!Number.isFinite(cap) || cap <= 0) return;

        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const used = await this.db.aiUsageLog.count({
            where: { tenant_id: tenantId, feature: 'web_search', created_at: { gte: since } },
        });
        if (used >= cap) {
            throw new WebToolRefusal(
                `This business has used its ${cap} web searches for today. Answer from the internal report tools ` +
                    'and tell the user web lookups are unavailable until tomorrow.',
            );
        }
    }

    // ── Page fetch ───────────────────────────────────────────────────────────

    /**
     * Reads one page as text. `allowed` is the set of URLs that reached the model
     * legitimately this turn — search results and links the user typed — and a URL
     * outside it is refused. Without that, "fetch a page" is a request to make the
     * server issue arbitrary HTTP from inside the production network on behalf of
     * whatever text a model was persuaded to emit.
     */
    async fetchPage(url: string, allowed: ReadonlySet<string>): Promise<WebPageResult> {
        const normalized = this.normalizeUrl(url);
        if (!allowed.has(normalized)) {
            throw new WebToolRefusal(
                `"${url}" is not one of the URLs from this conversation's search results. Run web_search first and ` +
                    'fetch a URL it returned, exactly as returned.',
            );
        }

        let current = normalized;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            await this.assertPublicAddress(current);
            const response = await this.request(current);

            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location) {
                // Re-validate every hop: the allow-list covers where we were sent,
                // not where that page decided to send us next.
                current = this.normalizeUrl(new URL(location, current).toString());
                continue;
            }

            if (!response.ok) {
                throw new WebToolRefusal(`${current} returned HTTP ${response.status}.`);
            }

            const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
            if (!FETCHABLE_CONTENT_TYPES.some((type) => contentType.includes(type))) {
                throw new WebToolRefusal(
                    `${current} is ${contentType || 'an unknown content type'}, which cannot be read as text. ` +
                        'Only HTML and plain text pages can be fetched.',
                );
            }

            const html = await this.readCapped(response);
            const { title, text } = this.extractText(html, contentType);
            if (!text) {
                throw new WebToolRefusal(`${current} had no readable text — it is probably rendered by JavaScript.`);
            }

            return {
                url: current,
                title,
                text: text.length > MAX_PAGE_CHARS ? `${text.slice(0, MAX_PAGE_CHARS)}…` : text,
                truncated: text.length > MAX_PAGE_CHARS,
            };
        }

        throw new WebToolRefusal(`${normalized} redirected more than ${MAX_REDIRECTS} times.`);
    }

    private async request(url: string): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
        try {
            return await fetch(url, {
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    // Identify the fetcher honestly; some sites block blank agents.
                    'User-Agent': 'ERP71-Assistant/1.0 (+https://erp71.com)',
                    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
                    'Accept-Language': 'en,bn;q=0.8',
                },
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new WebToolRefusal(`Could not load ${url}: ${msg}`);
        } finally {
            clearTimeout(timer);
        }
    }

    /** Rejects a non-web scheme, an odd port, or a host that resolves inward. */
    private async assertPublicAddress(url: string): Promise<void> {
        const parsed = new URL(url);

        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new WebToolRefusal(`Only http and https URLs can be fetched, not "${parsed.protocol}".`);
        }
        if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
            throw new WebToolRefusal(`Only the standard web ports can be fetched, not port ${parsed.port}.`);
        }

        const host = parsed.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host)
            ? [host]
            : await lookup(host, { all: true, verbatim: true })
                  .then((records) => records.map((r) => r.address))
                  .catch(() => {
                      throw new WebToolRefusal(`Could not resolve "${host}".`);
                  });

        if (addresses.length === 0) {
            throw new WebToolRefusal(`Could not resolve "${host}".`);
        }

        // Every resolved address must be public: a host that returns one public
        // and one internal address would otherwise be a coin flip.
        for (const address of addresses) {
            if (!this.isPublicAddress(address)) {
                this.logger.warn(`Blocked page fetch to non-public address ${address} (${host})`);
                throw new WebToolRefusal(
                    `"${host}" resolves to a private network address and cannot be fetched.`,
                );
            }
        }
    }

    private isPublicAddress(address: string): boolean {
        // ::ffff:10.0.0.1 is 10.0.0.1 wearing a hat — compare the address it maps.
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
        const candidate = mapped ? mapped[1] : address;
        const version = isIP(candidate);
        if (version === 0) return false;
        return !BLOCKED_ADDRESSES.check(candidate, version === 4 ? 'ipv4' : 'ipv6');
    }

    /** Reads the body with a byte budget so a huge page cannot exhaust memory. */
    private async readCapped(response: Response): Promise<string> {
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
            throw new WebToolRefusal('That page is too large to read.');
        }

        const reader = response.body?.getReader();
        if (!reader) return '';

        const chunks: Uint8Array[] = [];
        let total = 0;
        while (total < MAX_PAGE_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                total += value.byteLength;
            }
        }
        await reader.cancel().catch(() => undefined);

        return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
    }

    /**
     * Strips markup down to readable text.
     *
     * Deliberately regex-based rather than a parser dependency: the output is
     * consumed by a language model, which tolerates imperfect segmentation far
     * better than the tool result budget tolerates boilerplate. The order matters
     * — element *contents* that are never prose (scripts, styles, nav chrome) go
     * before tags are stripped, or their text survives into the result.
     */
    private extractText(source: string, contentType: string): { title: string | null; text: string } {
        if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
            return { title: null, text: this.collapse(source) };
        }

        const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1];

        const stripped = source
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<(script|style|noscript|template|svg|canvas|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
            // Keep block boundaries as newlines so lists and tables stay legible.
            .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/t[dh]>/gi, '\t')
            .replace(/<[^>]+>/g, ' ');

        return { title: title ? this.collapse(this.decodeEntities(title)) || null : null, text: this.collapse(this.decodeEntities(stripped)) };
    }

    private decodeEntities(value: string): string {
        return value
            .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d?);/gi, (match, entity: string) => {
                const named: Record<string, string> = {
                    amp: '&',
                    lt: '<',
                    gt: '>',
                    quot: '"',
                    apos: "'",
                    nbsp: ' ',
                    mdash: '—',
                    ndash: '–',
                    hellip: '…',
                    trade: '™',
                    reg: '®',
                    copy: '©',
                    taka: '৳',
                };
                const lower = entity.toLowerCase();
                if (named[lower]) return named[lower];
                if (lower.startsWith('#x')) {
                    const code = Number.parseInt(lower.slice(2), 16);
                    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
                }
                if (lower.startsWith('#')) {
                    const code = Number.parseInt(lower.slice(1), 10);
                    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
                }
                return match;
            });
    }

    private collapse(value: string): string {
        return value
            .replace(/[ \t\f\v ]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Canonical form used for allow-list membership, so a URL the model retypes
     * with a trailing slash or a tracking parameter still matches what search
     * returned — and so two spellings of the same URL cannot be used to smuggle
     * one past the check.
     */
    normalizeUrl(raw: string): string {
        let parsed: URL;
        try {
            parsed = new URL(raw.trim());
        } catch {
            throw new WebToolRefusal(`"${raw}" is not a valid URL.`);
        }
        parsed.hash = '';
        for (const param of [...parsed.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(param)) parsed.searchParams.delete(param);
        }
        const normalized = parsed.toString();
        return normalized.endsWith('/') && parsed.pathname === '/' && !parsed.search
            ? normalized.slice(0, -1)
            : normalized;
    }

    /** URLs a user typed into their own message — legitimate fetch targets. */
    extractUrls(text: string): string[] {
        const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
        const out: string[] = [];
        for (const match of matches) {
            try {
                out.push(this.normalizeUrl(match.replace(/[.,;:!?]+$/, '')));
            } catch {
                // A malformed URL in prose is not an error worth surfacing.
            }
        }
        return out;
    }
}
