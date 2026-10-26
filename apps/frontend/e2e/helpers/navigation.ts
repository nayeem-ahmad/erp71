import { expect, type Page } from '@playwright/test';

/**
 * Upper bound for one `gotoSettled` call. Hub walks multiply it by the
 * number of cards so one slow page does not exhaust the whole test.
 */
export const SETTLED_NAV_BUDGET_MS = 25_000;

/** Shell header, page title, or an explicit page-header test id. */
const PAGE_READY = 'h1, [data-testid="page-header"], header';

/**
 * Open an app route without waiting for the network to go idle.
 *
 * `networkidle` never arrives on a page that holds a fetch-based SSE stream
 * open — /support does, for its whole life — so the navigation was timing out
 * on a page that had already rendered. `domcontentloaded` plus a visible
 * header is the signal the route painted. A bounce to login is returned as-is
 * so the caller can fail on the URL instead of waiting for an app header.
 */
export async function gotoSettled(page: Page, url: string) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (/\/login|\/auth/.test(page.url())) return;
    await expect(page.locator(PAGE_READY).first()).toBeVisible({ timeout: 10_000 });
}
