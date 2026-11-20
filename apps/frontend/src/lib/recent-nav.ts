import type { LucideIcon } from 'lucide-react';
import { collectNavLinkTargets, isNavLinkActive } from '@/lib/app-shell';
import type { ResolvedNavModule } from '@/lib/nav-resolver';
import { isNavSubgroup } from '@/lib/sidebar-modules';

/**
 * The sidebar's "Recent" list: the menu items a member opened last, newest
 * first. Only hrefs are remembered; labels and icons are looked up in the nav
 * as it stands on each render, so a language switch relabels them and a link
 * the member can no longer see (permission, plan, hidden app) drops out
 * rather than leading to a 403.
 */

/** How many hrefs are kept. More than are shown, so a few going out of reach does not empty the list. */
export const RECENT_NAV_KEEP = 10;
/** How many are shown. */
export const RECENT_NAV_SHOW = 5;

const STORAGE_PREFIX = 'erp71:nav-recent:';
const OPEN_KEY = 'erp71:nav-recent-open';
/** An absolute URL belongs to another site (Meet71); the pathname never lands on it. */
const EXTERNAL_HREF = /^https?:\/\//i;

export interface NavLinkEntry {
    href: string;
    exact?: boolean;
    label: string;
    icon: LucideIcon;
    /** The module (app) it lives in, shown beside the label so "Reports" is not ambiguous. */
    moduleLabel: string;
}

/** Every link the nav shows, in nav order, with what it takes to draw it. */
export function flattenNavLinks(modules: readonly ResolvedNavModule[]): NavLinkEntry[] {
    const links: NavLinkEntry[] = [];
    const push = (link: Omit<NavLinkEntry, 'moduleLabel'>, moduleLabel: string) => {
        if (EXTERNAL_HREF.test(link.href)) return;
        links.push({ ...link, moduleLabel });
    };
    for (const navModule of modules) {
        if (navModule.soon) continue;
        if (navModule.href) {
            push({ href: navModule.href, label: navModule.label, icon: navModule.icon }, navModule.label);
        }
        for (const child of navModule.children ?? []) {
            if (isNavSubgroup(child)) {
                for (const link of child.children) {
                    push({ href: link.href, exact: link.exact, label: link.label, icon: link.icon }, navModule.label);
                }
            } else if (!child.section) {
                push({ href: child.href, exact: child.exact, label: child.label, icon: child.icon }, navModule.label);
            }
        }
    }
    return links;
}

/**
 * The menu item the page belongs to — the one the nav lights — or null for a
 * page no menu item covers (profile, notifications, a record nobody linked).
 */
export function currentNavHref(modules: readonly ResolvedNavModule[], pathname: string): string | null {
    const targets = collectNavLinkTargets(modules as ResolvedNavModule[]);
    const hit = flattenNavLinks(modules).find((link) => isNavLinkActive(link.href, pathname, targets, link.exact));
    return hit?.href ?? null;
}

/** `href` moved to the front, duplicates dropped, trimmed to `keep`. Returns `list` itself when nothing changes. */
export function pushRecentHref(list: readonly string[], href: string, keep = RECENT_NAV_KEEP): readonly string[] {
    if (list[0] === href) return list;
    return [href, ...list.filter((item) => item !== href)].slice(0, keep);
}

/**
 * The entries to draw: the remembered hrefs the nav still holds, the page
 * you are on left out (you are already there), at most `show`.
 */
export function resolveRecentNav(
    hrefs: readonly string[],
    modules: readonly ResolvedNavModule[],
    currentHref: string | null,
    show = RECENT_NAV_SHOW,
): NavLinkEntry[] {
    const byHref = new Map<string, NavLinkEntry>();
    for (const link of flattenNavLinks(modules)) {
        if (!byHref.has(link.href)) byHref.set(link.href, link);
    }
    const out: NavLinkEntry[] = [];
    for (const href of hrefs) {
        if (href === currentHref) continue;
        const link = byHref.get(href);
        if (link) out.push(link);
        if (out.length >= show) break;
    }
    return out;
}

/* ---- Storage: per member, per workspace, in this browser ---- */

export function readRecentHrefs(scopeKey: string | null): string[] {
    if (!scopeKey) return [];
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + scopeKey) ?? '[]');
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_NAV_KEEP)
            : [];
    } catch {
        return [];
    }
}

export function writeRecentHrefs(scopeKey: string | null, hrefs: readonly string[]) {
    if (!scopeKey) return;
    try {
        localStorage.setItem(STORAGE_PREFIX + scopeKey, JSON.stringify(hrefs));
    } catch {
        /* private mode or storage full — the list just does not survive a reload */
    }
}

/** Whether the member left the Recent section open. Open unless they folded it. */
export function readRecentOpen(): boolean {
    try {
        return localStorage.getItem(OPEN_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function writeRecentOpen(open: boolean) {
    try {
        localStorage.setItem(OPEN_KEY, String(open));
    } catch {
        /* ignore */
    }
}
