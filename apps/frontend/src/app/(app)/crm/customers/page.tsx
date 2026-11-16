'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

/**
 * A read-only slice of /sales/customers — same records, fewer columns, no
 * writes. Merged into that page so there is one customer list, with the one
 * field this view owned (`last_contacted_at`) now a column there. Kept as a
 * redirect rather than deleted, for the bookmarks and saved sidebar layouts
 * that still point here — the same treatment /crm/conversations got.
 */
export default function LegacyCrmCustomersRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace(routes.sales.customers);
    }, [router]);
    return null;
}
