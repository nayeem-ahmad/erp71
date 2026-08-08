import { BLOG_REVALIDATE_SECONDS, fetchPosts, siteOrigin } from '@/lib/blog/api';

/**
 * RSS for the blog.
 *
 * Feed readers are a small audience, but a feed is also how aggregators and
 * newsletter tools pick posts up without anyone building an integration, so it
 * costs one route and removes a whole category of "can you send us the posts"
 * requests.
 *
 * Every URL here is absolute: a feed is read far away from the site it came
 * from, and a relative link in an item resolves against the reader, not us.
 */
// Next.js parses this at build time and only accepts a literal, so the shared
// constant cannot be used here. 300 seconds — publishing revalidates on demand,
// so this is the ceiling on staleness, not the usual latency.
export const revalidate = 300;

const FEED_SIZE = 30;

/**
 * XML escaping for text nodes. Titles and excerpts are author-controlled, and
 * an unescaped `&` or `<` produces a feed no reader will parse — a stricter
 * failure than a malformed HTML page, since the whole document is rejected.
 */
function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export async function GET() {
    const origin = siteOrigin();
    const list = await fetchPosts({ limit: FEED_SIZE });

    const items = list.rows
        .map((post) => {
            const url = `${origin}/blog/${post.slug}`;
            const pubDate = post.published_at ? new Date(post.published_at).toUTCString() : '';
            return [
                '        <item>',
                `            <title>${escapeXml(post.title)}</title>`,
                `            <link>${escapeXml(url)}</link>`,
                `            <guid isPermaLink="true">${escapeXml(url)}</guid>`,
                pubDate ? `            <pubDate>${pubDate}</pubDate>` : '',
                post.excerpt ? `            <description>${escapeXml(post.excerpt)}</description>` : '',
                post.category ? `            <category>${escapeXml(post.category.name_en)}</category>` : '',
                '        </item>',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n');

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        '    <channel>',
        '        <title>The ERP71 blog</title>',
        `        <link>${origin}/blog</link>`,
        '        <description>Guides, product updates and notes on running a shop in Bangladesh.</description>',
        '        <language>en</language>',
        `        <atom:link href="${origin}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
        items,
        '    </channel>',
        '</rss>',
    ].join('\n');

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': `public, max-age=0, s-maxage=${BLOG_REVALIDATE_SECONDS}`,
        },
    });
}
