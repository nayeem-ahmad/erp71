import type { Metadata } from 'next';
import { publicApiBase } from '@/lib/api-base';

/**
 * A shop's identity, read on the server so a storefront page can put a real
 * `<title>` and OG card in its `<head>`.
 *
 * The storefront home and shop pages are interactive — a cart, a checkout, a
 * signed-in shopper — so they are client components, and a client component
 * cannot export `generateMetadata`. Every link a shop shared to its own front
 * page therefore previewed as the ERP's global metadata: "ERP71", the platform
 * description, no image. The shop's *pages* and *blog posts* have had proper
 * metadata since they shipped; it was only the two pages anyone actually
 * shares that did not.
 *
 * The fix is a thin server wrapper per route, which is what this module feeds.
 * It reads `/storefront/:slug/meta` rather than `/storefront/:slug` on purpose:
 * the latter answers with the shop's entire in-stock catalogue, and rendering a
 * title should not cost a thousand product rows.
 */

export type StorefrontMeta = {
    name: string;
    slug: string;
    storefront_hero_image: string | null;
    storefront_hero_headline: string | null;
    storefront_logo: string | null;
    brand_primary_color: string | null;
};

/** Matches the storefront pages next door, which revalidate on the same clock. */
export const STOREFRONT_META_REVALIDATE_SECONDS = 300;

/**
 * Resolves to null rather than throwing, like `fetchStorefrontPage`: a backend
 * outage should leave the page to render its own "shop not available" state,
 * not blow up the whole route in `generateMetadata`.
 */
export async function fetchStorefrontMeta(slug: string): Promise<StorefrontMeta | null> {
    try {
        const response = await fetch(
            `${publicApiBase()}/storefront/${encodeURIComponent(slug)}/meta`,
            { next: { revalidate: STOREFRONT_META_REVALIDATE_SECONDS } },
        );
        if (!response.ok) return null;
        const body = await response.json();
        return body?.data ?? body ?? null;
    } catch {
        return null;
    }
}

/**
 * Metadata for one of a shop's two interactive pages.
 *
 * `noindex` when the shop cannot be resolved — a slug that is wrong, or a
 * storefront switched off — so a crawler that reaches a dead storefront does
 * not bank the URL.
 */
export function storefrontMetadata(
    meta: StorefrontMeta | null,
    page: { suffix?: string; description: string },
): Metadata {
    if (!meta) {
        return { title: 'Shop not available', robots: { index: false, follow: false } };
    }

    const title = page.suffix ? `${meta.name} — ${page.suffix}` : meta.name;
    // The shop's own headline is the sentence its owner wrote about itself, so
    // it beats anything generic we could compose from the slug.
    const description = meta.storefront_hero_headline?.trim() || page.description;
    const image = meta.storefront_hero_image || meta.storefront_logo;

    return {
        title,
        description,
        openGraph: {
            type: 'website',
            title,
            description,
            ...(image ? { images: [{ url: image }] } : {}),
        },
    };
}
