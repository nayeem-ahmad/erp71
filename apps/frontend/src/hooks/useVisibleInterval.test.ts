import { act, renderHook } from '@testing-library/react';
import { useVisibleInterval } from './useVisibleInterval';

const MS = 60_000;

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

function advance(ms: number) {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

describe('useVisibleInterval', () => {
    beforeAll(() => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibility,
        });
    });

    afterAll(() => {
        delete (document as { visibilityState?: unknown }).visibilityState;
    });

    beforeEach(() => {
        visibility = 'visible';
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('ticks every interval while the tab is visible, not on mount', () => {
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        expect(callback).not.toHaveBeenCalled();
        advance(MS);
        expect(callback).toHaveBeenCalledTimes(1);
        advance(2 * MS);
        expect(callback).toHaveBeenCalledTimes(3);
    });

    it('does not tick while the tab is hidden', () => {
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        setVisibility('hidden');
        advance(10 * MS);

        expect(callback).not.toHaveBeenCalled();
    });

    it('ticks once at once on coming back after a tick fell due, then keeps its cadence', () => {
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        setVisibility('hidden');
        advance(5 * MS);
        setVisibility('visible');

        // One catch-up tick, not one per missed interval.
        expect(callback).toHaveBeenCalledTimes(1);
        advance(MS - 1);
        expect(callback).toHaveBeenCalledTimes(1);
        advance(1);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('finishes the current interval when nothing fell due while hidden', () => {
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        advance(20_000);
        setVisibility('hidden');
        advance(10_000);
        setVisibility('visible');

        // Back 30 s into a 60 s interval: no extra request for a quick tab
        // switch, and the tick lands where it always would have.
        expect(callback).not.toHaveBeenCalled();
        advance(30_000 - 1);
        expect(callback).not.toHaveBeenCalled();
        advance(1);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('never runs faster than the interval, however often the tab is flicked', () => {
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        for (let i = 0; i < 10; i += 1) {
            setVisibility('hidden');
            advance(1_000);
            setVisibility('visible');
            advance(1_000);
        }

        expect(callback).not.toHaveBeenCalled();
    });

    it('waits for the tab to be shown when mounted in a hidden tab', () => {
        visibility = 'hidden';
        const callback = jest.fn();
        renderHook(() => useVisibleInterval(callback, MS));

        advance(3 * MS);
        expect(callback).not.toHaveBeenCalled();

        setVisibility('visible');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does nothing while ms is null, and starts once it is set', () => {
        const callback = jest.fn();
        const { rerender } = renderHook(({ ms }) => useVisibleInterval(callback, ms), {
            initialProps: { ms: null as number | null },
        });

        advance(10 * MS);
        expect(callback).not.toHaveBeenCalled();

        rerender({ ms: MS });
        advance(MS);
        expect(callback).toHaveBeenCalledTimes(1);

        rerender({ ms: null });
        advance(10 * MS);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('restarts the interval when ms changes', () => {
        const callback = jest.fn();
        const { rerender } = renderHook(({ ms }) => useVisibleInterval(callback, ms), {
            initialProps: { ms: 5_000 },
        });

        advance(4_000);
        rerender({ ms: MS });
        advance(5_000);
        expect(callback).not.toHaveBeenCalled();
        advance(MS - 5_000);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('calls the latest callback without restarting the timer', () => {
        const first = jest.fn();
        const second = jest.fn();
        const { rerender } = renderHook(({ cb }) => useVisibleInterval(cb, MS), {
            initialProps: { cb: first },
        });

        advance(MS / 2);
        rerender({ cb: second });
        advance(MS / 2);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps polling after a callback throws', () => {
        const callback = jest.fn(() => {
            throw new Error('boom');
        });
        renderHook(() => useVisibleInterval(callback, MS));

        expect(() => jest.advanceTimersByTime(MS)).toThrow('boom');
        expect(() => jest.advanceTimersByTime(MS)).toThrow('boom');
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('stops ticking and listening once unmounted', () => {
        const callback = jest.fn();
        const { unmount } = renderHook(() => useVisibleInterval(callback, MS));

        unmount();
        advance(5 * MS);
        setVisibility('hidden');
        setVisibility('visible');

        expect(callback).not.toHaveBeenCalled();
    });
});
