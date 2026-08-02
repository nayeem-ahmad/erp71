import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CardCropper from './CardCropper';

const detectCardQuad = jest.fn();
const warpQuadToRect = jest.fn();

jest.mock('@/lib/card-dewarp', () => {
    const actual = jest.requireActual('@/lib/card-dewarp');
    return {
        ...actual,
        detectCardQuad: (...a: unknown[]) => detectCardQuad(...a),
        warpQuadToRect: (...a: unknown[]) => warpQuadToRect(...a),
    };
});

const QUAD = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 90, y: 12 },
    bottomRight: { x: 88, y: 60 },
    bottomLeft: { x: 12, y: 58 },
};

/** jsdom never fires load on an <img>, and never paints a canvas. Both are faked. */
function stubBrowserImaging() {
    Object.defineProperty(global.Image.prototype, 'src', {
        configurable: true,
        set() {
            Object.defineProperty(this, 'width', { value: 100, configurable: true });
            Object.defineProperty(this, 'height', { value: 70, configurable: true });
            setTimeout(() => this.onload?.(), 0);
        },
    });

    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
        drawImage: jest.fn(),
        putImageData: jest.fn(),
        createImageData: (w: number, h: number) => ({
            width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
        }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
            width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
        }),
    })) as never;

    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/jpeg;base64,CROPPED');
}

beforeAll(stubBrowserImaging);

beforeEach(() => {
    detectCardQuad.mockReset().mockReturnValue(QUAD);
    warpQuadToRect.mockReset().mockReturnValue({
        width: 8, height: 5, data: new Uint8ClampedArray(8 * 5 * 4),
    });
});

/**
 * The image load is async, and the crop button is disabled until it resolves.
 * Waiting on a corner handle is the honest proof that the cropper is live.
 */
const ready = async () => {
    await waitFor(() => expect(screen.getByLabelText(/top left corner/i)).toBeInTheDocument());
};

describe('CardCropper', () => {
    it('shows four draggable corners once an image loads', async () => {
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={jest.fn()} onSkip={jest.fn()} />);

        await waitFor(() => expect(screen.getByLabelText(/top left corner/i)).toBeInTheDocument());
        expect(screen.getByLabelText(/top right corner/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/bottom right corner/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/bottom left corner/i)).toBeInTheDocument();
    });

    it('says so when it found edges, and offers a reset', async () => {
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={jest.fn()} onSkip={jest.fn()} />);

        expect(await screen.findByText(/card edges detected/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reset corners/i })).toBeInTheDocument();
    });

    it('admits when it found nothing rather than pretending the full frame is the card', async () => {
        // The corners still appear, on the whole frame, so the user can place
        // them — but the copy must not claim a detection that did not happen.
        detectCardQuad.mockReturnValue(null);
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={jest.fn()} onSkip={jest.fn()} />);

        await ready();
        expect(screen.getByText(/no card edges found/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reset corners/i })).not.toBeInTheDocument();
    });

    it('hands back a cropped JPEG when the crop is accepted', async () => {
        const onCropped = jest.fn();
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={onCropped} onSkip={jest.fn()} />);
        await ready();

        fireEvent.click(screen.getByRole('button', { name: /crop to card/i }));

        await waitFor(() => expect(onCropped).toHaveBeenCalledWith('data:image/jpeg;base64,CROPPED'));
    });

    it('falls back to the untouched photo when the warp is impossible', async () => {
        // Three corners dragged into a line. A smeared image would extract worse
        // than the original, so this must degrade to the original.
        warpQuadToRect.mockReturnValue(null);
        const onCropped = jest.fn();
        const onSkip = jest.fn();
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={onCropped} onSkip={onSkip} />);
        await ready();

        fireEvent.click(screen.getByRole('button', { name: /crop to card/i }));

        await waitFor(() => expect(onSkip).toHaveBeenCalled());
        expect(onCropped).not.toHaveBeenCalled();
    });

    it('lets the user bail out with the full image', async () => {
        const onSkip = jest.fn();
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={jest.fn()} onSkip={onSkip} />);

        fireEvent.click(await screen.findByRole('button', { name: /use full image/i }));
        expect(onSkip).toHaveBeenCalled();
    });

    it('survives a detector that throws instead of blocking the scan', async () => {
        detectCardQuad.mockImplementation(() => { throw new Error('boom'); });
        render(<CardCropper dataUrl="data:image/jpeg;base64,X" onCropped={jest.fn()} onSkip={jest.fn()} />);
        await ready();

        expect(screen.getByRole('button', { name: /use full image/i })).toBeInTheDocument();
        expect(screen.getByText(/no card edges found/i)).toBeInTheDocument();
    });
});
