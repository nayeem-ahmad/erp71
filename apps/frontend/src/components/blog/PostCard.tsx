import Link from 'next/link';
import { categoryName, type BlogListPost } from '@/lib/blog/api';
import { blogHref, blogStrings, DEFAULT_BLOG_LOCALE, type BlogLocale } from '@/lib/blog/locale';
import { formatDate } from '@/lib/format';

/** Date for a byline. The locale is passed in rather than resolved ambiently so
 * server and client agree — one inferred from the request would produce
 * different HTML on rehydration. */
export function formatPostDate(value: string | null, locale: BlogLocale = DEFAULT_BLOG_LOCALE): string {
    if (!value) return '';
    return formatDate(value, locale);
}

/** The `date · N min read` line, shared by the cards and the lead story so the
 * index never shows two spellings of the same fact. */
export function postMeta(post: BlogListPost, locale: BlogLocale = DEFAULT_BLOG_LOCALE): string {
    return [
        formatPostDate(post.published_at, locale),
        post.reading_minutes ? blogStrings(locale).readingTime(post.reading_minutes) : '',
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * One post in the index grid.
 *
 * Deliberately not a bordered box: the cover image is the card edge, and the
 * text below it sits on the page. A row of outlined rectangles competes with
 * the images for attention, which is the opposite of what an index is for.
 */
export default function PostCard({
    post,
    basePath = '/blog',
    locale = DEFAULT_BLOG_LOCALE,
}: {
    post: BlogListPost;
    basePath?: string;
    locale?: BlogLocale;
}) {
    return (
        <article className="group flex flex-col">
            <Link href={blogHref(`${basePath}/${post.slug}`, locale)} className="flex h-full flex-col">
                {post.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={post.cover_image_url}
                        alt={post.cover_alt ?? ''}
                        loading="lazy"
                        className="aspect-[16/10] w-full rounded-lg bg-gray-50 object-cover"
                    />
                ) : (
                    <div className="aspect-[16/10] w-full rounded-lg bg-gray-50" aria-hidden="true" />
                )}

                <div className="flex flex-1 flex-col pt-3">
                    {post.category && (
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                            {categoryName(post.category, locale)}
                        </span>
                    )}
                    <h2 className="mt-1.5 text-base font-bold leading-snug text-gray-900 transition-colors group-hover:text-blue-600">
                        {post.title}
                    </h2>
                    {post.excerpt && (
                        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-gray-500">{post.excerpt}</p>
                    )}
                    <p className="mt-auto pt-3 text-xs text-gray-400">{postMeta(post, locale)}</p>
                </div>
            </Link>
        </article>
    );
}
