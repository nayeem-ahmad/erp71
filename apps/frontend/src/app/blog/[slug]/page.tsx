import type { Metadata } from 'next';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import BlogLanguageSwitch from '@/components/blog/BlogLanguageSwitch';
import { formatPostDate } from '@/components/blog/PostCard';
import { categoryName, fetchPost, siteOrigin } from '@/lib/blog/api';
import { blogHref, blogStrings, resolveBlogLocale, type BlogLocale } from '@/lib/blog/locale';

// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

/**
 * One article, server-rendered.
 *
 * Three things have to be in the initial HTML for this page to do its job: the
 * prose, a title/description a search result can show, and a canonical URL. A
 * client-rendered article has none of them at request time.
 */

type Params = { slug: string };
type Search = { lang?: string };

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
    const { post } = await fetchPost(slug, locale);

    if (!post) {
        // A missing post must not be indexable, and must not inherit the
        // layout's default title as if it were an article.
        return { title: 'Post not found — ERP71', robots: { index: false, follow: false } };
    }

    const base = `/blog/${post.slug}`;
    const url = `${siteOrigin()}${blogHref(base, locale)}`;
    const description = post.seo_description ?? post.excerpt ?? undefined;

    /**
     * Only the languages this post is actually written in are advertised. An
     * hreflang pointing at a `?lang=bn` URL that falls back to English is a
     * promise the page does not keep, and crawlers treat it as a duplicate.
     */
    const languages: Record<string, string> = { en: `${siteOrigin()}${base}` };
    if (post.available_locales?.includes('bn')) {
        languages.bn = `${siteOrigin()}${base}?lang=bn`;
    }

    return {
        title: `${post.seo_title ?? post.title} — ERP71`,
        description,
        alternates: { canonical: url, languages },
        authors: post.author_name ? [{ name: post.author_name }] : undefined,
        openGraph: {
            type: 'article',
            title: post.seo_title ?? post.title,
            description,
            url,
            publishedTime: post.published_at ?? undefined,
            modifiedTime: post.edited_at ?? undefined,
            locale: locale === 'bn' ? 'bn_BD' : 'en_US',
            images: post.cover_image_url ? [{ url: post.cover_image_url, alt: post.cover_alt ?? post.title }] : undefined,
        },
        twitter: {
            card: post.cover_image_url ? 'summary_large_image' : 'summary',
            title: post.seo_title ?? post.title,
            description,
            images: post.cover_image_url ? [post.cover_image_url] : undefined,
        },
    };
}

function NotAvailable({ locale }: { locale: BlogLocale }) {
    const t = blogStrings(locale);
    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />
            <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-16 pt-32 text-center">
                <h1 className="text-3xl font-black tracking-tight text-gray-900">{t.notAvailableTitle}</h1>
                <p className="mt-3 text-base text-gray-600">{t.notAvailableBody}</p>
                <Link
                    href={blogHref('/blog', locale)}
                    className="mt-6 text-sm font-semibold text-blue-600 hover:underline"
                >
                    {t.backToBlog}
                </Link>
            </main>
            <MarketingFooter />
        </div>
    );
}

export default async function BlogPostPage({
    params,
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<Search>;
}) {
    const { slug } = await params;
    const { lang } = await searchParams;
    const locale = resolveBlogLocale(lang);
    const t = blogStrings(locale);
    const { post, redirect_to: redirectTo } = await fetchPost(slug, locale);

    // A renamed post keeps its old URLs working with a real 301, so the links
    // and ranking it accumulated under the old slug follow it. The language
    // rides along, or the redirect would quietly drop the reader into English.
    if (!post && redirectTo) permanentRedirect(blogHref(`/blog/${redirectTo}`, locale));
    if (!post) return <NotAvailable locale={locale} />;

    // The language the reader is actually being served, which is English when
    // they asked for Bangla and the post has none. Everything that describes
    // the article — `lang`, the JSON-LD, the dates — follows this rather than
    // the request, so the markup never claims a translation that isn't there.
    const served: BlogLocale = locale === 'bn' && post.available_locales?.includes('bn') ? 'bn' : 'en';
    const url = `${siteOrigin()}${blogHref(`/blog/${post.slug}`, served)}`;

    /**
     * JSON-LD, rendered as a script tag rather than through a component so it
     * lands in the server HTML. `dangerouslySetInnerHTML` is unavoidable for
     * ld+json; the payload is JSON.stringify of our own object, and the `<`
     * escape stops a `</script>` inside a title from closing the tag early.
     */
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.title,
        inLanguage: served,
        description: post.seo_description ?? post.excerpt ?? undefined,
        image: post.cover_image_url ?? undefined,
        datePublished: post.published_at ?? undefined,
        dateModified: post.edited_at ?? post.published_at ?? undefined,
        author: post.author_name ? { '@type': 'Person', name: post.author_name } : undefined,
        publisher: { '@type': 'Organization', name: 'ERP71' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    };

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />

            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
            />

            {/* `lang` on the article rather than on <html>: the root layout is
                shared with every marketing page and cannot know about this one.
                Scoping it here is still enough for a screen reader to switch
                voice and for a translation tool to leave the page alone. */}
            <main className="mx-auto max-w-3xl px-6 pb-16 pt-28" lang={served}>
                <div className="flex items-center justify-between gap-4">
                    <Link
                        href={blogHref('/blog', locale)}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                        {t.backToBlog}
                    </Link>
                    <BlogLanguageSwitch
                        path={`/blog/${post.slug}`}
                        locale={served}
                        availableLocales={post.available_locales}
                    />
                </div>

                <header className="mt-6 border-b border-gray-100 pb-8">
                    {post.category && (
                        <span className="text-sm font-semibold text-blue-600">
                            {categoryName(post.category, served)}
                        </span>
                    )}
                    <h1 className="mt-2 text-4xl font-black leading-none tracking-tighter text-gray-900 md:text-5xl">
                        {post.title}
                    </h1>
                    {post.excerpt && <p className="mt-5 text-lg leading-relaxed text-gray-600">{post.excerpt}</p>}

                    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                        {post.author_name && (
                            <span>
                                {blogStrings(served).by}{' '}
                                <span className="font-medium text-gray-700">{post.author_name}</span>
                                {post.author_title ? `, ${post.author_title}` : ''}
                            </span>
                        )}
                        <time dateTime={post.published_at ?? undefined}>
                            {formatPostDate(post.published_at, served)}
                        </time>
                        {post.reading_minutes ? (
                            <span>{blogStrings(served).readingTime(post.reading_minutes)}</span>
                        ) : null}
                        {post.edited_at && (
                            <span>
                                {blogStrings(served).updated} {formatPostDate(post.edited_at, served)}
                            </span>
                        )}
                    </div>
                </header>

                {post.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={post.cover_image_url}
                        alt={post.cover_alt ?? ''}
                        className="mt-8 w-full rounded-lg border border-gray-200"
                    />
                )}

                <div className="mt-8">
                    <ArticleMarkdown content={post.body_md} variant="article" />
                </div>
            </main>

            <MarketingFooter />
        </div>
    );
}
