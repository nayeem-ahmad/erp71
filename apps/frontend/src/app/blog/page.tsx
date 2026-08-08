import type { Metadata } from 'next';
import Link from 'next/link';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import PostCard from '@/components/blog/PostCard';
import { fetchCategories, fetchPosts, siteOrigin } from '@/lib/blog/api';

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

export const metadata: Metadata = {
    title: 'Blog — ERP71',
    description: 'Guides, product updates and notes on running a shop in Bangladesh.',
    alternates: {
        canonical: `${siteOrigin()}/blog`,
        types: { 'application/rss+xml': `${siteOrigin()}/blog/rss.xml` },
    },
    openGraph: {
        type: 'website',
        title: 'The ERP71 blog',
        description: 'Practical writing for shop owners — stock, cash, staff and the software in between.',
        url: `${siteOrigin()}/blog`,
    },
};

export default async function BlogIndexPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string }>;
}) {
    const { page: pageParam } = await searchParams;
    const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);

    const [list, categories] = await Promise.all([
        fetchPosts({ page, limit: PAGE_SIZE }),
        fetchCategories(),
    ]);

    const lastPage = Math.max(Math.ceil(list.total / PAGE_SIZE), 1);

    return (
        <div className="min-h-screen bg-white">
            <MarketingNav active="blog" />

            <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
                <header className="border-b border-gray-100 pb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">The ERP71 blog</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
                        Practical writing for shop owners — stock, cash, staff and the software in between.
                    </p>
                </header>

                {categories.length > 0 && (
                    <nav className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
                        <span className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                            All posts
                        </span>
                        {categories.map((category) => (
                            <Link
                                key={category.id}
                                href={`/blog/category/${category.slug}`}
                                className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600"
                            >
                                {category.name_en}
                            </Link>
                        ))}
                    </nav>
                )}

                {list.rows.length === 0 ? (
                    <p className="mt-12 text-sm text-gray-500">No posts yet. Check back soon.</p>
                ) : (
                    <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {list.rows.map((post) => (
                            <PostCard key={post.id} post={post} />
                        ))}
                    </div>
                )}

                {lastPage > 1 && (
                    <nav className="mt-12 flex items-center justify-between border-t border-gray-100 pt-6" aria-label="Pagination">
                        {page > 1 ? (
                            <Link
                                href={page === 2 ? '/blog' : `/blog?page=${page - 1}`}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
                                ← Newer
                            </Link>
                        ) : (
                            <span />
                        )}
                        <span className="text-xs text-gray-500">
                            Page {page} of {lastPage}
                        </span>
                        {page < lastPage ? (
                            <Link href={`/blog?page=${page + 1}`} className="text-sm font-medium text-blue-600 hover:underline">
                                Older →
                            </Link>
                        ) : (
                            <span />
                        )}
                    </nav>
                )}
            </main>

            <MarketingFooter />
        </div>
    );
}
