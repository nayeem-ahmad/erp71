import type { Metadata } from 'next';
import Link from 'next/link';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import BlogSubscribeBand from '@/components/blog/BlogSubscribeBand';
import FeaturedPost from '@/components/blog/FeaturedPost';
import PostCard from '@/components/blog/PostCard';
import BlogLanguageSwitch from '@/components/blog/BlogLanguageSwitch';
import { categoryName, fetchCategories, fetchPosts, siteOrigin } from '@/lib/blog/api';
import { blogHref, blogStrings, resolveBlogLocale } from '@/lib/blog/locale';

/**
 * The blog index — a server component, which is the whole point of it.
 *
 * Every other marketing page in this tree is `'use client'` and fetches from the
 * browser, so a crawler receives an empty shell. An article that nobody can
 * index is an article nobody reads, so the blog renders its content into the
 * initial HTML and exports real metadata.
 *
 * ISR rather than `force-dynamic`: posts change rarely, and publishing calls
 * the revalidation route so a new post appears at once rather than after the
 * window.
 */
// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

const PAGE_SIZE = 12;

/**
 * Metadata is generated rather than static because the title, description and
 * canonical all move with `?lang`. `alternates.languages` is what stops the two
 * versions competing: without it a crawler sees near-duplicate pages at two
 * URLs and picks one, which is usually not the one the reader wanted.
 */
export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
    const { lang } = await searchParams;
    const locale = resolveBlogLocale(lang);
    const t = blogStrings(locale);
    const origin = siteOrigin();

    return {
        title: `${t.blogTitle} — ERP71`,
        description: t.blogTagline,
        alternates: {
            canonical: `${origin}${blogHref('/blog', locale)}`,
            languages: {
                en: `${origin}/blog`,
                bn: `${origin}/blog?lang=bn`,
            },
            types: { 'application/rss+xml': `${origin}/blog/rss.xml` },
        },
        openGraph: {
            type: 'website',
            title: t.blogTitle,
            description: t.blogTagline,
            url: `${origin}${blogHref('/blog', locale)}`,
            locale: locale === 'bn' ? 'bn_BD' : 'en_US',
        },
    };
}

export default async function BlogIndexPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string; lang?: string }>;
}) {
    const { page: pageParam, lang } = await searchParams;
    const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);
    const locale = resolveBlogLocale(lang);
    const t = blogStrings(locale);

    const [list, categories] = await Promise.all([
        fetchPosts({ locale, page, limit: PAGE_SIZE }),
        fetchCategories(),
    ]);

    /** This page's own URL, minus the language, for the switch to rewrite. */
    const selfPath = page === 1 ? '/blog' : `/blog?page=${page}`;

    const lastPage = Math.max(Math.ceil(list.total / PAGE_SIZE), 1);

    // The lead story belongs to page 1 only — deeper pages are an archive, and
    // promoting a post there would just re-promote whatever fell to the top.
    // The backend sorts `featured` ahead of `published_at`, so this is the
    // editor's pick when there is one and the newest post otherwise.
    const lead = page === 1 ? list.rows[0] : undefined;
    const rest = lead ? list.rows.slice(1) : list.rows;

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />

            <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
                <header>
                    <div className="flex items-start justify-between gap-4">
                        <h1 className="text-5xl font-black leading-none tracking-tighter text-gray-900 md:text-6xl">
                            {t.blogTitle}
                        </h1>
                        <BlogLanguageSwitch path={selfPath} locale={locale} />
                    </div>
                    <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
                        {t.blogTagline}
                    </p>
                </header>

                {categories.length > 0 && (
                    <nav className="mt-6 flex flex-wrap gap-2" aria-label={t.categories}>
                        <span className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                            {t.allPosts}
                        </span>
                        {categories.map((category) => (
                            <Link
                                key={category.id}
                                href={blogHref(`/blog/category/${category.slug}`, locale)}
                                className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600"
                            >
                                {categoryName(category, locale)}
                            </Link>
                        ))}
                    </nav>
                )}

                {lead && (
                    <div className="mt-10 border-t border-gray-100 pt-10">
                        <FeaturedPost post={lead} locale={locale} />
                    </div>
                )}

                {list.rows.length === 0 && (
                    <p className="mt-12 text-base text-gray-500">{t.noPosts}</p>
                )}

                {rest.length > 0 && (
                    <section className="mt-14 border-t border-gray-100 pt-8">
                        <div className="flex items-baseline justify-between gap-4">
                            {/* Deeper pages are already labelled by the pager below,
                                so they get the neutral heading rather than a second
                                "page N" the reader has to reconcile. */}
                            <h2 className="text-lg font-bold tracking-tight text-gray-900">
                                {lead ? t.latestPosts : t.morePosts}
                            </h2>
                            <Link
                                href="/blog/rss.xml"
                                className="text-xs font-semibold text-blue-600 hover:underline"
                            >
                                {t.rssFeed}
                            </Link>
                        </div>

                        <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                            {rest.map((post) => (
                                <PostCard key={post.id} post={post} locale={locale} />
                            ))}
                        </div>
                    </section>
                )}

                {lastPage > 1 && (
                    <nav className="mt-12 flex items-center justify-between border-t border-gray-100 pt-6" aria-label={t.pageOf(page, lastPage)}>
                        {page > 1 ? (
                            <Link
                                href={blogHref(page === 2 ? '/blog' : `/blog?page=${page - 1}`, locale)}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
                                {t.newer}
                            </Link>
                        ) : (
                            <span />
                        )}
                        <span className="text-xs text-gray-500">
                            {t.pageOf(page, lastPage)}
                        </span>
                        {page < lastPage ? (
                            <Link
                                href={blogHref(`/blog?page=${page + 1}`, locale)}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
                                {t.older}
                            </Link>
                        ) : (
                            <span />
                        )}
                    </nav>
                )}

                <BlogSubscribeBand />
            </main>

            <MarketingFooter />
        </div>
    );
}
