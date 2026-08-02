import {
    applyHomography,
    convexHull,
    detectCardQuad,
    orderCorners,
    outputSize,
    polygonArea,
    quadCorners,
    scaleQuad,
    solveHomography,
    strongEdgePoints,
    warpQuadToRect,
    type Point,
    type Quad,
} from './card-dewarp';

/** jsdom has no canvas, so ImageData is built by hand. */
function makeImage(width: number, height: number, paint: (x: number, y: number) => number[]): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b, a = 255] = paint(x, y);
            const o = (y * width + x) * 4;
            data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
        }
    }
    return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

const createImageData = (w: number, h: number): ImageData =>
    ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' }) as ImageData;

/** A light card on a dark background, inset from the frame. */
const cardOnDesk = (width = 120, height = 90, inset = 18) =>
    makeImage(width, height, (x, y) =>
        x >= inset && x < width - inset && y >= inset && y < height - inset
            ? [235, 235, 235]
            : [30, 30, 30],
    );

const rect = (x0: number, y0: number, x1: number, y1: number): Quad => ({
    topLeft: { x: x0, y: y0 },
    topRight: { x: x1, y: y0 },
    bottomRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y1 },
});

describe('polygonArea', () => {
    it('measures a rectangle', () => {
        expect(polygonArea(quadCorners(rect(0, 0, 10, 4)))).toBe(40);
    });

    it('ignores winding direction', () => {
        const pts = quadCorners(rect(0, 0, 10, 4));
        expect(polygonArea([...pts].reverse())).toBe(40);
    });
});

describe('orderCorners', () => {
    it('orders a shuffled rectangle clockwise from the top-left', () => {
        const q = orderCorners([
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 10, y: 0 },
            { x: 0, y: 0 },
        ]);
        expect(q).toEqual(rect(0, 0, 10, 10));
    });

    it('keeps a steep trapezoid’s corners in the right slots', () => {
        // A card shot from an angle: the far edge is much shorter than the near
        // one. Sorting by angle around the centroid gets this wrong.
        const q = orderCorners([
            { x: 30, y: 0 },
            { x: 70, y: 0 },
            { x: 100, y: 60 },
            { x: 0, y: 60 },
        ]);
        expect(q.topLeft).toEqual({ x: 30, y: 0 });
        expect(q.topRight).toEqual({ x: 70, y: 0 });
        expect(q.bottomRight).toEqual({ x: 100, y: 60 });
        expect(q.bottomLeft).toEqual({ x: 0, y: 60 });
    });

    it('refuses anything that is not four points', () => {
        expect(() => orderCorners([{ x: 0, y: 0 }])).toThrow();
    });
});

describe('convexHull', () => {
    it('drops interior points', () => {
        const hull = convexHull([
            { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
            { x: 5, y: 5 },
        ]);
        expect(hull).toHaveLength(4);
        expect(hull).not.toContainEqual({ x: 5, y: 5 });
    });
});

describe('solveHomography', () => {
    it('round-trips the corners it was built from', () => {
        const from = rect(0, 0, 100, 50);
        const to: Quad = {
            topLeft: { x: 10, y: 4 },
            topRight: { x: 90, y: 12 },
            bottomRight: { x: 84, y: 60 },
            bottomLeft: { x: 4, y: 48 },
        };
        const h = solveHomography(from, to)!;
        expect(h).not.toBeNull();

        quadCorners(from).forEach((src, i) => {
            const mapped = applyHomography(h, src.x, src.y);
            const want = quadCorners(to)[i];
            expect(mapped.x).toBeCloseTo(want.x, 6);
            expect(mapped.y).toBeCloseTo(want.y, 6);
        });
    });

    it('returns null for a degenerate quad rather than NaNs', () => {
        // Three collinear corners: there is no valid homography, and silently
        // returning one would warp the photo into garbage.
        const flat: Quad = {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 10, y: 0 },
            bottomRight: { x: 20, y: 0 },
            bottomLeft: { x: 30, y: 0 },
        };
        expect(solveHomography(rect(0, 0, 10, 10), flat)).toBeNull();
    });
});

describe('outputSize', () => {
    it('takes the longer of each opposing pair so no edge is squeezed', () => {
        const q: Quad = {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 80, y: 0 },
            bottomRight: { x: 100, y: 50 },
            bottomLeft: { x: 0, y: 50 },
        };
        // The slanted right edge is hypot(20,50) = 53.85, and taking the longer of
        // each pair is the point — squeezing it to 50 would compress that side.
        expect(outputSize(q, 1000)).toEqual({ width: 100, height: 54 });
    });

    it('scales down to the cap while keeping the aspect', () => {
        const size = outputSize(rect(0, 0, 2000, 1000), 500);
        expect(size).toEqual({ width: 500, height: 250 });
    });

    it('never returns a zero dimension', () => {
        const size = outputSize(rect(0, 0, 1, 1), 10);
        expect(size.width).toBeGreaterThan(0);
        expect(size.height).toBeGreaterThan(0);
    });
});

describe('detectCardQuad', () => {
    it('finds a card inset from the background', () => {
        const quad = detectCardQuad(cardOnDesk());
        expect(quad).not.toBeNull();

        // Corners land on the card border, within a pixel or two of the inset.
        expect(quad!.topLeft.x).toBeGreaterThanOrEqual(15);
        expect(quad!.topLeft.x).toBeLessThanOrEqual(21);
        expect(quad!.bottomRight.x).toBeGreaterThanOrEqual(99);
        expect(quad!.bottomRight.x).toBeLessThanOrEqual(105);
    });

    it('declines a flat image rather than guessing', () => {
        // No card, no edges. A guess here would crop the photo to noise.
        expect(detectCardQuad(makeImage(80, 60, () => [200, 200, 200]))).toBeNull();
    });

    it('declines when the card fills the whole frame', () => {
        // Nothing to crop, and the "quad" would just be the frame border.
        expect(detectCardQuad(makeImage(80, 60, () => [240, 240, 240]))).toBeNull();
    });

    it('declines noise with no coherent outline', () => {
        let seed = 7;
        const noise = makeImage(80, 60, () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            const v = seed % 256;
            return [v, v, v];
        });
        expect(detectCardQuad(noise)).toBeNull();
    });
});

describe('strongEdgePoints', () => {
    it('returns nothing for an image with no gradient', () => {
        expect(strongEdgePoints(makeImage(40, 30, () => [128, 128, 128]))).toHaveLength(0);
    });

    it('picks out a border', () => {
        const points = strongEdgePoints(cardOnDesk(60, 60, 12));
        expect(points.length).toBeGreaterThan(0);
        // Every point should sit near the card border, not in its flat middle.
        const middle = points.filter((p: Point) => p.x > 20 && p.x < 40 && p.y > 20 && p.y < 40);
        expect(middle).toHaveLength(0);
    });
});

describe('warpQuadToRect', () => {
    it('flattens a rotated card into an upright rectangle', () => {
        // Left half black, right half white, sampled through a slanted quad.
        const src = makeImage(100, 100, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));
        const out = warpQuadToRect(src, rect(0, 0, 100, 100), { width: 20, height: 20 }, createImageData)!;

        expect(out).not.toBeNull();
        const px = (x: number, y: number) => out.data[(y * 20 + x) * 4];
        expect(px(2, 10)).toBeLessThan(40);
        expect(px(17, 10)).toBeGreaterThan(215);
    });

    it('returns null for a degenerate quad instead of a smeared image', () => {
        const src = makeImage(20, 20, () => [10, 10, 10]);
        const flat: Quad = {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 5, y: 0 },
            bottomRight: { x: 10, y: 0 },
            bottomLeft: { x: 15, y: 0 },
        };
        expect(warpQuadToRect(src, flat, { width: 5, height: 5 }, createImageData)).toBeNull();
    });

    it('clamps at the border rather than sampling black outside the photo', () => {
        const src = makeImage(20, 20, () => [200, 100, 50]);
        // A quad that overhangs the image on every side.
        const out = warpQuadToRect(src, rect(-5, -5, 25, 25), { width: 8, height: 8 }, createImageData)!;
        expect(out.data[0]).toBe(200);
        expect(out.data[1]).toBe(100);
    });
});

describe('scaleQuad', () => {
    it('maps detection-space corners back to full resolution', () => {
        expect(scaleQuad(rect(0, 0, 10, 5), 4)).toEqual(rect(0, 0, 40, 20));
    });
});
