'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { NodeViewWrapper } from '@tiptap/react';
import { useI18n } from '@/lib/i18n';

/**
 * An image inside the editor: the picture, a spinner while its bytes are
 * still going up, and a handle to drag it to a width.
 *
 * The width is the point. A pasted screenshot arrives at whatever size the
 * display it was taken from happened to be, which is nearly always wider than
 * the column it lands in — so the first thing anyone wants to do with it is
 * make it smaller. `markdown-bridge` writes that width onto the URL, so it
 * survives a save and a reader sees the size the author chose.
 */

/** Small enough to be a thumbnail, large enough to still be an image. */
const MIN_WIDTH = 80;
/** One arrow key press. */
const STEP = 20;

type ImageAttrs = {
    src: string;
    alt: string | null;
    width: number | null;
    uploading: boolean;
};

/**
 * What this needs out of TipTap's `NodeViewProps`, which is three of its
 * fields — so a test can hand it a node and a spy rather than standing up a
 * whole editor to watch a drag.
 *
 * `attrs` is ProseMirror's open `Attrs` record, so the shape this file relies
 * on is asserted once, here, rather than at every read.
 */
type ResizableImageProps = {
    node: { attrs: Record<string, unknown> };
    updateAttributes: (attrs: Record<string, unknown>) => void;
    selected: boolean;
};

export function ResizableImage({ node, updateAttributes, selected }: ResizableImageProps) {
    const { t } = useI18n();
    const m = t.components.richText;
    const wrapper = useRef<HTMLSpanElement>(null);
    /*
     * The width while a drag is in flight, before it is written to the node.
     *
     * Not written on every pointermove: `updateAttributes` puts a transaction
     * through the editor, which re-renders this node view and drops the
     * selection — so the handle unmounts under the pointer and the drag dies
     * on its first millimetre. The picture follows the pointer from here, and
     * the node is told once, on release.
     */
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const { src, alt, uploading } = node.attrs as ImageAttrs;
    const width = dragWidth ?? (node.attrs as ImageAttrs).width;
    const dragging = dragWidth !== null;

    /**
     * The column the image sits in — it may not grow past it.
     *
     * Measured from the editor's own content box, not from the node's parent:
     * an inline node view is wrapped in a span that shrinks to fit the image,
     * so asking the parent gives back the image's current width and the
     * ceiling pins it where it already is. Nothing can ever grow.
     */
    const maxWidth = () =>
        wrapper.current?.closest('.ProseMirror')?.clientWidth ?? Number.MAX_SAFE_INTEGER;

    const clamp = (next: number) => Math.round(Math.min(Math.max(next, MIN_WIDTH), maxWidth()));

    /** The width to measure a drag from, when none has been chosen yet. */
    const currentWidth = () =>
        width ?? wrapper.current?.querySelector('img')?.offsetWidth ?? MIN_WIDTH;

    const startDrag = (event: PointerEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = currentWidth();

        // In Arabic and Urdu the inline end is on the left, so dragging left
        // is what grows the image. `clientX` is physical and knows nothing
        // about that (docs/rtl-guidelines.md).
        const rtl = document.documentElement.dir === 'rtl';

        // The last width the pointer asked for, so the release can commit it
        // without waiting for a state update it will not see.
        let latest = startWidth;

        const move = (e: globalThis.PointerEvent) => {
            const delta = (e.clientX - startX) * (rtl ? -1 : 1);
            latest = clamp(startWidth + delta);
            setDragWidth(latest);
        };
        const stop = () => {
            setDragWidth(null);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            // Once, at the end: this is the transaction that re-renders the
            // node view, so it must not happen while the pointer is down.
            if (latest !== startWidth) updateAttributes({ width: latest });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const towardsEnd = event.key === 'ArrowRight';
        updateAttributes({ width: clamp(currentWidth() + (towardsEnd ? STEP : -STEP)) });
    };

    return (
        <NodeViewWrapper
            as="span"
            ref={wrapper}
            className="relative my-2 inline-block max-w-full align-top"
            data-uploading={String(!!uploading)}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={alt ?? ''}
                loading="lazy"
                // The asset host has no business knowing which task page a
                // reader had open.
                referrerPolicy="no-referrer"
                draggable={false}
                style={width ? { width: `${width}px` } : undefined}
                className={`max-w-full rounded-md border border-gray-200 ${
                    uploading ? 'opacity-50' : ''
                } ${selected && !uploading ? 'ring-1 ring-blue-600' : ''}`}
            />

            {uploading && (
                <span
                    className="absolute inset-0 flex items-center justify-center"
                    aria-label={m.uploading}
                    role="status"
                >
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden />
                </span>
            )}

            {selected && !uploading && (
                <span
                    role="slider"
                    tabIndex={0}
                    aria-label={m.resizeImage}
                    aria-valuenow={width ?? 0}
                    aria-valuemin={MIN_WIDTH}
                    aria-orientation="horizontal"
                    onPointerDown={startDrag}
                    onKeyDown={onKeyDown}
                    className={`absolute inset-y-0 end-0 flex w-3 cursor-ew-resize items-center justify-center rounded-e-md ${
                        dragging ? 'bg-blue-600' : 'bg-blue-600/70'
                    }`}
                >
                    <span className="h-6 w-0.5 rounded bg-white" aria-hidden />
                </span>
            )}
        </NodeViewWrapper>
    );
}
