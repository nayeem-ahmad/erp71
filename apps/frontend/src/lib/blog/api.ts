import { publicApiBase } from '@/lib/api-base';

/**
 * Server-side reads for the public blog.
 *
 * These run in server components, so they fetch `publicApiBase()` directly
 * rather than going through the `/api/v1/*` rewrite in `next.config.js` — that
 * rewrite is a browser-side path, and a server component calling back into its
 * own origin is a pointless extra hop that also breaks when the frontend is
 * reached on a hostname the container cannot resolve.
 *
 * Every function resolves rather than throwing on failure. An uncaught throw in
 * a server component falls through to the root `error.tsx`, which renders
 * different markup from a "not found" — making an outage visibly
 * distinguishable from a missing post, and leaking a raw message with it. The
 * public product page documents the same rule.
 */

export type BlogListPost = {
    id: string;
    slug: string;
    locale: string;
    title: string;
    excerpt: string | null;
    cover_image_url: string | null;
    cover_alt: string | null;
    author_name: string | null;
    author_title: string | null;
    published_at: string | null;
    edited_at: string | null;
    reading_minutes: number;
    featured: boolean;
    category: { slug: string; name_en: string; name_bn: string | null; name_ms: string | null } | null;
    available_locales: string[];
};

export type BlogPost = BlogListPost & {
    body_md: string;
    seo_title: string | null;
    seo_description: string | null;
    view_count: number;
};

export type BlogCategory = {
    id: string;
    slug: string;
    name_en: string;
    name_bn: string | null;
    name_ms: string | null;
};

export type BlogList = {
    rows: BlogListPost[];
    total: number;
    page: number;
    limit: number;
};

const EMPTY_LIST: BlogList = { rows: [], total: 0, page: 1, limit: 12 };

/** Revalidation window for blog reads. Publishing does not wait for it. */
export const BLOG_REVALIDATE_SECONDS = 300;

async function getJson(path: string): Promise<any | null> {
    try {
        const response = await fetch(`${publicApiBase()}${path}`, {
            next: { revalidate: BLOG_REVALIDATE_SECONDS, tags: ['blog'] },
        });
        if (!response.ok) return null;
        const body = await response.json();
        return body?.data ?? body;
    } catch {
        return null;
    }
}

export async function fetchPosts(options: {
    locale?: string;
    category?: string;
    page?: number;
    limit?: number;
} = {}): Promise<BlogList> {
    const query = new URLSearchParams();
    if (options.locale) query.set('locale', options.locale);
    if (options.category) query.set('category', options.category);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const data = await getJson(`/blog/posts${query.size ? `?${query}` : ''}`);
    if (!data?.rows) return EMPTY_LIST;
    return data as BlogList;
}

export async function fetchCategories(): Promise<BlogCategory[]> {
    const data = await getJson('/blog/categories');
    return Array.isArray(data) ? data : [];
}

/**
 * A post, or a redirect target when the slug is one the post used to have.
 * `null` for both means genuinely missing.
 */
export async function fetchPost(
    slug: string,
    locale?: string,
): Promise<{ post: BlogPost | null; redirect_to: string | null }> {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    const data = await getJson(`/blog/posts/${encodeURIComponent(slug)}${query}`);
    if (!data) return { post: null, redirect_to: null };
    return { post: data.post ?? null, redirect_to: data.redirect_to ?? null };
}

/** Category display name for a locale, falling back to English. */
export function categoryName(
    category: { name_en: string; name_bn?: string | null; name_ms?: string | null } | null,
    locale: string,
): string {
    if (!category) return '';
    if (locale === 'bn' && category.name_bn) return category.name_bn;
    if (locale === 'ms' && category.name_ms) return category.name_ms;
    return category.name_en;
}

/**
 * Canonical site origin for absolute URLs in metadata, JSON-LD and RSS.
 *
 * Relative URLs are fine in a page but wrong in a feed or an OpenGraph tag,
 * which are read far from the page they came from.
 */
export function siteOrigin(): string {
    const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
    return (configured || 'https://app.erp71.com').replace(/\/+$/, '');
}
