import type { PageTimingSample } from './collector';
import { createPageTimingReporter, FLUSH_EVERY_MS, MAX_BATCH } from './reporter';

const sample = (route: string): PageTimingSample => ({
    route,
    nav_type: 'navigate',
    total_ms: 100,
    boot_ms: 10,
    data_ms: 80,
    render_ms: 10,
    api_calls: 1,
    network_ms: 20,
    server_ms: 60,
    db_ms: 40,
    token_wait_ms: 0,
});

describe('createPageTimingReporter', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sends queued samples together after the flush interval', () => {
        const send = jest.fn().mockResolvedValue(undefined);
        const reporter = createPageTimingReporter(send);
        reporter.report(sample('/a'));
        reporter.report(sample('/b'));
        expect(send).not.toHaveBeenCalled();

        jest.advanceTimersByTime(FLUSH_EVERY_MS);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].map((s: PageTimingSample) => s.route)).toEqual(['/a', '/b']);
        reporter.stop();
    });

    it('sends at once when a batch fills', () => {
        const send = jest.fn().mockResolvedValue(undefined);
        const reporter = createPageTimingReporter(send);
        for (let i = 0; i < MAX_BATCH; i += 1) reporter.report(sample(`/p${i}`));
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toHaveLength(MAX_BATCH);
        reporter.stop();
    });

    it('sends what it has when the tab is hidden or closed', () => {
        const send = jest.fn().mockResolvedValue(undefined);
        const reporter = createPageTimingReporter(send);
        reporter.report(sample('/a'));
        window.dispatchEvent(new Event('pagehide'));
        expect(send).toHaveBeenCalledTimes(1);
        reporter.stop();
    });

    it('drops a failed batch without throwing', async () => {
        const send = jest.fn().mockRejectedValue(new Error('offline'));
        const reporter = createPageTimingReporter(send);
        reporter.report(sample('/a'));
        expect(() => reporter.flush()).not.toThrow();
        await Promise.resolve();
        reporter.stop();
        expect(send).toHaveBeenCalledTimes(1);
    });
});
