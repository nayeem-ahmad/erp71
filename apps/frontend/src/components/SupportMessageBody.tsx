'use client';

import { Suspense, lazy } from 'react';

/**
 * A support ticket message drawn as markdown. The composer stores markdown
 * (via `RichTextEditor`); this is the matching read surface for both the
 * shop inbox and the admin one.
 *
 * `onPrimary` flips the handful of colours that would otherwise stay dark on
 * a blue bubble — links, bold, inline code — without forking `Markdown` itself.
 */
const Markdown = lazy(() => import('@/components/ui/Markdown'));

export default function SupportMessageBody({
    body,
    onPrimary = false,
}: {
    body: string;
    onPrimary?: boolean;
}) {
    return (
        <div
            className={
                onPrimary
                    ? 'text-sm break-words [&_a]:text-blue-100 [&_a]:underline [&_strong]:font-semibold [&_strong]:text-white [&_em]:text-white [&_del]:text-blue-100 [&_code]:bg-blue-700/40 [&_code]:text-white [&_blockquote]:border-blue-200 [&_blockquote]:text-blue-50 [&_li]:marker:text-blue-200'
                    : 'text-sm break-words'
            }
        >
            <Suspense fallback={<p className="whitespace-pre-wrap break-words">{body}</p>}>
                <Markdown content={body} />
            </Suspense>
        </div>
    );
}
