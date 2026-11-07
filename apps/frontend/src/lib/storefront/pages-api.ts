import { publicApiBase } from '@/lib/api-base';
import type { StorefrontMeta } from '@/lib/storefront/storefront-meta';

/**
 * Server-side reads for a shop's standing storefront pages.
 *
 * Same posture as the storefront blog's reader next door: fetch the backend
 * directly rather than through the browser-side rewrite, and resolve on failure
 * instead of throwing, so an outage renders the same "not available" page as a
 * missing page rather than falling through to the root error boundary.
 */

export type StorefrontPageMenuLink = {
    id: string;
    label: string;
    href: string;
    external: boolean;
    open_in_new_tab: boolean;
};

export type StorefrontPageShop = {
    name: string;
    slug: string;
    storefront_banner: string | null;
    storefront_logo: string | null;
    storefront_logo_show_name: boolean;
    brand_primary_color: string | null;
};

export type StorefrontPageContent = {
    slug: string;
    title: string;
    body_md: string;
    seo_title: string | null;
    seo_description: string | null;
    published_at: string | null;
    updated_at: string | null;
};

export const STOREFRONT_PAGE_REVALIDATE_SECONDS = 300;

async function getJson(path: string): Promise<any | null> {
    try {
        const response = await fetch(`${publicApiBase()}${path}`, {
            next: { revalidate: STOREFRONT_PAGE_REVALIDATE_SECONDS },
        });
        if (!response.ok) return null;
        const body = await response.json();
        return body?.data ?? body;
    } catch {
        return null;
    }
}

export async function fetchStorefrontPage(
    shopSlug: string,
    pageSlug: string,
): Promise<{
    shop: StorefrontPageShop | null;
    page: StorefrontPageContent | null;
    menu: StorefrontPageMenuLink[];
}> {
    const data = await getJson(
        `/storefront/${encodeURIComponent(shopSlug)}/pages/${encodeURIComponent(pageSlug)}`,
    );
    if (!data?.page) return { shop: null, page: null, menu: [] };
    return { shop: data.shop ?? null, page: data.page, menu: data.menu ?? [] };
}

/** Identity for document chrome: the page payload, with `/meta` filling any gaps. */
export function storefrontDocumentShop(
    slug: string,
    shop: StorefrontPageShop | null,
    meta: StorefrontMeta | null,
): StorefrontPageShop | null {
    const name = shop?.name ?? meta?.name;
    if (!name) return null;
    return {
        name,
        slug,
        storefront_banner: shop?.storefront_banner ?? meta?.storefront_banner ?? null,
        storefront_logo: shop?.storefront_logo ?? meta?.storefront_logo ?? null,
        storefront_logo_show_name: shop?.storefront_logo_show_name ?? meta?.storefront_logo_show_name ?? true,
        brand_primary_color: shop?.brand_primary_color ?? meta?.brand_primary_color ?? null,
    };
}
