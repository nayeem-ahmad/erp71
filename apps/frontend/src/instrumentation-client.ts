/*
 * Next runs this before the app hydrates, on every page. Keep it to the page
 * timer: anything imported here is downloaded by every visitor.
 */
import { pageTiming } from '@/lib/page-timing/collector';

/** A route change began: the start of the page view the timer measures. */
export function onRouterTransitionStart(url: string): void {
    pageTiming.navigationStarted(url);
}
