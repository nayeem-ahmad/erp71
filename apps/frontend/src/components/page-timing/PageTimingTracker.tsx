'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { pageTiming } from '@/lib/page-timing/collector';
import { createPageTimingReporter } from '@/lib/page-timing/reporter';
import { setPageTimingViewerIsStaff } from '@/lib/page-timing/viewer';

/**
 * Mounted once by the app shell. Tells the page timer which route is on screen
 * (the end of a route change's "route" phase) and sends finished views to the
 * dashboard — for every signed-in user, since the dashboard is about what real
 * users wait. Only platform staff see the numbers on the page.
 */
export default function PageTimingTracker({ isPlatformStaff }: { isPlatformStaff: boolean }) {
    const pathname = usePathname();

    useEffect(() => {
        const reporter = createPageTimingReporter((samples) => api.recordPageTimings(samples));
        pageTiming.setReporter(reporter.report);
        return () => {
            pageTiming.setReporter(null);
            reporter.stop();
        };
    }, []);

    useEffect(() => {
        if (pathname) pageTiming.routeCommitted(pathname);
    }, [pathname]);

    useEffect(() => {
        setPageTimingViewerIsStaff(isPlatformStaff);
    }, [isPlatformStaff]);

    return null;
}
