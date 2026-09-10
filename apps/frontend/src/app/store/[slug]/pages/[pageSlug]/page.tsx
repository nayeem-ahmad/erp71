import type { Metadata } from 'next';
import Link from 'next/link';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import { fetchStorefrontPage, type StorefrontPageMenuLink } from '@/lib/storefront/pages-api';

/**
 * One of a shop's standing pages — "About us", "Delivery & returns".
 *
 * Server-rendered and indexable, like the storefront blog and for the same
 * reason: a shop's returns policy is a page its customers search for by name,
 * and a client-rendered one is a page they never find.
 *
 * It carries its own light chrome rather than the cart-bearing
 * `StorefrontHeader`: nothing on this page can be added to a basket, and
 * pulling in that component would drag the whole cart-and-session client bundle
 * onto a static document.
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

function MenuLink({ link }: { link: StorefrontPageMenuLink }) {
    const className = 'text-gray-500 transition-colors hover:text-gray-900';

    // `noopener` on every external entry, not only the new-tab ones: a shopper
    // middle-clicking a same-tab link opens it in a tab all the same.
    return link.external ? (
        <a
            href={link.href}
            target={link.open_in_new_tab ? '_blank' : undefined}
            rel="noopener noreferrer"
            className={className}
        >
            {link.label}
        </a>
    ) : (
        <Link href={link.href} className={className}>
            {link.label}
        </Link>
    );
}

export default async function StorefrontContentPage({ params }: { params: Promise<Params> }) {
    const { slug, pageSlug } = await params;
    const { page, shop, menu } = await fetchStorefrontPage(slug, pageSlug);

    if (!page) return <Unavailable shopSlug={slug} />;

    const here = `/store/${slug}/pages/${page.slug}`;

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            <header className="border-b border-gray-100 bg-white">
                <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 md:px-6">
                    <Link href={`/store/${slug}`} className="text-lg font-bold tracking-tight text-gray-900">
                        {shop?.name ?? 'Shop'}
                    </Link>
                    <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium">
                        <Link href={`/store/${slug}/shop`} className="text-gray-500 transition-colors hover:text-gray-900">
                            Shop
                        </Link>
                        {menu.map((link) =>
                            link.href === here ? (
                                <span key={link.id} className="text-gray-900" aria-current="page">
                                    {link.label}
                                </span>
                            ) : (
                                <MenuLink key={link.id} link={link} />
                            ),
                        )}
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
                <article className="rounded-lg border border-gray-200 bg-white p-4 md:p-6">
                    <h1 className="text-2xl font-bold leading-tight tracking-tight text-gray-900">{page.title}</h1>
                    <div className="mt-6">
                        <ArticleMarkdown content={page.body_md ?? ''} />
                    </div>
                </article>
            </main>
        </div>
    );
}
