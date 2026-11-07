import type { Metadata } from 'next';
import Link from 'next/link';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import StorefrontDocumentShell from '@/components/storefront/StorefrontDocumentShell';
import { fetchStorefrontMeta } from '@/lib/storefront/storefront-meta';
import { fetchStorefrontPage, storefrontDocumentShop } from '@/lib/storefront/pages-api';

/**
 * One of a shop's standing pages — "About us", "Delivery & returns".
 *
 * Server-rendered and indexable, like the storefront blog and for the same
 * reason: a shop's returns policy is a page its customers search for by name,
 * and a client-rendered one is a page they never find.
 *
 * The article is still HTML in the first response. Banner, logo, menu and
 * footer come from `StorefrontDocumentShell` so the page matches the shop's
 * home rather than a narrower document layout of its own.
 */
// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here.
export const revalidate = 300;

type Params = { slug: string; pageSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug, pageSlug } = await params;
    const { page, shop } = await fetchStorefrontPage(slug, pageSlug);

    if (!page) {
        return { title: 'Page not available', robots: { index: false, follow: false } };
    }

    return {
        title: `${page.seo_title ?? page.title}${shop ? ` — ${shop.name}` : ''}`,
        description: page.seo_description ?? undefined,
        openGraph: {
            type: 'article',
            title: page.seo_title ?? page.title,
            description: page.seo_description ?? undefined,
            modifiedTime: page.updated_at ?? undefined,
        },
    };
}

function Unavailable({ shopSlug }: { shopSlug: string }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This page isn&apos;t available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    It may have been removed, or the link may be out of date.
                </p>
                <Link
                    href={`/store/${shopSlug}`}
                    className="mt-4 inline-block text-xs font-medium text-blue-600 hover:underline"
                >
                    Back to the shop
                </Link>
            </div>
        </main>
    );
}

export default async function StorefrontContentPage({ params }: { params: Promise<Params> }) {
    const { slug, pageSlug } = await params;
    const [{ page, shop, menu }, meta] = await Promise.all([
        fetchStorefrontPage(slug, pageSlug),
        fetchStorefrontMeta(slug),
    ]);

    const chrome = storefrontDocumentShop(slug, shop, meta);
    if (!page || !chrome) return <Unavailable shopSlug={slug} />;

    const here = `/store/${slug}/pages/${page.slug}`;

    return (
        <StorefrontDocumentShell slug={slug} shop={chrome} menuLinks={menu} activeHref={here}>
            <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-gray-900">{page.title}</h1>
                <div className="mt-8">
                    <ArticleMarkdown content={page.body_md ?? ''} variant="article" />
                </div>
            </article>
        </StorefrontDocumentShell>
    );
}
