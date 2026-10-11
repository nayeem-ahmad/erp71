import type { Page } from '@playwright/test';

/** Upper bound for one `gotoSettled` call — the page load plus the idle wait. */
export const SETTLED_NAV_BUDGET_MS = 25_000;

/**
 * Navigate and let the page's data requests finish.
 *
 * `waitUntil: 'networkidle'` alone never resolves on a page that holds a live
 * stream open — /support keeps a fetch-based SSE connection to the backend for
 * its whole life — so the navigation itself is awaited to `load`, and the idle
 * wait after it is best-effort: on a streaming page it gives up after
 * `idleMs` and the caller's assertions run against what has rendered.
 */
export async function gotoSettled(page: Page, url: string, { idleMs = 10_000 } = {}) {
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: idleMs }).catch(() => {});
}
