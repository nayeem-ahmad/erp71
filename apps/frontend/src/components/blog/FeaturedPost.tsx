import Link from 'next/link';
import type { BlogListPost } from '@/lib/blog/api';
import { postMeta } from './PostCard';

/**
 * Initials for the byline avatar.
 *
 * There is no author image on the post model, and inventing a stock silhouette
 * for every writer is worse than a monogram. Two initials at most — a longer
 * run of letters stops reading as a monogram.
 */
function initials(name: string): string {
    const letters = name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .filter(Boolean)
        .join('');
    return letters.toUpperCase();
}

/**
 * The lead story at the top of the blog index — image beside the headline
 * rather than above it, so one post carries the page.
 *
 * The backend already sorts `featured` posts ahead of the rest, so whatever
 * lands here is either an editor's pick or simply the newest post. Both are
 * reasonable things to lead with, which is why this takes a post rather than
 * looking one up.
 */
export default function FeaturedPost({
    post,
    basePath = '/blog',
}: {
    post: BlogListPost;
    basePath?: string;
}) {
    const href = `${basePath}/${post.slug}`;

    return (
        <article className="group grid items-center gap-6 md:grid-cols-5 md:gap-10">
            {/* The image repeats the headline's destination. Kept out of the tab
                order and off the accessibility tree so it isn't announced as a
                second, identical link. */}
            <Link href={href} tabIndex={-1} aria-hidden="true" className="md:col-span-3">
                {post.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={post.cover_image_url}
                        alt=""
                        className="aspect-[4/3] w-full rounded-lg bg-gray-50 object-cover"
                    />
                ) : (
                    <div className="aspect-[4/3] w-full rounded-lg bg-gray-50" />
                )}
            </Link>

            <div className="md:col-span-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {post.category && (
                        <Link
                            href={`${basePath}/category/${post.category.slug}`}
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-600 transition-colors hover:bg-blue-100"
                        >
                            {post.category.name_en}
                        </Link>
                    )}
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">{postMeta(post)}</span>
                </div>

                <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-gray-900 md:text-4xl">
                    <Link href={href} className="transition-colors hover:text-blue-600">
                        {post.title}
                    </Link>
                </h2>

                {post.excerpt && (
                    <p className="mt-4 text-base leading-relaxed text-gray-600">{post.excerpt}</p>
                )}

                {post.author_name && (
                    <div className="mt-6 flex items-center gap-3">
                        <span
                            aria-hidden="true"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500"
                        >
                            {initials(post.author_name)}
                        </span>
                        <span className="text-sm leading-tight">
                            <span className="block font-semibold text-gray-900">{post.author_name}</span>
                            {post.author_title && (
                                <span className="block text-xs text-gray-500">{post.author_title}</span>
                            )}
                        </span>
                    </div>
                )}
            </div>
        </article>
    );
}
