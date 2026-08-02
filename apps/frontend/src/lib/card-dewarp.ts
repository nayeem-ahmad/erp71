/**
 * Find a business card in a photo and flatten it to a square-on rectangle.
 *
 * Why hand-rolled rather than OpenCV.js: this is one screen, and OpenCV.js is
 * ~8 MB of WASM. The repo already took the same decision for the burndown chart
 * (no chart library, hand-rolled SVG). Everything here is plain arithmetic over
 * ImageData, so it is testable without a browser.
 *
 * What this actually buys, in order of value:
 *  1. Cropping. A card on a desk is maybe a third of the frame, so cropping
 *     spends the whole downscale budget on the card and roughly triples the
 *     pixels on its smallest line of text.
 *  2. A clean stored image. The card is kept so the AI's extraction can be
 *     checked against it, and a square-on card is far easier to check.
 *  3. Deskew for the extraction itself — real but the smallest of the three,
 *     because a vision model reads a tilted card perfectly well.
 *
 * Detection is deliberately conservative: `detectCardQuad` returns null rather
 * than a guess whenever the evidence is weak, and the caller then sends the
 * frame exactly as it does today. A confidently wrong warp smears the card into
 * a parallelogram and extracts *worse* than the raw photo, so "no opinion" has
 * to be a first-class answer.
 */

export interface Point {
    x: number;
    y: number;
}

/** Always in this order, clockwise from the top-left of the card as photographed. */
export interface Quad {
    topLeft: Point;
    topRight: Point;
    bottomRight: Point;
    bottomLeft: Point;
}

/** Longest edge used for detection. Card borders survive this; noise does not. */
const DETECT_EDGE_PX = 256;
/** Bins used to threshold the gradient field. 256 is ample for an 8-bit source. */
const EDGE_HISTOGRAM_BINS = 256;
/**
 * How much stronger the gradient along the quad's own edges must be than the
 * frame average. This is what separates a card from noise: a real border is a
 * bright line in the gradient field, whereas uniform noise makes every possible
 * quad look equally well supported.
 */
const MIN_EDGE_SUPPORT = 1.8;
/** Below this share of the frame it is a speck, above it is the frame border itself. */
const MIN_AREA_RATIO = 0.15;
const MAX_AREA_RATIO = 0.98;
/** How much of the hull the quad must explain before we believe it is a quad. */
const MIN_QUAD_FILL = 0.72;
/** Corner angles outside this are slivers, not cards. */
const MIN_CORNER_DEG = 45;
const MAX_CORNER_DEG = 135;

export const quadCorners = (quad: Quad): Point[] => [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
];

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Shoelace. Sign is dropped — callers only ever want the magnitude. */
export function polygonArea(points: Point[]): number {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

/**
 * Put four unordered points into `Quad` order.
 *
 * Uses the sum/difference trick: on a roughly upright card the top-left has the
 * smallest x+y and the top-right the largest x−y. It is chosen over sorting by
 * angle because it stays correct when the quad is a thin trapezoid, which a
 * card photographed at a steep angle is.
 */
export function orderCorners(points: Point[]): Quad {
    if (points.length !== 4) throw new Error('a quad needs exactly four points');
    const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
    const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));

    const topLeft = bySum[0];
    const bottomRight = bySum[3];
    // The remaining two are whichever of the diff extremes are not already used.
    const rest = points.filter((p) => p !== topLeft && p !== bottomRight);
    const topRight = rest.reduce((best, p) => (p.x - p.y > best.x - best.y ? p : best), rest[0]);
    const bottomLeft = rest.find((p) => p !== topRight) ?? byDiff[0];

    return { topLeft, topRight, bottomRight, bottomLeft };
}

/** Andrew's monotone chain. Returns the hull counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
    if (points.length < 3) return [...points];
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Point, a: Point, b: Point) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const half = (src: Point[]): Point[] => {
        const out: Point[] = [];
        for (const p of src) {
            while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
                out.pop();
            }
            out.push(p);
        }
        out.pop();
        return out;
    };

    return [...half(sorted), ...half([...sorted].reverse())];
}

/** Keep the `limit` hull vertices whose removal would cost the most area. */
function simplifyHull(hull: Point[], limit: number): Point[] {
    let current = [...hull];
    while (current.length > limit) {
        let worstIndex = 0;
        let worstCost = Infinity;
        for (let i = 0; i < current.length; i += 1) {
            const prev = current[(i - 1 + current.length) % current.length];
            const next = current[(i + 1) % current.length];
            const cost = polygonArea([prev, current[i], next]);
            if (cost < worstCost) {
                worstCost = cost;
                worstIndex = i;
            }
        }
        current = current.filter((_, i) => i !== worstIndex);
    }
    return current;
}

/** The four hull vertices enclosing the most area. */
function largestQuad(hull: Point[]): Point[] | null {
    if (hull.length < 4) return null;
    const pts = simplifyHull(hull, 24);
    let best: Point[] | null = null;
    let bestArea = 0;
    for (let a = 0; a < pts.length - 3; a += 1) {
        for (let b = a + 1; b < pts.length - 2; b += 1) {
            for (let c = b + 1; c < pts.length - 1; c += 1) {
                for (let d = c + 1; d < pts.length; d += 1) {
                    const area = polygonArea([pts[a], pts[b], pts[c], pts[d]]);
                    if (area > bestArea) {
                        bestArea = area;
                        best = [pts[a], pts[b], pts[c], pts[d]];
                    }
                }
            }
        }
    }
    return best;
}

function cornerAnglesOk(quad: Quad): boolean {
    const pts = quadCorners(quad);
    for (let i = 0; i < 4; i += 1) {
        const prev = pts[(i + 3) % 4];
        const here = pts[i];
        const next = pts[(i + 1) % 4];
        const v1 = { x: prev.x - here.x, y: prev.y - here.y };
        const v2 = { x: next.x - here.x, y: next.y - here.y };
        const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
        if (mag === 0) return false;
        const deg = (Math.acos(Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / mag))) * 180) / Math.PI;
        if (deg < MIN_CORNER_DEG || deg > MAX_CORNER_DEG) return false;
    }
    return true;
}

export interface GradientField {
    mag: Float32Array;
    width: number;
    height: number;
    mean: number;
    max: number;
}

/**
 * Greyscale, blurred hard enough that only large-scale structure survives.
 *
 * This is where the card's border is separated from everything else competing
 * with it, and it is a question of *scale* rather than strength. A border is a
 * step between two surfaces: blurring spreads that step over more pixels but
 * the total change across it is untouched, so it still reads as a strong
 * gradient. Printing is thin strokes and desk texture is a fine repeating
 * pattern; both are narrower than the blur, so each gets averaged against its
 * own surroundings and flattens out.
 *
 * The 3×3 box this replaces was too narrow to tell them apart, which left the
 * threshold trying to separate populations that overlapped — and no threshold
 * could, because a printed card, a grainy desk and a grainy desk holding a
 * printed card each want the cut in a different place.
 */
const BLUR_RADIUS = 2;
const BLUR_PASSES = 2;

function toBlurredGray(data: ImageData): { gray: Float32Array; width: number; height: number } {
    const { width, height } = data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
        const o = i * 4;
        gray[i] = 0.299 * data.data[o] + 0.587 * data.data[o + 1] + 0.114 * data.data[o + 2];
    }

    // Separable, and repeated: box blurs stack into a close-enough Gaussian,
    // which falls off smoothly instead of ringing on hard edges the way a
    // single wide box does.
    const scratch = new Float32Array(width * height);
    for (let pass = 0; pass < BLUR_PASSES; pass += 1) {
        blurAxis(gray, scratch, width, height, BLUR_RADIUS, true);
        blurAxis(scratch, gray, width, height, BLUR_RADIUS, false);
    }

    return { gray, width, height };
}

/** One box-blur pass along a single axis, clamping at the borders. */
function blurAxis(
    src: Float32Array,
    dst: Float32Array,
    width: number,
    height: number,
    radius: number,
    horizontal: boolean,
): void {
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;

    for (let o = 0; o < outer; o += 1) {
        for (let i = 0; i < inner; i += 1) {
            let sum = 0;
            let n = 0;
            for (let k = -radius; k <= radius; k += 1) {
                const j = i + k;
                if (j < 0 || j >= inner) continue;
                sum += src[horizontal ? o * width + j : j * width + o];
                n += 1;
            }
            dst[horizontal ? o * width + i : i * width + o] = sum / n;
        }
    }
}

/** Sobel magnitude for the whole frame, kept so it can be reused for scoring. */
export function gradientField(data: ImageData): GradientField {
    const { gray, width, height } = toBlurredGray(data);
    const mag = new Float32Array(width * height);
    let sum = 0;
    let max = 0;

    for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
            const at = (dx: number, dy: number) => gray[(y + dy) * width + (x + dx)];
            const gx =
                -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
            const gy =
                -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
            const m = Math.hypot(gx, gy);
            mag[y * width + x] = m;
            sum += m;
            if (m > max) max = m;
        }
    }

    const interior = Math.max(1, (width - 2) * (height - 2));
    return { mag, width, height, mean: sum / interior, max };
}

/** Mean gradient sampled along the quad's four sides, relative to the frame mean. */
export function edgeSupport(quad: Quad, field: GradientField): number {
    if (field.mean <= 0) return 0;
    const pts = quadCorners(quad);
    const SAMPLES = 64;
    let sum = 0;
    let n = 0;

    for (let i = 0; i < 4; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        for (let s = 0; s <= SAMPLES; s += 1) {
            const t = s / SAMPLES;
            const x = Math.round(a.x + (b.x - a.x) * t);
            const y = Math.round(a.y + (b.y - a.y) * t);
            if (x < 0 || y < 0 || x >= field.width || y >= field.height) continue;
            sum += field.mag[y * field.width + x];
            n += 1;
        }
    }
    return n === 0 ? 0 : sum / n / field.mean;
}

/** The points in the strongest `EDGE_KEEP_RATIO`, floored at `EDGE_MIN_RELATIVE`. */
export function strongEdgePoints(data: ImageData): Point[] {
    return edgePointsFrom(gradientField(data));
}

/**
 * The outermost strong edge on each scanline, scanned from all four directions.
 *
 * Returning *every* strong pixel does not work, because gradient magnitude
 * alone cannot tell a card's border from the card's own printing — black text
 * on a white card is routinely a stronger edge than that card against a desk.
 * Feeding both to the hull makes the result a race between how much text a card
 * carries and how textured the desk is, and no single cutoff wins both: loose
 * enough to keep the border on a text-heavy card is loose enough for wood grain
 * to swallow the frame, and tight enough to reject grain drops the border in
 * favour of the text block.
 *
 * Printing is always *inside* the border, so it is never the first strong edge
 * a scanline meets from outside. Taking only the extremes removes it as a
 * category rather than by threshold, which leaves the cutoff with the one job
 * it can actually do: keeping faint background texture out.
 */
/**
 * Otsu's threshold over the gradient field: the split that best separates
 * "edge" from "not edge" for this frame.
 *
 * Every fixed rule tried here failed on some ordinary photo, because a frame
 * holds up to three populations — flat surface, desk texture, and the sharp
 * stuff (the card's border and its printing) — and where the useful cut lies
 * depends on which are present. A percentile of the population follows whatever
 * covers the most area, so texture sets the bar. A fraction of the strongest
 * edge follows the printing, so a heavily printed card raises the bar above its
 * own border and the card disappears. Between a wood desk (needing a bar above
 * 0.40 of the strongest) and that same desk with a printed card (needing below
 * 0.55), the workable band was too narrow to hold.
 *
 * Otsu picks the cut by maximising between-class variance, so it lands in
 * whichever gap the frame actually has instead of one assumed in advance, and
 * it takes no tuning constant to do it. It only works because the blur has
 * already removed the populations it could not have separated — on an
 * unblurred frame the biggest split is flat-surface against desk texture,
 * which puts the cut below the texture and hands the hull back to the desk.
 */
function otsuThreshold(mag: Float32Array, width: number, height: number, max: number): number {
    if (max <= 0) return 0;

    const bins = EDGE_HISTOGRAM_BINS;
    const scale = (bins - 1) / max;
    const histogram = new Uint32Array(bins);
    for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
            histogram[Math.round(mag[y * width + x] * scale)] += 1;
        }
    }

    return otsuBin(histogram, 0) / scale;
}

/** The bin maximising between-class variance, considering only bins >= `from`. */
function otsuBin(histogram: Uint32Array, from: number): number {
    let total = 0;
    let sumAll = 0;
    for (let b = from; b < histogram.length; b += 1) {
        total += histogram[b];
        sumAll += b * histogram[b];
    }
    if (total === 0) return from;

    let weightBelow = 0;
    let sumBelow = 0;
    let bestVariance = -1;
    let bestBin = from;

    for (let b = from; b < histogram.length; b += 1) {
        weightBelow += histogram[b];
        if (weightBelow === 0) continue;
        const weightAbove = total - weightBelow;
        if (weightAbove === 0) break;

        sumBelow += b * histogram[b];
        const meanBelow = sumBelow / weightBelow;
        const meanAbove = (sumAll - sumBelow) / weightAbove;
        const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
        if (variance > bestVariance) {
            bestVariance = variance;
            bestBin = b;
        }
    }

    return bestBin;
}

function edgePointsFrom(field: GradientField): Point[] {
    const { mag, width, height, max } = field;
    if (max <= 0) return [];

    const cutoff = otsuThreshold(mag, width, height, max);
    if (cutoff <= 0) return [];

    const points: Point[] = [];
    for (let y = 1; y < height - 1; y += 1) {
        let first = -1;
        let last = -1;
        for (let x = 1; x < width - 1; x += 1) {
            if (mag[y * width + x] >= cutoff) {
                if (first < 0) first = x;
                last = x;
            }
        }
        if (first >= 0) {
            points.push({ x: first, y });
            if (last !== first) points.push({ x: last, y });
        }
    }
    for (let x = 1; x < width - 1; x += 1) {
        let first = -1;
        let last = -1;
        for (let y = 1; y < height - 1; y += 1) {
            if (mag[y * width + x] >= cutoff) {
                if (first < 0) first = y;
                last = y;
            }
        }
        if (first >= 0) {
            points.push({ x, y: first });
            if (last !== first) points.push({ x, y: last });
        }
    }
    return points;
}

/**
 * Best guess at the card's outline, in the coordinate space of `data`.
 * Returns null when the evidence does not support a confident answer.
 */
export function detectCardQuad(data: ImageData): Quad | null {
    const field = gradientField(data);
    const edges = edgePointsFrom(field);
    if (edges.length < 8) return null;

    const hull = convexHull(edges);
    const quadPoints = largestQuad(hull);
    if (!quadPoints) return null;

    const quad = orderCorners(quadPoints);
    const area = polygonArea(quadCorners(quad));
    const frame = data.width * data.height;
    const ratio = area / frame;

    if (ratio < MIN_AREA_RATIO || ratio > MAX_AREA_RATIO) return null;
    if (area / Math.max(polygonArea(hull), 1) < MIN_QUAD_FILL) return null;
    if (!cornerAnglesOk(quad)) return null;
    // Last and strictest: the outline has to sit on real gradient. Uniform noise
    // clears every check above, because any quad through it looks as good as any
    // other — only this one notices there is no border there.
    if (edgeSupport(quad, field) < MIN_EDGE_SUPPORT) return null;

    return quad;
}

/**
 * Homography mapping `from` onto `to`, as a row-major 3×3 with h8 pinned to 1.
 *
 * Solved by plain Gaussian elimination on the 8×8 DLT system. Callers wanting to
 * *sample* a warp should pass destination→source, so each output pixel maps
 * straight back into the photo and no matrix inversion is needed.
 */
export function solveHomography(from: Quad, to: Quad): number[] | null {
    const src = quadCorners(from);
    const dst = quadCorners(to);
    const a: number[][] = [];
    const b: number[] = [];

    for (let i = 0; i < 4; i += 1) {
        const { x, y } = src[i];
        const { x: u, y: v } = dst[i];
        a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        b.push(u);
        a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(v);
    }

    for (let col = 0; col < 8; col += 1) {
        let pivot = col;
        for (let row = col + 1; row < 8; row += 1) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        }
        if (Math.abs(a[pivot][col]) < 1e-10) return null; // degenerate quad
        [a[col], a[pivot]] = [a[pivot], a[col]];
        [b[col], b[pivot]] = [b[pivot], b[col]];

        for (let row = 0; row < 8; row += 1) {
            if (row === col) continue;
            const factor = a[row][col] / a[col][col];
            if (factor === 0) continue;
            for (let k = col; k < 8; k += 1) a[row][k] -= factor * a[col][k];
            b[row] -= factor * b[col];
        }
    }

    const h = b.map((value, i) => value / a[i][i]);
    return [...h, 1];
}

export function applyHomography(h: number[], x: number, y: number): Point {
    const w = h[6] * x + h[7] * y + h[8];
    return {
        x: (h[0] * x + h[1] * y + h[2]) / w,
        y: (h[3] * x + h[4] * y + h[5]) / w,
    };
}

/**
 * Pixel size for the flattened card: the longer of each opposing pair, so no
 * edge is squeezed, then scaled to fit `maxEdge`.
 */
export function outputSize(quad: Quad, maxEdge: number): { width: number; height: number } {
    const width = Math.max(
        dist(quad.topLeft, quad.topRight),
        dist(quad.bottomLeft, quad.bottomRight),
    );
    const height = Math.max(
        dist(quad.topLeft, quad.bottomLeft),
        dist(quad.topRight, quad.bottomRight),
    );
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** Bilinear sample, clamped at the edges so the border never reads as black. */
function sample(src: ImageData, x: number, y: number, out: Uint8ClampedArray, at: number): void {
    const cx = Math.min(src.width - 1, Math.max(0, x));
    const cy = Math.min(src.height - 1, Math.max(0, y));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(src.width - 1, x0 + 1);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;

    for (let c = 0; c < 4; c += 1) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c];
        const p10 = src.data[(y0 * src.width + x1) * 4 + c];
        const p01 = src.data[(y1 * src.width + x0) * 4 + c];
        const p11 = src.data[(y1 * src.width + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[at + c] = top + (bottom - top) * fy;
    }
}

/**
 * Flatten the region under `quad` into an upright rectangle.
 *
 * Iterates destination pixels and maps each *back* into the source, which is
 * what keeps the output free of the holes a forward mapping leaves.
 */
export function warpQuadToRect(
    source: ImageData,
    quad: Quad,
    size: { width: number; height: number },
    createImageData: (w: number, h: number) => ImageData,
): ImageData | null {
    const target: Quad = {
        topLeft: { x: 0, y: 0 },
        topRight: { x: size.width, y: 0 },
        bottomRight: { x: size.width, y: size.height },
        bottomLeft: { x: 0, y: size.height },
    };
    // Destination → source, so every output pixel has somewhere to read from.
    const h = solveHomography(target, quad);
    if (!h) return null;

    const out = createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
            const p = applyHomography(h, x + 0.5, y + 0.5);
            sample(source, p.x, p.y, out.data, (y * size.width + x) * 4);
        }
    }
    return out;
}

/** Scale a quad from detection space back to the full-resolution photo. */
export function scaleQuad(quad: Quad, factor: number): Quad {
    const scale = (p: Point): Point => ({ x: p.x * factor, y: p.y * factor });
    return {
        topLeft: scale(quad.topLeft),
        topRight: scale(quad.topRight),
        bottomRight: scale(quad.bottomRight),
        bottomLeft: scale(quad.bottomLeft),
    };
}

/** Longest edge the detector wants; exported so the caller can size its scratch canvas. */
export const DETECTION_EDGE_PX = DETECT_EDGE_PX;
