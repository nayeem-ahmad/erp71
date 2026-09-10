import type { Area } from 'react-easy-crop';
import { getCroppedImageBlob } from './crop-image';

// jsdom has no canvas backend and never loads an <img>, so both are stubbed:
// what is under test is the geometry handed to drawImage, not the pixels.
const drawImage = jest.fn();
const toBlob = jest.fn();
const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob } as any;

beforeEach(() => {
    jest.clearAllMocks();
    toBlob.mockImplementation((cb: (blob: Blob) => void) => cb(new Blob(['x'])));
    const realCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) =>
        tag === 'canvas' ? canvas : realCreateElement(tag, ...rest)) as any);
    // `createImage` waits on the element's load event, which jsdom never fires
    // for a data URL; firing it on assignment keeps the promise resolvable.
    Object.defineProperty(globalThis.Image.prototype, 'src', {
        configurable: true,
        set(this: HTMLImageElement) {
            setTimeout(() => this.dispatchEvent(new Event('load')), 0);
        },
    });
});

afterEach(() => jest.restoreAllMocks());

const crop = (width: number, height: number): Area => ({ x: 10, y: 20, width, height });

describe('getCroppedImageBlob', () => {
    it('keeps the crop at its own size when no ceiling is given', async () => {
        await getCroppedImageBlob('data:image/png;base64,x', crop(4000, 2250));

        expect(canvas.width).toBe(4000);
        expect(canvas.height).toBe(2250);
        expect(drawImage).toHaveBeenCalledWith(
            expect.anything(), 10, 20, 4000, 2250, 0, 0, 4000, 2250,
        );
    });

    it('scales an oversized crop down to the ceiling, keeping its shape', async () => {
        await getCroppedImageBlob('data:image/png;base64,x', crop(4000, 2250), 'image/jpeg', 2400);

        expect(canvas.width).toBe(2400);
        expect(canvas.height).toBe(1350);
    });

    it('never scales a small crop up to the ceiling', async () => {
        await getCroppedImageBlob('data:image/png;base64,x', crop(600, 200), 'image/jpeg', 2400);

        expect(canvas.width).toBe(600);
        expect(canvas.height).toBe(200);
    });

    it('measures the ceiling against the longest edge, whichever it is', async () => {
        await getCroppedImageBlob('data:image/png;base64,x', crop(500, 4000), 'image/jpeg', 800);

        expect(canvas.height).toBe(800);
        expect(canvas.width).toBe(100);
    });

    it('never rounds an edge away to nothing', async () => {
        await getCroppedImageBlob('data:image/png;base64,x', crop(4000, 2), 'image/jpeg', 100);

        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(1);
    });
});
