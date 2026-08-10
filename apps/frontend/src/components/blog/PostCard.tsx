import Link from 'next/link';
import type { BlogListPost } from '@/lib/blog/api';

/** Date for a byline. Fixed to en-GB so server and client agree — a locale
 * inferred from the request would produce different HTML on rehydration. */
export function formatPostDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PostCard({ post, basePath = '/blog' }: { post: BlogListPost; basePath?: string }) {
    return (
        <article className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 transition-colors hover:border-blue-600">
            <Link href={`${basePath}/${post.slug}`} className="flex h-full flex-col">
                {post.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={post.cover_image_url}
                        alt={post.cover_alt ?? ''}
                        loading="lazy"
                        className="h-40 w-full object-cover"
                    />
                ) : (
                    <div className="h-40 w-full bg-gray-50" aria-hidden="true" />
                )}

                <div className="flex flex-1 flex-col p-4">
                    {post.category && (
                        <span className="text-xs font-semibold text-blue-600">{post.category.name_en}</span>
                    )}
                    <h2 className="mt-1 text-lg font-bold leading-snug text-gray-900 group-hover:text-blue-600">
                        {post.title}
                    </h2>
                    {post.excerpt && (
                        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-gray-500">{post.excerpt}</p>
                    )}
                    <p className="mt-auto pt-4 text-xs text-gray-500">
                        {formatPostDate(post.published_at)}
                        {post.reading_minutes ? ` · ${post.reading_minutes} min read` : ''}
                    </p>
                </div>
            </Link>
        </article>
    );
}
