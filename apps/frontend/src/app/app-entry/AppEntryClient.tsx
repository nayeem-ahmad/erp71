'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { routes } from '@/lib/routes';
import { getAccessToken } from '@/lib/session-store';

/**
 * Resolve "is anyone signed in on this browser?" and continue.
 *
 * It has to happen here rather than in the middleware: the session is an access
 * token in `sessionStorage`/`localStorage`, which the server never receives.
 *
 * Signed in → the dashboard, which is also where the account chooser comes
 * from: the app shell redirects to `/select-account` when the identity has more
 * than one workspace and this tab has not resumed one. Sending everyone to
 * `/select-account` instead would put a chooser in front of the majority who
 * only ever have one shop.
 *
 * Signed out → the login page, which honours `?redirect=` on the way back in.
 *
 * A stale token needs no special case: the app shell's first authenticated
 * request 401s, and `session-expiry` clears the session and lands on `/login`.
 */
export default function AppEntryClient() {
    const router = useRouter();

    useEffect(() => {
        router.replace(getAccessToken() ? routes.home : '/login');
    }, [router]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas" aria-busy="true">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" aria-hidden />
            <span className="sr-only">Loading…</span>
        </div>
    );
}
