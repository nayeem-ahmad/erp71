import type { ElementType, JSX } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown for long-form articles — blog posts, on the marketing site and on a
 * shop's storefront.
 *
 * A sibling of `ui/Markdown.tsx` rather than a reuse of it. That one is sized
 * for the 380px AI chat panel: it renders every heading at one size, because a
 * hierarchy would not fit, and it blocks `img` outright, because its input is
 * partly tenant-controlled and an image would let that content make an outbound
 * request. Neither is right for an article, which needs a real h2/h3 structure
 * and inline images to be worth reading.
 *
 * What carries over unchanged is the safety posture: `skipHtml`, and no
 * `rehype-raw`. Raw HTML in a post body is never rendered — not because the
 * authors are untrusted, but because "trusted" is one compromised account away
 * from false, and the cost of the restriction is close to zero when the body is
 * markdown anyway.
 *
 * A server component: nothing here is interactive, so the whole article ships
 * as HTML with no client bundle. That is also what puts the prose in the
 * initial response for a crawler.
 */

function styled<T extends keyof JSX.IntrinsicElements>(tag: T, className: string) {
    function StyledTag({ node: _node, ...props }: JSX.IntrinsicElements[T] & ExtraProps) {
        const Tag = tag as ElementType;
        return <Tag className={className} {...props} />;
    }
    StyledTag.displayName = `ArticleMarkdown(${tag})`;
    return StyledTag;
}

/** Same-origin path check as the chat renderer: react-markdown has already
 * neutralised unsafe protocols, so a single leading "/" is enough — the "//"
 * guard rejects a protocol-relative "//host" that would leave the site. */
function isInternalPath(href: string | undefined): href is string {
    return !!href && href.startsWith('/') && !href.startsWith('//');
}

const components: Components = {
    // A real hierarchy, unlike the chat panel. h1 is the page title, rendered
    // by the page itself, so a body heading starts at h2.
    h1: styled('h2', 'mt-8 text-xl font-semibold text-gray-900 first:mt-0'),
    h2: styled('h2', 'mt-8 text-lg font-semibold text-gray-900 first:mt-0'),
    h3: styled('h3', 'mt-6 text-base font-semibold text-gray-900'),
    h4: styled('h4', 'mt-5 text-sm font-semibold text-gray-900'),
    h5: styled('h5', 'mt-4 text-sm font-semibold text-gray-700'),
    h6: styled('h6', 'mt-4 text-xs font-semibold uppercase text-gray-500'),

    p: styled('p', 'mt-4 text-sm leading-7 text-gray-700 first:mt-0'),
    strong: styled('strong', 'font-semibold text-gray-900'),
    em: styled('em', 'italic'),
    del: styled('del', 'text-gray-500 line-through'),
    hr: styled('hr', 'my-8 border-gray-200'),

    ul: styled('ul', 'mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-gray-700'),
    ol: styled('ol', 'mt-4 list-decimal space-y-2 pl-5 text-sm leading-7 text-gray-700'),
    li: styled('li', 'marker:text-gray-400'),

    blockquote: styled(
        'blockquote',
        'mt-6 border-l-2 border-blue-600 bg-blue-50/40 py-2 pl-4 text-sm italic leading-7 text-gray-700',
    ),

    // Wide tables scroll in their own container; the article body never
    // scrolls sideways, which is what would break the page at 360px.
    table: ({ node: _node, ...props }) => (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-xs" {...props} />
        </div>
    ),
    thead: styled('thead', 'bg-gray-50'),
    th: styled('th', 'whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700'),
    td: styled('td', 'border-b border-gray-100 px-3 py-2 align-top text-gray-700 last:border-b-0'),

    code: ({ node: _node, className, ...props }) => {
        const fenced = /language-/.test(className ?? '');
        return fenced ? (
            <code className="font-mono text-xs leading-relaxed" {...props} />
        ) : (
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800" {...props} />
        );
    },
    pre: styled('pre', 'mt-6 overflow-x-auto rounded-lg bg-gray-900 p-4 text-gray-100'),

    a: ({ node: _node, href, ...props }) =>
        isInternalPath(href) ? (
            <Link href={href} className="font-medium text-blue-600 hover:underline" {...props} />
        ) : (
            // External links in editorial content: new tab, no referrer, and
            // `nofollow` so a post cannot be used to pass ranking to a paid
            // placement without someone deciding to.
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-blue-600 hover:underline"
                {...props}
            />
        ),

    // Allowed here, unlike the chat panel. `alt` is preserved because a body
    // image without one is invisible to a screen reader and to a crawler.
    // eslint-disable-next-line @next/next/no-img-element
    img: ({ node: _node, src, alt, ...props }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={typeof src === 'string' ? src : undefined}
            alt={alt ?? ''}
            loading="lazy"
            className="mt-6 w-full rounded-lg border border-gray-200"
            {...props}
        />
    ),
};

export default function ArticleMarkdown({ content }: { content: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
            {content}
        </ReactMarkdown>
    );
}
