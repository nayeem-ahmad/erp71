import type { PageTimingSample } from './collector';

/** How often queued samples go out, and the most one request carries (the backend's limit). */
export const FLUSH_EVERY_MS = 15_000;
export const MAX_BATCH = 20;
const MAX_QUEUE = 100;

/**
 * Batches finished page views and sends them to the dashboard: every
 * `FLUSH_EVERY_MS`, and straight away when the tab is hidden or closed, which
 * is the last moment a page can be sure to get a request out. Failures are
 * dropped — telemetry is never retried at the cost of the user's own requests.
 */
export function createPageTimingReporter(send: (samples: PageTimingSample[]) => Promise<unknown>) {
    let queue: PageTimingSample[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        while (queue.length) {
            const batch = queue.slice(0, MAX_BATCH);
            queue = queue.slice(MAX_BATCH);
            void send(batch).catch(() => undefined);
        }
    };

    const onHidden = () => {
        if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);

    return {
        report(sample: PageTimingSample) {
            queue.push(sample);
            if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
            if (queue.length >= MAX_BATCH) flush();
            else if (!timer) timer = setTimeout(flush, FLUSH_EVERY_MS);
        },
        flush,
        stop() {
            flush();
            document.removeEventListener('visibilitychange', onHidden);
            window.removeEventListener('pagehide', flush);
        },
    };
}
