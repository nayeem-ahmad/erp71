import type { Metadata } from 'next';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import { formatPostDate } from '@/components/blog/PostCard';
import { fetchPost, siteOrigin } from '@/lib/blog/api';

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

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const { post } = await fetchPost(slug);

    if (!post) {
        // A missing post must not be indexable, and must not inherit the
        // layout's default title as if it were an article.
        return { title: 'Post not found — ERP71', robots: { index: false, follow: false } };
    }

    const url = `${siteOrigin()}/blog/${post.slug}`;
    const description = post.seo_description ?? post.excerpt ?? undefined;

    return {
        title: `${post.seo_title ?? post.title} — ERP71`,
        description,
        alternates: { canonical: url },
        authors: post.author_name ? [{ name: post.author_name }] : undefined,
        openGraph: {
            type: 'article',
            title: post.seo_title ?? post.title,
            description,
            url,
            publishedTime: post.published_at ?? undefined,
            modifiedTime: post.edited_at ?? undefined,
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

function NotAvailable() {
    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="blog" />
            <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-16 pt-32 text-center">
                <h1 className="text-3xl font-black tracking-tight text-gray-900">This post isn&apos;t available</h1>
                <p className="mt-3 text-base text-gray-600">
                    It may have been removed or the link may be out of date.
                </p>
                <Link href="/blog" className="mt-6 text-sm font-semibold text-blue-600 hover:underline">
                    Back to the blog
                </Link>
            </main>
            <MarketingFooter />
        </div>
    );
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    const { post, redirect_to: redirectTo } = await fetchPost(slug);

    // A renamed post keeps its old URLs working with a real 301, so the links
    // and ranking it accumulated under the old slug follow it.
    if (!post && redirectTo) permanentRedirect(`/blog/${redirectTo}`);
    if (!post) return <NotAvailable />;

    const url = `${siteOrigin()}/blog/${post.slug}`;

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

            <main className="mx-auto max-w-3xl px-6 pb-16 pt-28">
                <Link href="/blog" className="text-sm font-semibold text-blue-600 hover:underline">
                    ← Back to the blog
                </Link>

                <header className="mt-6 border-b border-gray-100 pb-8">
                    {post.category && (
                        <span className="text-sm font-semibold text-blue-600">{post.category.name_en}</span>
                    )}
                    <h1 className="mt-2 text-4xl font-black leading-none tracking-tighter text-gray-900 md:text-5xl">
                        {post.title}
                    </h1>
                    {post.excerpt && <p className="mt-5 text-lg leading-relaxed text-gray-600">{post.excerpt}</p>}

                    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                        {post.author_name && (
                            <span>
                                By <span className="font-medium text-gray-700">{post.author_name}</span>
                                {post.author_title ? `, ${post.author_title}` : ''}
                            </span>
                        )}
                        <time dateTime={post.published_at ?? undefined}>{formatPostDate(post.published_at)}</time>
                        {post.reading_minutes ? <span>{post.reading_minutes} min read</span> : null}
                        {post.edited_at && <span>Updated {formatPostDate(post.edited_at)}</span>}
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
