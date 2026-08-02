'use client';

import { useEffect, useRef, useState } from 'react';
import { DETECTION_EDGE_PX, detectCardQuad, quadCorners, type Quad } from '@/lib/card-dewarp';

/**
 * How often the feed is sampled. Detection is a Sobel pass plus a hull over a
 * 256px frame — cheap, but not free on the mid-range Androids this is aimed at,
 * and an outline that updates eight times a second already reads as live.
 */
const SAMPLE_INTERVAL_MS = 125;
/**
 * Frames a detection survives once the card is lost. Detection dips out for a
 * frame on a hand tremor or a passing shadow, and an outline that blinks off
 * and back looks broken; holding the last one bridges the gap.
 */
const HOLD_FRAMES = 3;
/** Weight given to each new detection. Low enough that the outline stops shimmering. */
const SMOOTHING = 0.35;

const OUTLINE = '#2563eb';

function blendQuad(previous: Quad | null, next: Quad, weight: number): Quad {
    if (!previous) return next;
    const mix = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: a.x + (b.x - a.x) * weight,
        y: a.y + (b.y - a.y) * weight,
    });
    return {
        topLeft: mix(previous.topLeft, next.topLeft),
        topRight: mix(previous.topRight, next.topRight),
        bottomRight: mix(previous.bottomRight, next.bottomRight),
        bottomLeft: mix(previous.bottomLeft, next.bottomLeft),
    };
}

/**
 * Where the video sits inside its element.
 *
 * The viewfinder is `object-contain`, so a 4:3 stream in a wider box is
 * letterboxed. Drawing against the element's own box would put the outline off
 * the picture by exactly the width of those bars.
 */
export function fittedContentRect(
    boxWidth: number,
    boxHeight: number,
    contentWidth: number,
    contentHeight: number,
): { x: number; y: number; width: number; height: number } {
    if (contentWidth <= 0 || contentHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
        return { x: 0, y: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) };
    }
    const scale = Math.min(boxWidth / contentWidth, boxHeight / contentHeight);
    const width = contentWidth * scale;
    const height = contentHeight * scale;
    return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/**
 * Draws the detected card outline over a live camera feed.
 *
 * Purely a framing aid: it tells the user the card is seen before they commit
 * to a photo, rather than letting them find out on the crop screen afterwards.
 * The capture itself is untouched — what gets scanned and stored is decided
 * after the shutter, where the corners are adjustable.
 */
export default function LiveCardOutline({
    video,
    active,
    onDetectionChange,
}: Readonly<{
    video: React.RefObject<HTMLVideoElement | null>;
    active: boolean;
    onDetectionChange?: (found: boolean) => void;
}>) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const held = useRef<Quad | null>(null);
    const misses = useRef(0);
    const [, force] = useState(0);

    useEffect(() => {
        if (!active) {
            held.current = null;
            misses.current = 0;
            return;
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        const work = document.createElement('canvas');
        const workCtx = work.getContext('2d', { willReadFrequently: true });

        const schedule = () => {
            if (!stopped) timer = setTimeout(tick, SAMPLE_INTERVAL_MS);
        };

        const tick = () => {
            if (stopped) return;
            const el = video.current;
            const overlay = canvas.current;
            if (!el?.videoWidth || !overlay || !workCtx) {
                schedule();
                return;
            }

            const scale = Math.min(1, DETECTION_EDGE_PX / Math.max(el.videoWidth, el.videoHeight));
            work.width = Math.max(1, Math.round(el.videoWidth * scale));
            work.height = Math.max(1, Math.round(el.videoHeight * scale));

            let found: Quad | null = null;
            try {
                workCtx.drawImage(el, 0, 0, work.width, work.height);
                found = detectCardQuad(workCtx.getImageData(0, 0, work.width, work.height));
            } catch {
                // A frame that cannot be read is not worth tearing the loop down
                // for — the next one usually can.
                found = null;
            }

            if (found) {
                misses.current = 0;
                held.current = blendQuad(held.current, found, SMOOTHING);
            } else if (held.current && misses.current < HOLD_FRAMES) {
                misses.current += 1;
            } else {
                held.current = null;
            }

            draw(overlay, el, held.current, work.width, work.height);
            onDetectionChange?.(!!held.current);
            schedule();
        };

        tick();
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
    }, [active, video, onDetectionChange]);

    // Nudges a repaint when the element resizes, so the outline keeps up with
    // an orientation change rather than sitting at the old scale until the next
    // detection happens to land.
    useEffect(() => {
        if (!active) return;
        const onResize = () => force((n) => n + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [active]);

    if (!active) return null;

    return (
        <canvas
            ref={canvas}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
        />
    );
}

function draw(
    overlay: HTMLCanvasElement,
    video: HTMLVideoElement,
    quad: Quad | null,
    detectWidth: number,
    detectHeight: number,
): void {
    const boxWidth = video.clientWidth;
    const boxHeight = video.clientHeight;
    if (!boxWidth || !boxHeight) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(boxWidth * dpr);
    const pixelHeight = Math.round(boxHeight * dpr);
    if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
        overlay.width = pixelWidth;
        overlay.height = pixelHeight;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxWidth, boxHeight);
    if (!quad) return;

    const rect = fittedContentRect(boxWidth, boxHeight, video.videoWidth, video.videoHeight);
    const points = quadCorners(quad).map((p) => ({
        x: rect.x + (p.x / detectWidth) * rect.width,
        y: rect.y + (p.y / detectHeight) * rect.height,
    }));

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();

    // Dim the surround so the card reads as the subject, not just an outlined
    // region of an otherwise equally bright frame.
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.rect(boxWidth, 0, -boxWidth, boxHeight);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = OUTLINE;
        ctx.fill();
    }
}
