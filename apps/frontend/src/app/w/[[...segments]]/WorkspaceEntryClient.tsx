'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { applyTenantContext } from '@/lib/auth-session';
import { routes } from '@/lib/routes';
import { getAccessToken } from '@/lib/session-store';
import { parseWorkspaceEntryPath, resolveWorkspaceSlug } from '@/lib/workspace-slug';

/**
 * Turn `/w/<workspace>/<page>` into "that page, in that workspace".
 *
 * It runs in the browser for the same reason `/app-entry` does: the session is
 * an access token in web storage, which the server never receives, so no amount
 * of middleware can tell whether this visitor is signed in — let alone which
 * shops they belong to.
 *
 * Three outcomes, and every one of them ends somewhere useful:
 *
 *  - **Signed out** → `/login`, carrying the workspace and the destination, so
 *    the shop is entered the moment the credentials land.
 *  - **Signed in, slug resolves** → straight into that workspace.
 *  - **Signed in, slug resolves to nothing** (a renamed shop, a link from a
 *    colleague whose shops are not yours, a typo) → the chooser, which says so
 *    rather than failing silently.
 */
function WorkspaceEntryContent() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    useEffect(() => {
        const query = searchParams.toString();
        const { slug, redirect } = parseWorkspaceEntryPath(pathname, routes.home);
        // A query string on the entry URL belongs to the page being opened —
        // `/w/karim-store/sales?status=DUE` is a filtered sales list, not a
        // parameter of the workspace lookup.
        const destination = query ? `${redirect}?${query}` : redirect;

        // `/w` with nothing after it names no workspace, so it is just the app's
        // front door with extra steps.
        if (!slug) {
            router.replace(getAccessToken() ? destination : signInAt(null, destination));
            return;
        }

        if (!getAccessToken()) {
            router.replace(signInAt(slug, destination));
            return;
        }

        api.getMe()
            .then((me: { tenants?: unknown[] }) => {
                const match = resolveWorkspaceSlug((me?.tenants ?? []) as { id: string }[], slug);
                if (match.status === 'matched') {
                    applyTenantContext(match.tenant);
                    router.replace(destination);
                    return;
                }
                // Hand the slug to the chooser rather than dropping it: it
                // re-resolves it against the same list and explains the miss.
                router.replace(chooseAt(slug, destination));
            })
            // A stale token: `session-expiry` is already clearing it on the 401,
            // so signing in again is the whole recovery.
            .catch(() => router.replace(signInAt(slug, destination)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas" aria-busy="true">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" aria-hidden />
            <span className="sr-only">Opening workspace…</span>
        </div>
    );
}

/** `/login`, told which workspace to enter and where to go once it has. */
function signInAt(slug: string | null, destination: string): string {
    return withWorkspace('/login', slug, destination);
}

/** `/select-account`, told the same two things. */
function chooseAt(slug: string | null, destination: string): string {
    return withWorkspace(routes.selectAccount, slug, destination);
}

function withWorkspace(base: string, slug: string | null, destination: string): string {
    const params = new URLSearchParams();
    if (slug) params.set('workspace', slug);
    if (destination !== routes.home) params.set('redirect', destination);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
}

export default function WorkspaceEntryClient() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-canvas" aria-busy="true">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" aria-hidden />
                </div>
            }
        >
            <WorkspaceEntryContent />
        </Suspense>
    );
}
