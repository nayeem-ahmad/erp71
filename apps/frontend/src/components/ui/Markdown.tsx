'use client';

import { useMemo, type ElementType, type JSX } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown for model-generated answers (the AI chat panel).
 *
 * Safety: raw HTML in the source is never rendered — react-markdown ignores it
 * unless rehype-raw is added, and `skipHtml` makes that explicit. `img` is
 * disallowed as well, because the content is built partly from tenant-controlled
 * strings and an image would let that content make an outbound request.
 *
 * Density: sized for the 380px chat panel, so headings are all one size and
 * tables scroll inside their own container rather than widening the bubble.
 */

/**
 * react-markdown hands every component the mdast `node`, which must not reach
 * the DOM as an attribute. This drops it and applies the class.
 */
function styled<T extends keyof JSX.IntrinsicElements>(tag: T, className: string) {
    function StyledTag({ node: _node, ...props }: JSX.IntrinsicElements[T] & ExtraProps) {
        const Tag = tag as ElementType;
        return <Tag className={className} {...props} />;
    }
    StyledTag.displayName = `Markdown(${tag})`;
    return StyledTag;
}

const HEADING = 'mt-3 text-sm font-semibold text-gray-900 first:mt-0';

/**
 * A same-origin app route the assistant asked to link to. react-markdown has
 * already stripped unsafe protocols by the time a component sees the href, so a
 * single leading "/" is enough to tell an in-app path from an external URL; the
 * "//" guard rejects a protocol-relative "//host" that would leave the app.
 */
function isInternalPath(href: string | undefined): href is string {
    return !!href && href.startsWith('/') && !href.startsWith('//');
}

const baseComponents: Components = {
    // One visual size for every level: the panel is too narrow for a hierarchy,
    // and the model's heading depth is not something to render faithfully.
    h1: styled('h3', HEADING),
    h2: styled('h3', HEADING),
    h3: styled('h4', HEADING),
    h4: styled('h4', HEADING),
    h5: styled('h5', HEADING),
    h6: styled('h6', HEADING),

    p: styled('p', 'mt-2 text-sm leading-relaxed first:mt-0'),
    strong: styled('strong', 'font-semibold text-gray-900'),
    em: styled('em', 'italic'),
    del: styled('del', 'text-gray-500 line-through'),
    hr: styled('hr', 'my-3 border-gray-200'),

    ul: styled('ul', 'mt-2 list-disc space-y-1 pl-4 text-sm first:mt-0'),
    ol: styled('ol', 'mt-2 list-decimal space-y-1 pl-4 text-sm first:mt-0'),
    li: styled('li', 'leading-relaxed marker:text-gray-400'),

    blockquote: styled('blockquote', 'mt-2 border-l-2 border-gray-300 pl-2 text-sm text-gray-600'),

    // Wide tables scroll inside the bubble; the panel itself never scrolls sideways.
    table: ({ node: _node, ...props }) => (
        <div className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-white first:mt-0">
            <table className="w-full border-collapse text-xs" {...props} />
        </div>
    ),
    thead: styled('thead', 'bg-gray-50'),
    th: styled(
        'th',
        'whitespace-nowrap border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700',
    ),
    td: styled('td', 'border-b border-gray-100 px-2 py-1.5 align-top text-gray-800 last:border-b-0'),

    code: ({ node: _node, className, ...props }) => {
        // react-markdown marks fenced blocks with a `language-*` class; anything
        // else is inline. Only the inline form gets a chip background.
        const fenced = /language-/.test(className ?? '');
        return fenced ? (
            <code className="font-mono text-[11px] leading-relaxed" {...props} />
        ) : (
            <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[11px] text-gray-800" {...props} />
        );
    },
    pre: styled('pre', 'mt-2 overflow-x-auto rounded-md bg-gray-900 p-2 text-gray-100 first:mt-0'),
};

/**
 * `onNavigate` fires when the user follows an in-app link — the caller closes the
 * chat panel so the page they navigated to is visible (on mobile the panel is a
 * full-screen sheet that would otherwise cover it).
 */
export default function Markdown({ content, onNavigate }: { content: string; onNavigate?: () => void }) {
    const components = useMemo<Components>(
        () => ({
            ...baseComponents,
            a: ({ node: _node, href, ...props }) =>
                isInternalPath(href) ? (
                    // In-app deep link the assistant produced: client-side navigation,
                    // same tab. Only paths on the backend's allow-list reach here as
                    // links, so this points at a real route, not an arbitrary one.
                    <Link href={href} onClick={onNavigate} className="font-medium text-blue-600 hover:underline" {...props} />
                ) : (
                    // External (web citation) or a protocol the renderer neutralised:
                    // open in a new tab and never send the referrer.
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 hover:underline" {...props} />
                ),
        }),
        [onNavigate],
    );

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={components}
            skipHtml
            disallowedElements={['img']}
            unwrapDisallowed
        >
            {content}
        </ReactMarkdown>
    );
}
