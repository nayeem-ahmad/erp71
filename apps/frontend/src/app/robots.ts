import type { MetadataRoute } from 'next';

/**
 * Crawler policy for the public app.
 *
 * `/q/` and `/s/` are the URL-shortener's public surface. A `/q/<token>` page is
 * a customer's quotation — their name, every line item, the pricing — living on
 * a permanent, unguessable URL with no login. `/s/<code>` redirects into those
 * (and into off-domain targets via the interstitial), so indexing it is a second
 * route to the same documents.
 *
 * Neither is secret-by-obscurity alone — the quotation page also sends
 * `noindex, nofollow` in its own metadata — but robots.txt is what a
 * well-behaved crawler reads before it ever requests the page.
 *
 * `/store/` is left crawlable on purpose: storefronts and their per-product
 * pages are marketing, and shop owners want them found.
 */
import { siteOrigin } from '@/lib/blog/api';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/q/', '/s/'],
        },
        // Pointing at the sitemap here is what makes it discoverable without
        // anyone submitting it: robots.txt is the first thing a crawler reads.
        sitemap: `${siteOrigin()}/sitemap.xml`,
    };
}
