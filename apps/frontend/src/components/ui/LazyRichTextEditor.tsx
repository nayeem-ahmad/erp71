'use client';

import dynamic from 'next/dynamic';
import { createContext, useContext, useMemo } from 'react';
import type { RichTextEditorProps } from './RichTextEditor';
import { SkeletonBar } from './PageSkeleton';

/**
 * `RichTextEditor`, fetched when one is first drawn rather than with the page.
 *
 * The editor is TipTap over ProseMirror with markdown-it on either side —
 * the heaviest thing in `@/components/ui` — and it used to be re-exported from
 * the barrel. Webpack cannot drop a module whose top level runs code, and
 * `RichTextEditor.tsx` builds an extension at import time, so every page that
 * imported anything from the barrel shipped the editor: the app layout did,
 * through `SetPasswordGate` and `TimeTracker`, which made it part of every
 * screen in the app. Import this file wherever the editor is used, never
 * `./RichTextEditor` itself, or that page carries it again.
 *
 * `ssr: false` costs nothing: the editor already sets `immediatelyRender:
 * false`, so the server never drew its document anyway.
 */

type PlaceholderSize = {
    /** The editable area's `min-height`, as the editor sets it from `rows`. */
    minHeight: string;
    /** Whether the editor will draw its hint/counter/actions line under the box. */
    footer: boolean;
};

/*
 * `next/dynamic` hands its `loading` component nothing of the props, so the
 * placeholder would be one size for a two-line comment and a ten-line
 * description alike and the card would jump when the editor arrived. A
 * context carries the size down instead; it renders no element, so the
 * editor's place in its parent's layout is unchanged.
 */
const PlaceholderSizeContext = createContext<PlaceholderSize>({ minHeight: '9rem', footer: true });

/** The editor's footprint — toolbar, bordered box, footer line — until its chunk arrives. */
function EditorPlaceholder() {
    const { minHeight, footer } = useContext(PlaceholderSizeContext);
    return (
        <div aria-hidden className="space-y-1.5" data-rich-text-editor-placeholder="">
            <div className="flex flex-wrap items-center gap-0.5">
                {Array.from({ length: 7 }, (_, index) => (
                    <div key={index} className="flex h-7 w-7 items-center justify-center max-md:min-h-touch max-md:min-w-touch">
                        <SkeletonBar className="h-4 w-4" />
                    </div>
                ))}
            </div>
            <div className="rounded-md border border-gray-300 bg-white px-3 py-2">
                <div style={{ minHeight }} />
            </div>
            {footer ? <div className="h-4" /> : null}
        </div>
    );
}

const Editor = dynamic(() => import('./RichTextEditor').then((mod) => mod.RichTextEditor), {
    ssr: false,
    loading: () => <EditorPlaceholder />,
});

export function RichTextEditor(props: RichTextEditorProps) {
    const { rows = 6, hideHint, uploadImage, maxLength, showActions } = props;
    const size = useMemo<PlaceholderSize>(
        () => ({
            // Same arithmetic as the editor's own `min-height`.
            minHeight: `${Math.max(rows, 2) * 1.5}rem`,
            footer: !hideHint || Boolean(uploadImage) || maxLength !== undefined || Boolean(showActions),
        }),
        [rows, hideHint, uploadImage, maxLength, showActions],
    );

    return (
        <PlaceholderSizeContext.Provider value={size}>
            <Editor {...props} />
        </PlaceholderSizeContext.Provider>
    );
}

export type { RichTextEditorProps, PastedImage } from './RichTextEditor';
