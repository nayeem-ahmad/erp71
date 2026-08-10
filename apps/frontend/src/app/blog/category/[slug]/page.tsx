import type { Metadata } from 'next';
import Link from 'next/link';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import PostCard from '@/components/blog/PostCard';
import { fetchCategories, fetchPosts, siteOrigin } from '@/lib/blog/api';

// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

const PAGE_SIZE = 12;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const categories = await fetchCategories();
    const category = categories.find((c) => c.slug === slug);

    if (!category) {
        return { title: 'Category not found — ERP71', robots: { index: false, follow: false } };
    }

    return {
        title: `${category.name_en} — ERP71 blog`,
        description: `ERP71 blog posts filed under ${category.name_en}.`,
        alternates: { canonical: `${siteOrigin()}/blog/category/${category.slug}` },
    };
}

export default async function BlogCategoryPage({
    params,
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<{ page?: string }>;
}) {
    const { slug } = await params;
    const { page: pageParam } = await searchParams;
    const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);

    const [list, categories] = await Promise.all([
        fetchPosts({ category: slug, page, limit: PAGE_SIZE }),
        fetchCategories(),
    ]);

    const category = categories.find((c) => c.slug === slug);
    const lastPage = Math.max(Math.ceil(list.total / PAGE_SIZE), 1);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />

            <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
                <Link href="/blog" className="text-sm font-semibold text-blue-600 hover:underline">
                    ← All posts
                </Link>

                <header className="mt-6 border-b border-gray-100 pb-8">
                    <h1 className="text-5xl font-black leading-none tracking-tighter text-gray-900 md:text-6xl">
                        {category?.name_en ?? slug}
                    </h1>
                </header>

                <nav className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
                    <Link
                        href="/blog"
                        className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600"
                    >
                        All posts
                    </Link>
                    {categories.map((item) => (
                        <Link
                            key={item.id}
                            href={`/blog/category/${item.slug}`}
                            className={
                                item.slug === slug
                                    ? 'rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white'
                                    : 'rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600'
                            }
                        >
                            {item.name_en}
                        </Link>
                    ))}
                </nav>

                {list.rows.length === 0 ? (
                    <p className="mt-12 text-base text-gray-500">No posts in this category yet.</p>
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
                                href={page === 2 ? `/blog/category/${slug}` : `/blog/category/${slug}?page=${page - 1}`}
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
                            <Link
                                href={`/blog/category/${slug}?page=${page + 1}`}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
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
