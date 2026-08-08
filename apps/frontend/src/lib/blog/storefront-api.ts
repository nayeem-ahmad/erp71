import { publicApiBase } from '@/lib/api-base';

/**
 * Server-side reads for a shop's storefront blog.
 *
 * Same posture as the platform blog's reader: fetch the backend directly rather
 * than through the browser-side rewrite, and resolve on failure instead of
 * throwing, so an outage renders the same "not available" page as a missing
 * post rather than falling through to the root error boundary.
 */

export type StorefrontBlogPost = {
    slug: string;
    title: string;
    excerpt: string | null;
    body_md?: string;
    cover_image_url: string | null;
    cover_alt: string | null;
    author_name: string | null;
    published_at: string | null;
    edited_at: string | null;
    reading_minutes: number;
    featured: boolean;
    category: { slug: string; name: string } | null;
    seo_title?: string | null;
    seo_description?: string | null;
};

export type StorefrontBlogHeader = {
    title: string;
    tagline?: string | null;
    shop_name: string;
};

export const STOREFRONT_BLOG_REVALIDATE_SECONDS = 300;

async function getJson(path: string): Promise<any | null> {
    try {
        const response = await fetch(`${publicApiBase()}${path}`, {
            next: { revalidate: STOREFRONT_BLOG_REVALIDATE_SECONDS },
        });
        if (!response.ok) return null;
        const body = await response.json();
        return body?.data ?? body;
    } catch {
        return null;
    }
}

export async function fetchStorefrontPosts(
    shopSlug: string,
    options: { page?: number; limit?: number; category?: string } = {},
): Promise<{
    blog: StorefrontBlogHeader | null;
    rows: StorefrontBlogPost[];
    categories: { slug: string; name: string }[];
    total: number;
} | null> {
    const query = new URLSearchParams();
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));
    if (options.category) query.set('category', options.category);

    const data = await getJson(
        `/storefront/${encodeURIComponent(shopSlug)}/blog/posts${query.size ? `?${query}` : ''}`,
    );
    if (!data?.rows) return null;
    return data;
}

export async function fetchStorefrontPost(
    shopSlug: string,
    postSlug: string,
): Promise<{ blog: StorefrontBlogHeader | null; post: StorefrontBlogPost | null; redirect_to: string | null }> {
    const data = await getJson(
        `/storefront/${encodeURIComponent(shopSlug)}/blog/posts/${encodeURIComponent(postSlug)}`,
    );
    if (!data) return { blog: null, post: null, redirect_to: null };
    return { blog: data.blog ?? null, post: data.post ?? null, redirect_to: data.redirect_to ?? null };
}
