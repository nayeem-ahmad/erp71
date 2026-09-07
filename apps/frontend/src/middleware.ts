import { NextResponse, type NextRequest } from 'next/server';
import { readDomainConfig, resolveHostRoute } from '@/lib/domain-routing';

/**
 * Host-based routing between the marketing site and the app.
 *
 * A thin adapter: every rule lives in `@/lib/domain-routing`, which is pure and
 * unit-tested. All this does is read the host, apply the verdict, and stay out
 * of the way when there is none — which is the case on every host that is not
 * one of the two configured domains, and on all of them until
 * `NEXT_PUBLIC_MARKETING_URL` is set.
 *
 * Redirect targets come from the configured origins rather than from
 * `request.nextUrl`: inside the standalone server that origin is the process's
 * own bind address (`0.0.0.0:3000`), not the host the browser asked for. The
 * rewrite is internal, so cloning `nextUrl` is safe there.
 */
export function middleware(request: NextRequest) {
    const hostname = request.headers.get('x-forwarded-host')
        ?? request.headers.get('host')
        ?? request.nextUrl.hostname;

    const route = resolveHostRoute(
        { hostname, pathname: request.nextUrl.pathname, search: request.nextUrl.search },
        readDomainConfig(),
    );

    if (route.kind === 'redirect') {
        return NextResponse.redirect(route.url, route.status);
    }

    if (route.kind === 'rewrite') {
        const url = request.nextUrl.clone();
        url.pathname = route.pathname;
        return NextResponse.rewrite(url);
    }

    return NextResponse.next();
}

export const config = {
    /*
     * Page requests only. `/api/v1/*` is rewritten to the backend by
     * next.config.js and must not be touched; `_next/*` and anything with a file
     * extension (including `/sitemap.xml`, `/robots.txt` and the RSS feed) are
     * assets and feeds that are correct on whichever host serves them.
     */
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
