'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

/**
 * Superseded by /crm/activities in R2, which merges what this page showed with
 * the other half of the same story. Kept as a redirect rather than deleted, for
 * the bookmarks and saved sidebar layouts that still point here — the same
 * treatment /sales/crm/tasks got when this page took over from it.
 */
export default function LegacyCrmFollowUpsRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace(routes.crm.activities);
    }, [router]);
    return null;
}
