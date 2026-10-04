import { todayInTenantZone } from '@/lib/dashboard-range';
import { workspaceScope } from '@/lib/query-client';

/**
 * Cache key for one dashboard panel.
 *
 * Scoped to the workspace (tenant and branch), so one shop's figures can never
 * answer for another's out of the cache, and to the workspace's calendar day, so
 * "today" kept in memory across midnight is asked for again rather than shown
 * as if it were still today. The range windows themselves are computed when the
 * request is made, not put in the key: their `to` is "now", which would make a
 * new key on every render.
 */
export function dashboardQueryKey(...parts: readonly unknown[]): unknown[] {
    return ['dashboard', ...workspaceScope(), todayInTenantZone(), ...parts];
}
