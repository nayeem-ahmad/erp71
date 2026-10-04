/*
 * `withSentryConfig` injects this file into webpack's `main-app` entry, so
 * anything it imports statically is downloaded on every page by every visitor.
 * It used to import the whole SDK and set up Session Replay (rrweb, the
 * largest part of it) at the top — and production has no DSN: `NEXT_PUBLIC_*`
 * is inlined at build time and the Docker build does not pass
 * `NEXT_PUBLIC_SENTRY_DSN`, so all of that shipped only to run
 * `Sentry.init({ enabled: false })`.
 *
 * Now a build without a DSN loads nothing. A build with one fetches the SDK as
 * a chunk of its own once the page has started, and Replay from Sentry's CDN
 * after that, so the recorder is never in our bundles. The cost is that an
 * error thrown before that chunk lands goes unreported.
 */
async function startSentry(dsn: string) {
    // `webpackExports` names what is used, so webpack can tree-shake this
    // chunk as it would a static import. Anything used from `Sentry` below
    // must be listed, or it is undefined at runtime.
    const Sentry = await import(
        /* webpackExports: ["init", "lazyLoadIntegration", "addIntegration"] */ '@sentry/nextjs'
    );
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        replaysOnErrorSampleRate: 1.0,
        replaysSessionSampleRate: 0.05,
    });

    try {
        const replayIntegration = await Sentry.lazyLoadIntegration('replayIntegration');
        Sentry.addIntegration(replayIntegration({ maskAllText: true, blockAllMedia: true }));
    } catch {
        // Blocked (an ad blocker) or offline. Errors still report; only the
        // replay alongside them is lost.
    }
}

// Not a top-level await: this module is part of `main-app`, and awaiting here
// would hold up hydration for the sake of error reporting.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) void startSentry(dsn);
