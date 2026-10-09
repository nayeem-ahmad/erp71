import type { ReactNode } from 'react';

/**
 * Resolved once by the dashboard page and handed to whichever variant renders,
 * so the two dashboards never each fetch `/auth/me` for the same three strings.
 */
export type DashboardIdentity = {
    /**
     * Home's app tiles (app shell on), drawn under the greeting header. A
     * module's own overview page never passes it.
     */
    homeSlot?: ReactNode;
    greeting: string;
    tenantName: string;
    /** ISO date of the subscription period end, or null when there is no subscription. */
    renewalEnd: string | null;
};
