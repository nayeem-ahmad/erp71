import type { Metadata } from 'next';
import Link from 'next/link';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import PostCard from '@/components/blog/PostCard';
import BlogLanguageSwitch from '@/components/blog/BlogLanguageSwitch';
import { categoryName, fetchCategories, fetchPosts, siteOrigin } from '@/lib/blog/api';
import { blogHref, blogStrings, resolveBlogLocale } from '@/lib/blog/locale';

// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

const PAGE_SIZE = 12;

type Params = { slug: string };
type Search = { page?: string; lang?: string };

export async function generateMetadata({
    params,
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<Search>;
}): Promise<Metadata> {
    const { slug } = await params;
    const { lang } = await searchParams;
    const locale = resolveBlogLocale(lang);
    const categories = await fetchCategories();
    const category = categories.find((c) => c.slug === slug);

    if (!category) {
        return { title: 'Category not found — ERP71', robots: { index: false, follow: false } };
    }

    const base = `/blog/category/${category.slug}`;
    const name = categoryName(category, locale);
    const origin = siteOrigin();

    return {
        title: `${name} — ERP71 blog`,
        description:
            locale === 'bn'
                ? `${name} বিভাগে ইআরপি৭১ ব্লগের লেখা।`
                : `ERP71 blog posts filed under ${name}.`,
        alternates: {
            canonical: `${origin}${blogHref(base, locale)}`,
            languages: { en: `${origin}${base}`, bn: `${origin}${base}?lang=bn` },
        },
    };
}

export default async function BlogCategoryPage({
    params,
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<Search>;
}) {
    const { slug } = await params;
    const { page: pageParam, lang } = await searchParams;
    const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);
    const locale = resolveBlogLocale(lang);
    const t = blogStrings(locale);

    const [list, categories] = await Promise.all([
        fetchPosts({ locale, category: slug, page, limit: PAGE_SIZE }),
        fetchCategories(),
    ]);

    /** This page's own URL, minus the language, for the switch to rewrite. */
    const selfPath = page === 1 ? `/blog/category/${slug}` : `/blog/category/${slug}?page=${page}`;

    const category = categories.find((c) => c.slug === slug);
    const lastPage = Math.max(Math.ceil(list.total / PAGE_SIZE), 1);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />

            <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
                <div className="flex items-center justify-between gap-4">
                    <Link
                        href={blogHref('/blog', locale)}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                        {t.backToAllPosts}
                    </Link>
                    <BlogLanguageSwitch path={selfPath} locale={locale} />
                </div>

                <header className="mt-6 border-b border-gray-100 pb-8">
                    <h1 className="text-5xl font-black leading-none tracking-tighter text-gray-900 md:text-6xl">
                        {category ? categoryName(category, locale) : slug}
                    </h1>
                </header>

                <nav className="mt-6 flex flex-wrap gap-2" aria-label={t.categories}>
                    <Link
                        href={blogHref('/blog', locale)}
                        className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600"
                    >
                        {t.allPosts}
                    </Link>
                    {categories.map((item) => (
                        <Link
                            key={item.id}
                            href={blogHref(`/blog/category/${item.slug}`, locale)}
                            className={
                                item.slug === slug
                                    ? 'rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white'
                                    : 'rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600'
                            }
                        >
                            {categoryName(item, locale)}
                        </Link>
                    ))}
                </nav>

                {list.rows.length === 0 ? (
                    <p className="mt-12 text-base text-gray-500">{t.noPostsInCategory}</p>
                ) : (
                    <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {list.rows.map((post) => (
                            <PostCard key={post.id} post={post} locale={locale} />
                        ))}
                    </div>
                )}

                {lastPage > 1 && (
                    <nav className="mt-12 flex items-center justify-between border-t border-gray-100 pt-6" aria-label={t.pageOf(page, lastPage)}>
                        {page > 1 ? (
                            <Link
                                href={blogHref(
                                    page === 2 ? `/blog/category/${slug}` : `/blog/category/${slug}?page=${page - 1}`,
                                    locale,
                                )}
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
                                href={blogHref(`/blog/category/${slug}?page=${page + 1}`, locale)}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
                                {t.older}
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
