'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Download,
    ExternalLink,
    File as FileIcon,
    Maximize,
    Minus,
    Plus,
    X,
} from 'lucide-react';
import ModalShell from '../ModalShell';
import { useI18n } from '@/lib/i18n';

/**
 * A file, full size, without leaving the page it was attached to.
 *
 * Opening an attachment used to mean a new browser tab: you lost the task,
 * came back by hitting Back, and a PDF took you somewhere else entirely.
 * Here the file opens over the task, pages to the next attachment, and
 * closes back onto what you were reading.
 *
 * Knows nothing about tasks — it takes a list and an index — so the
 * attachments grid and an image inside a rendered description can both use it.
 */

export type PreviewItem = {
    url: string;
    name: string;
    mimeType?: string | null;
};

/** How far one click of the zoom button, or one notch of the wheel, moves. */
const ZOOM_STEP = 0.25;
const MIN_SCALE = 1;
const MAX_SCALE = 5;

const isImage = (item: PreviewItem) => !!item.mimeType?.startsWith('image/');
const isPdf = (item: PreviewItem) => item.mimeType === 'application/pdf';

/** Fitted to the frame, which is where every item starts. */
const FITTED = { scale: 1, x: 0, y: 0 };

export function ImagePreviewModal({
    items,
    index,
    onIndexChange,
    onClose,
}: {
    items: PreviewItem[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const m = t.components.preview;

    const [view, setView] = useState(FITTED);
    /** Where a pan began, and what the offset was when it did. */
    const panFrom = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

    const item = items[index];
    const many = items.length > 1;

    const step = useCallback(
        (by: number) => {
            if (!many) return;
            // Wraps both ways: at the last attachment the next one is the
            // first, which is less surprising than a button that goes dead.
            onIndexChange((index + by + items.length) % items.length);
        },
        [index, items.length, many, onIndexChange],
    );

    /* A new file starts fitted. Carrying the previous one's zoom over would
       drop you into the middle of a picture you have not seen yet. */
    useEffect(() => {
        setView(FITTED);
    }, [index]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'ArrowRight') step(1);
            if (event.key === 'ArrowLeft') step(-1);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [step]);

    // Nothing to show: an empty list, or an index left pointing past the end
    // by a deletion.
    if (!item) return null;

    const zoomBy = (by: number) =>
        setView((current) => {
            const scale = Math.min(Math.max(current.scale + by, MIN_SCALE), MAX_SCALE);
            // Back to fit means back to the middle as well, or the picture
            // stays where a pan left it.
            return scale === MIN_SCALE ? FITTED : { ...current, scale };
        });

    const onWheel = (event: WheelEvent) => {
        if (!isImage(item)) return;
        zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };

    const startPan = (event: PointerEvent) => {
        // Fitted, there is nothing outside the frame to drag into view.
        if (view.scale === MIN_SCALE) return;
        panFrom.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    };

    const pan = (event: PointerEvent) => {
        const from = panFrom.current;
        if (!from) return;
        setView((current) => ({
            ...current,
            x: from.ox + (event.clientX - from.x),
            y: from.oy + (event.clientY - from.y),
        }));
    };

    const endPan = () => {
        panFrom.current = null;
    };

    const action =
        'flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40 max-md:min-h-touch max-md:min-w-touch';

    return (
        <ModalShell size="2xl" onBackdropClick={onClose} className="flex h-[90vh] flex-col">
            <header className="flex items-center gap-2 border-b border-gray-200 p-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</h2>

                {isImage(item) && (
                    <>
                        <button type="button" className={action} aria-label={m.zoomOut} onClick={() => zoomBy(-ZOOM_STEP)}>
                            <Minus className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" className={action} aria-label={m.zoomIn} onClick={() => zoomBy(ZOOM_STEP)}>
                            <Plus className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" className={action} aria-label={m.resetZoom} onClick={() => setView(FITTED)}>
                            <Maximize className="h-4 w-4" aria-hidden />
                        </button>
                    </>
                )}

                <a
                    href={item.url}
                    download={item.name}
                    className={action}
                    aria-label={m.download}
                >
                    <Download className="h-4 w-4" aria-hidden />
                </a>
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={action}
                    aria-label={m.openInNewTab}
                >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
                <button type="button" className={action} aria-label={m.closePreview} onClick={onClose}>
                    <X className="h-4 w-4" aria-hidden />
                </button>
            </header>

            <div
                data-testid="preview-stage"
                className="relative flex flex-1 items-center justify-center overflow-hidden bg-gray-900"
                onWheel={onWheel}
                onPointerDown={startPan}
                onPointerMove={pan}
                onPointerUp={endPan}
                onPointerLeave={endPan}
            >
                {isImage(item) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={item.url}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        draggable={false}
                        style={{
                            transform: `scale(${view.scale}) translate(${view.x}px, ${view.y}px)`,
                        }}
                        className={`max-h-full max-w-full object-contain ${
                            view.scale > MIN_SCALE ? 'cursor-grab' : ''
                        }`}
                    />
                )}

                {isPdf(item) && <iframe src={item.url} title={item.name} className="h-full w-full bg-white" />}

                {!isImage(item) && !isPdf(item) && (
                    <div className="flex flex-col items-center gap-2 text-gray-300">
                        <FileIcon className="h-10 w-10" aria-hidden />
                        <p className="text-sm">{m.noPreview}</p>
                    </div>
                )}

                {many && (
                    <>
                        <button
                            type="button"
                            aria-label={m.previous}
                            onClick={() => step(-1)}
                            className="absolute start-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-2 text-gray-700 hover:bg-white max-md:min-h-touch max-md:min-w-touch"
                        >
                            <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden />
                        </button>
                        <button
                            type="button"
                            aria-label={m.next}
                            onClick={() => step(1)}
                            className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-2 text-gray-700 hover:bg-white max-md:min-h-touch max-md:min-w-touch"
                        >
                            <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden />
                        </button>
                    </>
                )}
            </div>

            {many && (
                <footer className="border-t border-gray-200 p-2 text-center text-xs text-gray-500">
                    {index + 1} / {items.length}
                </footer>
            )}
        </ModalShell>
    );
}
