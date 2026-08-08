import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchStorefrontPosts } from '@/lib/blog/storefront-api';

/**
 * A shop's blog index, on its own storefront.
 *
 * Server-rendered and indexable, unlike the rest of the storefront tree — the
 * whole point of letting a shop write is that the writing gets found. `robots.ts`
 * leaves `/store/` crawlable for the same reason it leaves product pages
 * crawlable: this is the shop's marketing, and the owner wants it seen.
 */
// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

const PAGE_SIZE = 12;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const data = await fetchStorefrontPosts(slug, { limit: 1 });

    if (!data?.blog) {
        return { title: 'Blog not available', robots: { index: false, follow: false } };
    }

    return {
        title: data.blog.title,
        description: data.blog.tagline ?? `News and updates from ${data.blog.shop_name}.`,
    };
}

function Unavailable() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This blog isn&apos;t available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    The shop may not have a blog, or the link may be out of date.
                </p>
            </div>
        </main>
    );
}

function formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function StorefrontBlogIndexPage({
    params,
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<{ page?: string; category?: string }>;
}) {
    const { slug } = await params;
    const { page: pageParam, category } = await searchParams;
    const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);

    const data = await fetchStorefrontPosts(slug, { page, limit: PAGE_SIZE, category });
    if (!data?.blog) return <Unavailable />;

    const lastPage = Math.max(Math.ceil(data.total / PAGE_SIZE), 1);
    const pageHref = (target: number) => {
        const query = new URLSearchParams();
        if (category) query.set('category', category);
        if (target > 1) query.set('page', String(target));
        return `/store/${slug}/blog${query.size ? `?${query}` : ''}`;
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <main className="mx-auto max-w-4xl px-4 py-8 md:px-6">
                <header className="border-b border-gray-200 pb-6">
                    <Link href={`/store/${slug}`} className="text-xs font-medium text-blue-600 hover:underline">
                        ← {data.blog.shop_name}
                    </Link>
                    <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-900">{data.blog.title}</h1>
                    {data.blog.tagline && <p className="mt-2 text-sm text-gray-600">{data.blog.tagline}</p>}
                </header>

                {data.categories.length > 0 && (
                    <nav className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
                        <Link
                            href={`/store/${slug}/blog`}
                            className={
                                category
                                    ? 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-blue-600 hover:text-blue-600'
                                    : 'rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white'
                            }
                        >
                            All posts
                        </Link>
                        {data.categories.map((item) => (
                            <Link
                                key={item.slug}
                                href={`/store/${slug}/blog?category=${encodeURIComponent(item.slug)}`}
                                className={
                                    category === item.slug
                                        ? 'rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white'
                                        : 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-blue-600 hover:text-blue-600'
                                }
                            >
                                {item.name}
                            </Link>
                        ))}
                    </nav>
                )}

                {data.rows.length === 0 ? (
                    <p className="mt-10 text-sm text-gray-500">No posts yet.</p>
                ) : (
                    <div className="mt-6 space-y-4">
                        {data.rows.map((post) => (
                            <article
                                key={post.slug}
                                className="overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors hover:border-blue-600"
                            >
                                <Link href={`/store/${slug}/blog/${post.slug}`} className="flex flex-col sm:flex-row">
                                    {post.cover_image_url && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={post.cover_image_url}
                                            alt={post.cover_alt ?? ''}
                                            loading="lazy"
                                            className="h-40 w-full object-cover sm:h-auto sm:w-48"
                                        />
                                    )}
                                    <div className="flex-1 p-4">
                                        {post.category && (
                                            <span className="text-xs font-medium text-blue-600">{post.category.name}</span>
                                        )}
                                        <h2 className="mt-1 text-sm font-semibold text-gray-900">{post.title}</h2>
                                        {post.excerpt && (
                                            <p className="mt-2 line-clamp-2 text-xs leading-6 text-gray-600">{post.excerpt}</p>
                                        )}
                                        <p className="mt-3 text-xs text-gray-500">
                                            {formatDate(post.published_at)}
                                            {post.reading_minutes ? ` · ${post.reading_minutes} min read` : ''}
                                        </p>
                                    </div>
                                </Link>
                            </article>
                        ))}
                    </div>
                )}

                {lastPage > 1 && (
                    <nav className="mt-8 flex items-center justify-between border-t border-gray-200 pt-6" aria-label="Pagination">
                        {page > 1 ? (
                            <Link href={pageHref(page - 1)} className="text-sm font-medium text-blue-600 hover:underline">
                                ← Newer
                            </Link>
                        ) : (
                            <span />
                        )}
                        <span className="text-xs text-gray-500">
                            Page {page} of {lastPage}
                        </span>
                        {page < lastPage ? (
                            <Link href={pageHref(page + 1)} className="text-sm font-medium text-blue-600 hover:underline">
                                Older →
                            </Link>
                        ) : (
                            <span />
                        )}
                    </nav>
                )}
            </main>
        </div>
    );
}
