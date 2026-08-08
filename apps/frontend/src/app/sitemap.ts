import type { MetadataRoute } from 'next';
import { fetchCategories, fetchPosts, siteOrigin } from '@/lib/blog/api';

/**
 * Sitemap for the public site.
 *
 * There was no sitemap at all before this — `robots.ts` allowed crawling and
 * then left every page to incidental discovery. The blog needs one, and the
 * marketing and legal pages have needed one since they shipped.
 *
 * What is deliberately absent mirrors `robots.ts`: `/q/` and `/s/` are a
 * customer's quotation and the shortener that points at it, and listing either
 * would hand a crawler the URLs robots.txt asks it not to fetch. Storefronts
 * are absent for a different reason — there is one per shop, they change
 * constantly, and a shop's own storefront sitemap is the right place for them.
 */

/** Rebuilt on the same cadence as the blog pages themselves. */
export const revalidate = 3600;

const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '', priority: 1, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/blog', priority: 0.8, changeFrequency: 'daily' },
    { path: '/contact', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/refund', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/sla', priority: 0.3, changeFrequency: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const origin = siteOrigin();
    const now = new Date();

    // A blog fetch that fails must not take the whole sitemap down with it —
    // the static half is still worth serving, and `fetchPosts` already resolves
    // to an empty list rather than throwing.
    const [posts, categories] = await Promise.all([fetchPosts({ limit: 50 }), fetchCategories()]);

    return [
        ...STATIC_PATHS.map((entry) => ({
            url: `${origin}${entry.path}`,
            lastModified: now,
            changeFrequency: entry.changeFrequency,
            priority: entry.priority,
        })),
        ...categories.map((category) => ({
            url: `${origin}/blog/category/${category.slug}`,
            lastModified: now,
            changeFrequency: 'weekly' as const,
            priority: 0.5,
        })),
        ...posts.rows.map((post) => ({
            url: `${origin}/blog/${post.slug}`,
            lastModified: post.edited_at ? new Date(post.edited_at) : post.published_at ? new Date(post.published_at) : now,
            changeFrequency: 'monthly' as const,
            priority: post.featured ? 0.8 : 0.7,
        })),
    ];
}
