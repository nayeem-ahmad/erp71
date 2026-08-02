/**
 * Resolved once by the dashboard page and handed to whichever variant renders,
 * so the two dashboards never each fetch `/auth/me` for the same three strings.
 */
export type DashboardIdentity = {
    greeting: string;
    tenantName: string;
    /** ISO date of the subscription period end, or null when there is no subscription. */
    renewalEnd: string | null;
};
