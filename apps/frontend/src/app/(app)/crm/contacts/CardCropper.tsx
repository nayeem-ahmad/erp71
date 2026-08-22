'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
    DETECTION_EDGE_PX,
    detectCardQuad,
    outputSize,
    quadCorners,
    scaleQuad,
    warpQuadToRect,
    type Point,
    type Quad,
} from '@/lib/card-dewarp';

/** Matches the scanner's own cap, so a cropped card is never larger than an uncropped one. */
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;
const HANDLE_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
type HandleKey = (typeof HANDLE_KEYS)[number];

/** Quad covering the whole image, used when detection has no opinion. */
const fullFrame = (width: number, height: number): Quad => ({
    topLeft: { x: 0, y: 0 },
    topRight: { x: width, y: 0 },
    bottomRight: { x: width, y: height },
    bottomLeft: { x: 0, y: height },
});

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src;
    });
}

/**
 * Show the captured photo with four draggable corners and hand back a flattened
 * card.
 *
 * The corners are always adjustable, never merely a preview of what the detector
 * decided. Detection is a starting guess and it *will* sometimes lock onto a
 * table edge or a notebook underneath; a warp through a wrong quad smears the
 * card and reads worse than the original, so a human has to be able to fix it —
 * or bail out entirely with "use the full image".
 */
export default function CardCropper({
    dataUrl,
    onCropped,
    onSkip,
    busy,
}: Readonly<{
    dataUrl: string;
    onCropped: (croppedDataUrl: string) => void;
    onSkip: () => void;
    busy?: boolean;
}>) {
    const { t } = useI18n();
    const m = t.crm.contacts.scan;

    const wrap = useRef<HTMLDivElement>(null);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [quad, setQuad] = useState<Quad | null>(null);
    const [detected, setDetected] = useState<Quad | null>(null);
    const [dragging, setDragging] = useState<HandleKey | null>(null);
    const [working, setWorking] = useState(false);

    // Detect once per image, on a downscaled copy — full resolution buys nothing
    // for finding a border and costs a lot of time.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const img = await loadImage(dataUrl);
            if (cancelled) return;
            setImage(img);

            const scale = Math.min(1, DETECTION_EDGE_PX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                setQuad(fullFrame(img.width, img.height));
                return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            let found: Quad | null = null;
            try {
                const small = detectCardQuad(ctx.getImageData(0, 0, canvas.width, canvas.height));
                if (small) found = scaleQuad(small, 1 / scale);
            } catch {
                found = null;
            }
            if (cancelled) return;
            setDetected(found);
            setQuad(found ?? fullFrame(img.width, img.height));
        })().catch(() => {
            if (!cancelled) setQuad(null);
        });
        return () => { cancelled = true; };
    }, [dataUrl]);

    /** Pointer position in image pixels, clamped inside the photo. */
    const toImagePoint = useCallback(
        (clientX: number, clientY: number): Point | null => {
            const box = wrap.current?.getBoundingClientRect();
            if (!box || !image) return null;
            const x = ((clientX - box.left) / box.width) * image.width;
            const y = ((clientY - box.top) / box.height) * image.height;
            return {
                x: Math.min(image.width, Math.max(0, x)),
                y: Math.min(image.height, Math.max(0, y)),
            };
        },
        [image],
    );

    useEffect(() => {
        if (!dragging) return;
        const move = (e: PointerEvent) => {
            const p = toImagePoint(e.clientX, e.clientY);
            if (p) setQuad((q) => (q ? { ...q, [dragging]: p } : q));
        };
        const up = () => setDragging(null);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
    }, [dragging, toImagePoint]);

    const apply = async () => {
        if (!image || !quad) return;
        setWorking(true);
        try {
            const source = document.createElement('canvas');
            source.width = image.width;
            source.height = image.height;
            const sctx = source.getContext('2d', { willReadFrequently: true });
            if (!sctx) return onSkip();
            sctx.drawImage(image, 0, 0);

            const size = outputSize(quad, MAX_EDGE_PX);
            const out = document.createElement('canvas');
            out.width = size.width;
            out.height = size.height;
            const octx = out.getContext('2d');
            if (!octx) return onSkip();

            const warped = warpQuadToRect(
                sctx.getImageData(0, 0, image.width, image.height),
                quad,
                size,
                (w, h) => octx.createImageData(w, h),
            );
            // A degenerate quad — three corners dragged into a line — has no valid
            // transform. Fall through to the untouched photo rather than a smear.
            if (!warped) return onSkip();

            octx.putImageData(warped, 0, 0);
            onCropped(out.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch {
            onSkip();
        } finally {
            setWorking(false);
        }
    };

    const percent = (p: Point): { left: string; top: string } => ({
        left: `${image ? (p.x / image.width) * 100 : 0}%`,
        top: `${image ? (p.y / image.height) * 100 : 0}%`,
    });

    const polygon = quad
        ? quadCorners(quad)
              .map((p) => `${image ? (p.x / image.width) * 100 : 0}% ${image ? (p.y / image.height) * 100 : 0}%`)
              .join(', ')
        : '';

    return (
        <div className="space-y-3">
            <div
                ref={wrap}
                className="relative w-full select-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                style={{ touchAction: 'none' }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={dataUrl} alt={m.title} className="block w-full" draggable={false} />

                {quad && image && (
                    <>
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-blue-600/20"
                            style={{ clipPath: `polygon(${polygon})` }}
                        />
                        {HANDLE_KEYS.map((key) => (
                            <button
                                key={key}
                                type="button"
                                aria-label={m.corners[key]}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    setDragging(key);
                                }}
                                style={percent(quad[key])}
                                className="absolute -ms-3 -mt-3 h-6 w-6 rounded-full border-2 border-white bg-blue-600 shadow ring-1 ring-blue-700"
                            />
                        ))}
                    </>
                )}
            </div>

            <p className="text-xs text-gray-500">
                {detected ? m.cropDetected : m.cropManual}
            </p>

            <div className="flex flex-wrap gap-2">
                <Button
                    onClick={() => void apply()}
                    loading={working}
                    disabled={busy || !quad}
                    leftIcon={<Crop className="h-4 w-4" />}
                >
                    {m.useCrop}
                </Button>
                <Button variant="secondary" onClick={onSkip} disabled={busy || working}>
                    {m.useFullImage}
                </Button>
                {detected && (
                    <Button
                        variant="secondary"
                        onClick={() => setQuad(detected)}
                        disabled={busy || working}
                        leftIcon={<RotateCcw className="h-4 w-4" />}
                    >
                        {m.resetCrop}
                    </Button>
                )}
            </div>
        </div>
    );
}
