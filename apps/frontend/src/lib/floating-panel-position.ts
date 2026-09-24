/**
 * Where a floating panel sits, and how it is remembered.
 *
 * Kept apart from the component for the same reason the board's drag geometry
 * is: jsdom has no layout, so a component test cannot ask "is the panel still
 * on screen after the window shrank" — but these functions can be handed
 * rectangles directly and answer it exactly.
 *
 * Positions are viewport coordinates for a `position: fixed` element, so they
 * are `left`/`top` rather than logical `start`/`end`: a panel someone dragged
 * to a corner belongs at that corner, whichever way the document reads.
 */

export interface PanelPoint {
    x: number;
    y: number;
}

export interface PanelBox {
    width: number;
    height: number;
}

/** How close to the window edge a panel may come, dragged or restored. */
export const PANEL_EDGE_MARGIN = 8;

/** How far one arrow press moves a panel, for anyone not dragging with a pointer. */
export const PANEL_KEYBOARD_STEP = 16;

const STORAGE_PREFIX = 'floating-panel:';

/**
 * The nearest position to `point` that keeps the whole panel on screen.
 *
 * The two `Math.max` calls are what handle a panel taller or wider than the
 * window — a phone in landscape, or a browser window dragged small. The upper
 * bound would fall below the margin there, and clamping to it would push the
 * panel off the top; pinning to the margin instead keeps its header, which is
 * the part that moves it, reachable.
 */
export function clampPanelPosition(
    point: PanelPoint,
    panel: PanelBox,
    viewport: PanelBox,
    margin: number = PANEL_EDGE_MARGIN,
): PanelPoint {
    const maxX = Math.max(margin, viewport.width - panel.width - margin);
    const maxY = Math.max(margin, viewport.height - panel.height - margin);
    return {
        x: Math.min(Math.max(point.x, margin), maxX),
        y: Math.min(Math.max(point.y, margin), maxY),
    };
}

/**
 * Where a panel nobody has moved yet opens: the bottom corner the document
 * reads towards, so it sits out of the way of a page that reads from the
 * opposite edge.
 */
export function defaultPanelPosition(
    panel: PanelBox,
    viewport: PanelBox,
    options: { rtl?: boolean; margin?: number } = {},
): PanelPoint {
    const margin = options.margin ?? PANEL_EDGE_MARGIN;
    return clampPanelPosition(
        {
            x: options.rtl ? margin : viewport.width - panel.width - margin,
            y: viewport.height - panel.height - margin,
        },
        panel,
        viewport,
        margin,
    );
}

/** A stored position is JSON nobody validated on the way in. */
function isPoint(value: unknown): value is PanelPoint {
    const point = value as PanelPoint | null;
    return (
        typeof point?.x === 'number'
        && typeof point?.y === 'number'
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
    );
}

/**
 * The position this panel was last left in, or null when it has never been
 * moved — and also when the stored value is not a position, which is the same
 * situation as far as the panel is concerned.
 *
 * localStorage rather than sessionStorage on purpose: "remember where I put
 * it" means across browser restarts, not until this tab closes.
 */
export function readPanelPosition(key: string): PanelPoint | null {
    try {
        const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isPoint(parsed) ? { x: parsed.x, y: parsed.y } : null;
    } catch {
        // Storage blocked, or the value is not JSON. The default corner is fine.
        return null;
    }
}

export function writePanelPosition(key: string, point: PanelPoint): void {
    try {
        window.localStorage.setItem(
            `${STORAGE_PREFIX}${key}`,
            JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) }),
        );
    } catch {
        // Not remembering where it was put is better than failing to move it.
    }
}

/** The gap between a panel and the control it opened from. */
export const PANEL_ANCHOR_GAP = 4;

/**
 * Where a panel opened from a control sits: just below it, its end edge lined
 * up with the control's, so it reads as dropping out of the thing that was
 * pressed. Clamped like any other position, which is what flips the alignment
 * in practice for a control near the start edge — the panel slides back on
 * screen instead of hanging off it.
 */
export function anchoredPanelPosition(
    anchor: { left: number; right: number; bottom: number },
    panel: PanelBox,
    viewport: PanelBox,
    options: { rtl?: boolean; gap?: number; margin?: number } = {},
): PanelPoint {
    const gap = options.gap ?? PANEL_ANCHOR_GAP;
    return clampPanelPosition(
        {
            x: options.rtl ? anchor.left : anchor.right - panel.width,
            y: anchor.bottom + gap,
        },
        panel,
        viewport,
        options.margin,
    );
}
