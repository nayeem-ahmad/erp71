import type { Metadata } from 'next';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import { fetchStorefrontPost } from '@/lib/blog/storefront-api';

// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

type Params = { slug: string; postSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug, postSlug } = await params;
    const { post, blog } = await fetchStorefrontPost(slug, postSlug);

    if (!post) {
        return { title: 'Post not available', robots: { index: false, follow: false } };
    }

    const description = post.seo_description ?? post.excerpt ?? undefined;

    return {
        title: `${post.seo_title ?? post.title}${blog ? ` — ${blog.shop_name}` : ''}`,
        description,
        openGraph: {
            type: 'article',
            title: post.seo_title ?? post.title,
            description,
            publishedTime: post.published_at ?? undefined,
            modifiedTime: post.edited_at ?? undefined,
            images: post.cover_image_url ? [{ url: post.cover_image_url, alt: post.cover_alt ?? post.title }] : undefined,
        },
    };
}

function formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Unavailable({ shopSlug }: { shopSlug: string }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This post isn&apos;t available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    It may have been removed or the link may be out of date.
                </p>
                <Link href={`/store/${shopSlug}/blog`} className="mt-4 inline-block text-xs font-medium text-blue-600 hover:underline">
                    Back to the blog
                </Link>
            </div>
        </main>
    );
}

export default async function StorefrontBlogPostPage({ params }: { params: Promise<Params> }) {
    const { slug, postSlug } = await params;
    const { post, blog, redirect_to: redirectTo } = await fetchStorefrontPost(slug, postSlug);

    // A rename keeps the old URL alive with a real 301, scoped to this shop —
    // slug history is per tenant, so a redirect can never cross into another
    // shop's article.
    if (!post && redirectTo) permanentRedirect(`/store/${slug}/blog/${redirectTo}`);
    if (!post) return <Unavailable shopSlug={slug} />;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.title,
        description: post.seo_description ?? post.excerpt ?? undefined,
        image: post.cover_image_url ?? undefined,
        datePublished: post.published_at ?? undefined,
        dateModified: post.edited_at ?? post.published_at ?? undefined,
        author: post.author_name ? { '@type': 'Person', name: post.author_name } : undefined,
        publisher: blog ? { '@type': 'Organization', name: blog.shop_name } : undefined,
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
            />

            <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
                <Link href={`/store/${slug}/blog`} className="text-xs font-medium text-blue-600 hover:underline">
                    ← {blog?.title ?? 'Back to the blog'}
                </Link>

                <article className="mt-4 rounded-lg border border-gray-200 bg-white p-4 md:p-6">
                    {post.category && <span className="text-xs font-medium text-blue-600">{post.category.name}</span>}
                    <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-gray-900">{post.title}</h1>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        {post.author_name && <span>By {post.author_name}</span>}
                        <time dateTime={post.published_at ?? undefined}>{formatDate(post.published_at)}</time>
                        {post.reading_minutes ? <span>{post.reading_minutes} min read</span> : null}
                    </div>

                    {post.cover_image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={post.cover_image_url}
                            alt={post.cover_alt ?? ''}
                            className="mt-6 w-full rounded-lg border border-gray-200"
                        />
                    )}

                    <div className="mt-6">
                        <ArticleMarkdown content={post.body_md ?? ''} />
                    </div>
                </article>
            </main>
        </div>
    );
}
