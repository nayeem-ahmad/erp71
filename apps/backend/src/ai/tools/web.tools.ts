import { StorePermission } from '@erp71/shared-types';
import { WebToolRefusal } from '../web-search.service';
import type { ChatTool } from './types';

/**
 * The only tools here that leave the tenant's database.
 *
 * They exist as *tools* rather than as OpenRouter's request-level `web` plugin
 * for one reason: the plugin searches on every message, and almost every message
 * to this assistant is a question about the shop's own numbers. Paying a search
 * fee to answer "what were sales yesterday" is pure waste, and injecting web
 * results into that answer is worse than waste. As tools, they fire only when the
 * model decides the question needs the outside world — and `web-search.service`
 * refuses even then if the query is really about internal data.
 *
 * Both are gated on the `web_search_enabled` platform setting; when it is off the
 * tools are withheld from the tool list entirely, so the model never offers a
 * capability the deployment has not paid for.
 */

/**
 * A refusal is guidance, not a fault: the model should read the reason and reach
 * for a different tool. Shaped as a normal result so the model sees it plainly,
 * with `refused` set so the turn's trace does not list it as a real source.
 */
function refusal(reason: string) {
    return { refused: true, reason };
}

export const WEB_TOOLS: ChatTool[] = [
    {
        name: 'web_search',
        // The weakest permission in the system, matching describe_capabilities:
        // nothing here touches tenant data, so gating it by a data permission
        // would be arbitrary. Cost is controlled by the platform toggle and the
        // per-tenant daily search cap, not by who is asking.
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        featureFlag: 'webSearch',
        description:
            'Search the public web and get back a summary with its sources. Use for facts that live OUTSIDE this ' +
            'business: market or wholesale prices, NBR/VAT rules and other Bangladesh regulations, brand and product ' +
            'information, supplier or competitor background, exchange rates, industry benchmarks, current events. ' +
            'NEVER use it for anything about this business — its sales, stock, customers, dues or accounts are in the ' +
            'report tools and are not on the web. Write the query as you would type it into a search engine, without ' +
            '"my" or "our".',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'The search query. Include the year or "2026" when recency matters, and "Bangladesh" when ' +
                        'the answer is country-specific — prices and tax rules usually are.',
                },
            },
            required: ['query'],
        },
        handler: async (ctx, args, deps) => {
            try {
                const { result, creditsUsed } = await deps.web.search(ctx.tenantId, String(args.query ?? ''));

                // A search runs its own model call, so its cost is invisible to the
                // agent loop's own usage accounting. Fold it in, or the credits
                // shown against this answer understate what it took.
                if (ctx.toolCredits) ctx.toolCredits.total += creditsUsed;

                // Fetching is restricted to what a search actually returned, so
                // this is where a URL earns the right to be read.
                for (const source of result.sources) {
                    try {
                        ctx.fetchableUrls?.add(deps.web.normalizeUrl(source.url));
                    } catch {
                        // A citation we cannot parse simply stays unfetchable.
                    }
                }

                return result;
            } catch (err: unknown) {
                if (err instanceof WebToolRefusal) return refusal(err.message);
                throw err;
            }
        },
    },

    {
        name: 'fetch_web_page',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        featureFlag: 'webSearch',
        description:
            'Read the full text of one web page. Use it to follow up a web_search hit whose summary was not enough — ' +
            'a regulation you need the exact wording of, a price list, a specification table — or to read a link the ' +
            'user pasted into their message. The URL must be one web_search returned in this conversation or one the ' +
            'user typed, copied exactly. Pages rendered entirely by JavaScript will come back empty.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The full https URL, exactly as it appeared in a search result or the user\'s message.',
                },
            },
            required: ['url'],
        },
        handler: async (ctx, args, deps) => {
            const allowed = ctx.fetchableUrls ?? new Set<string>();
            if (allowed.size === 0) {
                return refusal(
                    'No page is available to fetch yet. Call web_search first, then fetch one of the URLs it returns.',
                );
            }

            try {
                const page = await deps.web.fetchPage(String(args.url ?? ''), allowed);
                return {
                    url: page.url,
                    title: page.title,
                    truncated: page.truncated,
                    ...(page.truncated
                        ? { note: 'Only the start of this page is shown — say so if the answer might be further down.' }
                        : {}),
                    text: page.text,
                    // Named `sources` so the turn's trace links it like a search hit.
                    sources: [{ url: page.url, title: page.title ?? page.url }],
                };
            } catch (err: unknown) {
                if (err instanceof WebToolRefusal) return refusal(err.message);
                throw err;
            }
        },
    },
];
