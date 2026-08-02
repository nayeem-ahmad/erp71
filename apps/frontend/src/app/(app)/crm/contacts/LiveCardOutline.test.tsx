import { render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import LiveCardOutline, { fittedContentRect } from './LiveCardOutline';

jest.mock('@/lib/card-dewarp', () => ({
    DETECTION_EDGE_PX: 256,
    detectCardQuad: jest.fn(),
    quadCorners: (q: any) => [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft],
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { detectCardQuad } = require('@/lib/card-dewarp');

const QUAD = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 90, y: 10 },
    bottomRight: { x: 90, y: 60 },
    bottomLeft: { x: 10, y: 60 },
};

/** jsdom has no canvas; this records what the overlay would have drawn. */
function stubCanvas() {
    const calls: string[] = [];
    const ctx = {
        setTransform: () => calls.push('setTransform'),
        clearRect: () => calls.push('clearRect'),
        beginPath: () => calls.push('beginPath'),
        moveTo: () => calls.push('moveTo'),
        lineTo: () => calls.push('lineTo'),
        closePath: () => calls.push('closePath'),
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        rect: () => calls.push('rect'),
        fill: () => calls.push('fill'),
        stroke: () => calls.push('stroke'),
        arc: () => calls.push('arc'),
        drawImage: () => calls.push('drawImage'),
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        set fillStyle(_v: string) { /* recorded via fill */ },
        set strokeStyle(_v: string) { /* recorded via stroke */ },
        set lineWidth(_v: number) { /* recorded via stroke */ },
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never;
    return calls;
}

function videoRef(dimensions = { videoWidth: 640, videoHeight: 480 }) {
    const el = document.createElement('video');
    Object.defineProperty(el, 'videoWidth', { value: dimensions.videoWidth, configurable: true });
    Object.defineProperty(el, 'videoHeight', { value: dimensions.videoHeight, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
    const ref = createRef<HTMLVideoElement>();
    (ref as { current: HTMLVideoElement }).current = el;
    return ref;
}

describe('LiveCardOutline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('renders nothing while inactive and never samples the feed', () => {
        stubCanvas();
        const { container } = render(<LiveCardOutline video={videoRef()} active={false} />);

        expect(container).toBeEmptyDOMElement();
        expect(detectCardQuad).not.toHaveBeenCalled();
    });

    it('reports a detected card to the caller', async () => {
        stubCanvas();
        detectCardQuad.mockReturnValue(QUAD);
        const onDetectionChange = jest.fn();

        render(<LiveCardOutline video={videoRef()} active onDetectionChange={onDetectionChange} />);

        await waitFor(() => expect(onDetectionChange).toHaveBeenCalledWith(true));
    });

    it('reports nothing found when the frame holds no card', async () => {
        stubCanvas();
        detectCardQuad.mockReturnValue(null);
        const onDetectionChange = jest.fn();

        render(<LiveCardOutline video={videoRef()} active onDetectionChange={onDetectionChange} />);

        await waitFor(() => expect(onDetectionChange).toHaveBeenCalledWith(false));
    });

    /**
     * Detection dips out for a frame on a hand tremor. Dropping the outline the
     * instant that happens makes it strobe, which reads as broken.
     */
    it('holds the last outline across a brief detection dropout', async () => {
        stubCanvas();
        detectCardQuad.mockReturnValue(QUAD);
        const onDetectionChange = jest.fn();

        render(<LiveCardOutline video={videoRef()} active onDetectionChange={onDetectionChange} />);
        await waitFor(() => expect(onDetectionChange).toHaveBeenCalledWith(true));

        detectCardQuad.mockReturnValue(null);
        onDetectionChange.mockClear();
        jest.advanceTimersByTime(130);

        expect(onDetectionChange).toHaveBeenCalledWith(true);
        expect(onDetectionChange).not.toHaveBeenCalledWith(false);
    });

    it('gives up on the outline once the card is gone for good', async () => {
        stubCanvas();
        detectCardQuad.mockReturnValue(QUAD);
        const onDetectionChange = jest.fn();

        render(<LiveCardOutline video={videoRef()} active onDetectionChange={onDetectionChange} />);
        await waitFor(() => expect(onDetectionChange).toHaveBeenCalledWith(true));

        detectCardQuad.mockReturnValue(null);
        onDetectionChange.mockClear();
        for (let i = 0; i < 6; i++) jest.advanceTimersByTime(130);

        expect(onDetectionChange).toHaveBeenCalledWith(false);
    });

    // A camera that has not reported dimensions yet must not be sampled, and
    // must not kill the loop either.
    it('waits for the stream to report its dimensions', () => {
        stubCanvas();
        render(<LiveCardOutline video={videoRef({ videoWidth: 0, videoHeight: 0 })} active />);

        expect(detectCardQuad).not.toHaveBeenCalled();
    });

    it('stops sampling once it unmounts', async () => {
        stubCanvas();
        detectCardQuad.mockReturnValue(QUAD);
        const { unmount } = render(<LiveCardOutline video={videoRef()} active />);
        await waitFor(() => expect(detectCardQuad).toHaveBeenCalled());

        unmount();
        const seen = detectCardQuad.mock.calls.length;
        jest.advanceTimersByTime(600);

        expect(detectCardQuad).toHaveBeenCalledTimes(seen);
    });

    // A frame the browser refuses to hand over must not end the loop.
    it('survives a frame that cannot be read', async () => {
        stubCanvas();
        detectCardQuad.mockImplementation(() => { throw new Error('tainted canvas'); });
        const onDetectionChange = jest.fn();

        render(<LiveCardOutline video={videoRef()} active onDetectionChange={onDetectionChange} />);
        await waitFor(() => expect(onDetectionChange).toHaveBeenCalledWith(false));

        const seen = detectCardQuad.mock.calls.length;
        jest.advanceTimersByTime(130);
        expect(detectCardQuad.mock.calls.length).toBeGreaterThan(seen);
    });
});

describe('fittedContentRect', () => {
    // Drawing against the element's own box instead of this rectangle puts the
    // outline off the picture by exactly the width of the letterbox bars.
    it('centres pillarboxed video horizontally', () => {
        expect(fittedContentRect(400, 300, 640, 640)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    });

    it('centres letterboxed video vertically', () => {
        expect(fittedContentRect(400, 400, 640, 480)).toEqual({ x: 0, y: 50, width: 400, height: 300 });
    });

    it('fills the box when the aspect ratios match', () => {
        expect(fittedContentRect(320, 240, 640, 480)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
    });

    // A stream with no dimensions yet must not yield NaN, which would blank the
    // whole overlay silently.
    it('falls back to the box when the content has no dimensions', () => {
        expect(fittedContentRect(400, 300, 0, 0)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    });
});
