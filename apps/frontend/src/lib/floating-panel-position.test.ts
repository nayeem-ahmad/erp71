import {
    clampPanelPosition,
    defaultPanelPosition,
    readPanelPosition,
    writePanelPosition,
} from './floating-panel-position';

const panel = { width: 352, height: 240 };
const viewport = { width: 1280, height: 800 };

describe('clampPanelPosition', () => {
    it('leaves a position that is already wholly on screen alone', () => {
        expect(clampPanelPosition({ x: 400, y: 300 }, panel, viewport)).toEqual({ x: 400, y: 300 });
    });

    it('pulls a panel dragged past the bottom-right corner back inside it', () => {
        expect(clampPanelPosition({ x: 5_000, y: 5_000 }, panel, viewport)).toEqual({
            x: 1280 - 352 - 8,
            y: 800 - 240 - 8,
        });
    });

    it('pulls one dragged past the top-left corner back too', () => {
        expect(clampPanelPosition({ x: -300, y: -40 }, panel, viewport)).toEqual({ x: 8, y: 8 });
    });

    /**
     * The case that decides whether a remembered position can strand the panel:
     * a laptop undocked from a wide monitor comes back to a window narrower
     * than the one the position was saved in.
     */
    it('keeps a panel wider than the window reachable rather than pushing it off the near edge', () => {
        const narrow = { width: 320, height: 200 };
        expect(clampPanelPosition({ x: 900, y: 900 }, panel, narrow)).toEqual({ x: 8, y: 8 });
    });
});

describe('defaultPanelPosition', () => {
    it('opens in the bottom-right corner of a left-to-right document', () => {
        expect(defaultPanelPosition(panel, viewport)).toEqual({ x: 920, y: 552 });
    });

    it('opens in the bottom-left corner when the document reads the other way', () => {
        expect(defaultPanelPosition(panel, viewport, { rtl: true })).toEqual({ x: 8, y: 552 });
    });
});

describe('remembering a position', () => {
    afterEach(() => window.localStorage.clear());

    it('reads back what it stored', () => {
        writePanelPosition('tracker', { x: 120.4, y: 80.6 });
        expect(readPanelPosition('tracker')).toEqual({ x: 120, y: 81 });
    });

    it('has no position for a panel that has never been moved', () => {
        expect(readPanelPosition('tracker')).toBeNull();
    });

    /** Stored state is JSON nobody validated on the way in. */
    it('treats a stored value that is not a position as no position at all', () => {
        window.localStorage.setItem('floating-panel:tracker', '{"x":"left"}');
        expect(readPanelPosition('tracker')).toBeNull();

        window.localStorage.setItem('floating-panel:tracker', 'not json');
        expect(readPanelPosition('tracker')).toBeNull();
    });
});
