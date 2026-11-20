'use client';

import { useEffect, useState } from 'react';
import type { ResolvedNavModule } from '@/lib/nav-resolver';
import { usePreferencesStore } from '@/lib/preferences/store';
import { currentPreferencesScopeKey } from '@/lib/preferences/scope';
import {
    currentNavHref,
    pushRecentHref,
    readRecentHrefs,
    resolveRecentNav,
    writeRecentHrefs,
    type NavLinkEntry,
} from '@/lib/recent-nav';

/**
 * The member's recently opened menu items for the sidebar's "Recent" section,
 * recording each page the nav covers as it is visited. Kept per member and per
 * workspace in this browser (keyed like their preferences), so a shared
 * counter PC never shows one cashier another's trail.
 *
 * With `enabled` false — the workspace switched Recent off — nothing is
 * recorded and nothing is returned.
 */
export function useRecentNavItems(
    modules: readonly ResolvedNavModule[],
    pathname: string,
    enabled: boolean,
): NavLinkEntry[] {
    const currentHref = currentNavHref(modules, pathname);
    // Changes when the signed-in member or the workspace does, which is when the list must be re-read.
    const prefsScopeKey = usePreferencesStore((state) => state.scopeKey);
    const [recent, setRecent] = useState<{ scope: string | null; hrefs: readonly string[] }>({ scope: null, hrefs: [] });

    useEffect(() => {
        if (!enabled) return;
        const scope = currentPreferencesScopeKey();
        setRecent((prev) => {
            const base = prev.scope === scope && scope !== null ? prev.hrefs : readRecentHrefs(scope);
            const hrefs = currentHref ? pushRecentHref(base, currentHref) : base;
            if (prev.scope === scope && prev.hrefs === hrefs) return prev;
            return { scope, hrefs };
        });
    }, [enabled, currentHref, pathname, prefsScopeKey]);

    // Saved outside the updater, which React may call twice.
    useEffect(() => {
        if (enabled) writeRecentHrefs(recent.scope, recent.hrefs);
    }, [enabled, recent]);

    if (!enabled) return [];
    return resolveRecentNav(recent.hrefs, modules, currentHref);
}
