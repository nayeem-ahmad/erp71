'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getCareersToken } from '@/lib/careers-api';
import { routes } from '@/lib/routes';

/**
 * Client-side gate for the portal pages.
 *
 * Purely an affordance — it saves a signed-out visitor a wasted 401 and sends
 * them somewhere useful. Every portal endpoint is guarded server-side by
 * `CareersJwtGuard` + `ApplicantGuard`, so nothing here is load-bearing for
 * access control.
 *
 * Returns `false` until the token has been checked, so a page can hold its
 * render rather than flashing empty state before the redirect lands.
 */
export function useRequireApplicant(): boolean {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (getCareersToken()) {
            setReady(true);
            return;
        }
        router.replace(`${routes.careers.login}?redirect=${encodeURIComponent(pathname || routes.careers.portal)}`);
    }, [router, pathname]);

    return ready;
}
