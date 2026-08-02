import { detectCardQuad, quadCorners, type Point, type Quad } from './card-dewarp';

/**
 * Detection against frames that look like photographs rather than diagrams.
 *
 * The suite next door builds a uniform light rectangle on a uniform dark field,
 * which every version of the detector has passed — including the one that was
 * shipped and did not work. What breaks it is the ordinary stuff of a real
 * photo: printing on the card, grain in the desk, a shadow, poor contrast. Each
 * case here asserts the detected corners land on the card, not merely that
 * something was returned, because the two failures this suite was written for
 * were a confident lock onto the *text block* and a silent fall back to the
 * whole frame.
 */

const W = 256;
const H = 192;
const INSET_X = 40;
const INSET_Y = 45;

/** Where the card actually is in every frame below. */
const TRUE_CARD: Quad = {
    topLeft: { x: INSET_X, y: INSET_Y },
    topRight: { x: W - INSET_X, y: INSET_Y },
    bottomRight: { x: W - INSET_X, y: H - INSET_Y },
    bottomLeft: { x: INSET_X, y: H - INSET_Y },
};

let seed = 12345;
function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

function frame(paint: (x: number, y: number) => number): ImageData {
    seed = 12345;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const v = Math.max(0, Math.min(255, paint(x, y)));
            const o = (y * W + x) * 4;
            data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
        }
    }
    return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const onCard = (x: number, y: number) =>
    x >= INSET_X && x < W - INSET_X && y >= INSET_Y && y < H - INSET_Y;

const vignette = (x: number, y: number) =>
    1 - 0.35 * (Math.hypot(x - W * 0.3, y - H * 0.3) / Math.hypot(W, H));

/** Five lines of dark print, deliberately higher contrast than the card's own border. */
const printing = (x: number, y: number): boolean => {
    if (!onCard(x, y)) return false;
    const row = Math.floor((y - INSET_Y) / 12);
    return (y - INSET_Y) % 12 < 5 && row >= 1 && x > INSET_X + 12 && x < W - INSET_X - 18;
};

function expectFoundCard(found: Quad | null, tolerance = 6) {
    expect(found).not.toBeNull();
    const got = quadCorners(found!);
    const want = quadCorners(TRUE_CARD);
    for (let i = 0; i < 4; i++) {
        expect(Math.abs(got[i].x - want[i].x)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(got[i].y - want[i].y)).toBeLessThanOrEqual(tolerance);
    }
}

describe('detectCardQuad on photograph-like frames', () => {
    it('finds a card under sensor noise and uneven lighting', () => {
        const found = detectCardQuad(
            frame((x, y) => (onCard(x, y) ? 235 : 60) * vignette(x, y) + (rand() - 0.5) * 18),
        );
        expectFoundCard(found);
    });

    /**
     * The regression that mattered most. Print is a stronger edge than the card
     * against a desk, so ranking pixels by gradient alone put the whole text
     * block ahead of the border and the detector confidently returned the
     * printing as the card.
     */
    it('locks onto the border, not the printing, when print out-contrasts the edge', () => {
        const found = detectCardQuad(
            frame((x, y) => {
                const base = printing(x, y) ? 25 : (onCard(x, y) ? 235 : 60);
                return base * vignette(x, y) + (rand() - 0.5) * 18;
            }),
        );
        expectFoundCard(found);
    });

    /**
     * The other half of the same bug. Texture is weaker than a border but
     * covers most of the frame, so a population percentile put the bar inside
     * the grain; the hull became the whole picture and detection gave up.
     */
    it('finds a card on a wood-grain desk', () => {
        const found = detectCardQuad(
            frame((x, y) => {
                if (onCard(x, y)) return 238 + (rand() - 0.5) * 12;
                return 120 + Math.sin(y * 0.7 + Math.sin(x * 0.05) * 3) * 26 + (rand() - 0.5) * 16;
            }),
        );
        expectFoundCard(found);
    });

    it('finds a card on a wood-grain desk that also carries printing', () => {
        const found = detectCardQuad(
            frame((x, y) => {
                if (printing(x, y)) return 25 + (rand() - 0.5) * 12;
                if (onCard(x, y)) return 238 + (rand() - 0.5) * 12;
                return 120 + Math.sin(y * 0.7 + Math.sin(x * 0.05) * 3) * 26 + (rand() - 0.5) * 16;
            }),
        );
        expectFoundCard(found);
    });

    it('finds a white card on a pale desk', () => {
        const found = detectCardQuad(
            frame((x, y) => (onCard(x, y) ? 245 : 205) + (rand() - 0.5) * 14),
        );
        expectFoundCard(found);
    });

    /**
     * A shadow hugging the card is a real edge just outside it, so the outline
     * lands on the shadow's outer boundary and comes out a few pixels large.
     * That is the honest answer rather than a defect — the tolerance here is
     * the shadow's own width, and the cropper's corners are draggable for
     * exactly this. What matters is that it does not fall back to the frame.
     */
    it('finds a white card on a pale desk, taking in its drop shadow', () => {
        const shadowOffset = 7;
        const found = detectCardQuad(
            frame((x, y) => {
                if (onCard(x, y)) return 245 + (rand() - 0.5) * 14;
                const shadowed = onCard(x - shadowOffset, y - shadowOffset);
                return (shadowed ? 165 : 205) + (rand() - 0.5) * 14;
            }),
        );
        expectFoundCard(found, shadowOffset + 3);
    });

    it('still refuses a frame with no card in it', () => {
        expect(
            detectCardQuad(frame((x, y) => 120 + Math.sin(y * 0.7) * 26 + (rand() - 0.5) * 16)),
        ).toBeNull();
    });

    it('follows a card held at an angle', () => {
        const found = detectCardQuad(
            frame((x, y) => {
                if (y < 30 || y > H - 30) return 45 + (rand() - 0.5) * 16;
                const halfWidth = 55 + ((y - 30) / (H - 60)) * 40;
                const inside = x > W / 2 - halfWidth && x < W / 2 + halfWidth;
                return (inside ? 235 : 45) + (rand() - 0.5) * 16;
            }),
        );
        expect(found).not.toBeNull();
        // A trapezoid, so only the shape is checked: the top edge must come back
        // measurably narrower than the bottom rather than squared off.
        const top = found!.topRight.x - found!.topLeft.x;
        const bottom = found!.bottomRight.x - found!.bottomLeft.x;
        expect(bottom).toBeGreaterThan(top + 20);
    });
});

/** Guards the geometric rule that removes printing from consideration. */
describe('outermost-edge selection', () => {
    it('is unaffected by how much print a card carries', () => {
        const bare = detectCardQuad(
            frame((x, y) => (onCard(x, y) ? 235 : 60) + (rand() - 0.5) * 14),
        );
        const dense = detectCardQuad(
            frame((x, y) => {
                // Print over nearly the whole card face.
                const inked = onCard(x, y) && (y - INSET_Y) % 6 < 3 && x > INSET_X + 4 && x < W - INSET_X - 4;
                return (inked ? 20 : (onCard(x, y) ? 235 : 60)) + (rand() - 0.5) * 14;
            }),
        );

        expectFoundCard(bare);
        expectFoundCard(dense);

        const a = quadCorners(bare!);
        const b = quadCorners(dense!);
        for (let i = 0; i < 4; i++) {
            expect(Math.abs(a[i].x - b[i].x)).toBeLessThanOrEqual(4);
            expect(Math.abs(a[i].y - b[i].y)).toBeLessThanOrEqual(4);
        }
    });
});

/** Keeps the helpers honest — a typo here would silently weaken every case above. */
describe('test fixtures', () => {
    it('places print inside the card and never on its border', () => {
        const points: Point[] = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (printing(x, y)) points.push({ x, y });

        expect(points.length).toBeGreaterThan(200);
        for (const p of points) {
            expect(p.x).toBeGreaterThan(INSET_X);
            expect(p.x).toBeLessThan(W - INSET_X);
            expect(p.y).toBeGreaterThan(INSET_Y);
            expect(p.y).toBeLessThan(H - INSET_Y);
        }
    });
});
