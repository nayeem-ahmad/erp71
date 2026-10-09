import type { LucideIcon } from 'lucide-react';
import { APP_REGISTRY } from '@erp71/shared-types';
import type { ResolvedNavChild, ResolvedNavModule } from '@/lib/nav-resolver';
import { isNavSubgroup } from '@/lib/sidebar-modules';
import { routes } from '@/lib/routes';

/** One icon on the rail: an app, or a group of single-page utilities (Help). */
export interface RailEntry {
    key: string;
    label: string;
    icon: LucideIcon;
    /** The nav modules this entry stands for — one, except for a group. */
    modules: ResolvedNavModule[];
}

/** Utilities in rail order; Settings last, the way a rail ends with its gear. */
const UTILITY_ORDER = ['chat', 'help', 'account-settings', 'admin'];

function stripQuery(href: string): string {
    const at = href.indexOf('?');
    return at === -1 ? href : href.slice(0, at);
}

function moduleHrefs(module: ResolvedNavModule): string[] {
    if (module.href) return [stripQuery(module.href)];
    return (module.children ?? []).flatMap((child) => {
        if (isNavSubgroup(child)) return child.children.map((link) => stripQuery(link.href));
        return child.section ? [] : [stripQuery(child.href)];
    });
}

/**
 * The app a page belongs to: the module whose link is the longest prefix of
 * the path. A link's `exact` flag is ignored here on purpose — `/sales` is the
 * Sales overview's own href, and a sale's detail page still belongs to Sales.
 * Home and pages no app owns (profile, notifications) give `null`.
 */
export function findActiveAppKey(modules: ResolvedNavModule[], pathname: string): string | null {
    if (pathname === routes.home) return null;
    let best: { key: string; length: number } | null = null;
    for (const navModule of modules) {
        if (navModule.key === 'dashboard') continue;
        for (const href of moduleHrefs(navModule)) {
            if (!href || href === '/') continue;
            const owns = pathname === href || pathname.startsWith(`${href}/`);
            if (owns && (!best || href.length > best.length)) best = { key: navModule.key, length: href.length };
        }
    }
    return best?.key ?? null;
}

function firstLink(children: ResolvedNavChild[]): string | null {
    for (const child of children) {
        if (isNavSubgroup(child)) {
            if (child.children.length > 0) return child.children[0].href;
            continue;
        }
        if (!child.section) return child.href;
    }
    return null;
}

/** Where opening an app lands: the module's own page, or its first link. */
export function appHomeHref(module: ResolvedNavModule): string | null {
    return module.href ?? firstLink(module.children ?? []);
}

/**
 * The rail's two stacks. Business apps keep the nav layout's order (so the
 * platform's nav editor still orders them); utilities take a fixed order, and
 * modules sharing a `railGroup` fold into one entry named `groupLabel` — or by
 * their own name when only one of them is present.
 */
export function buildRail(modules: ResolvedNavModule[], groupLabel: string): { business: RailEntry[]; utility: RailEntry[] } {
    const business: RailEntry[] = [];
    const groups = new Map<string, ResolvedNavModule[]>();
    const singles = new Map<string, ResolvedNavModule>();

    for (const navModule of modules) {
        if (navModule.key === 'dashboard') continue;
        const app = APP_REGISTRY[navModule.key];
        if (!app || app.kind === 'business') {
            business.push({ key: navModule.key, label: navModule.label, icon: navModule.icon, modules: [navModule] });
            continue;
        }
        if (app.railGroup) {
            groups.set(app.railGroup, [...(groups.get(app.railGroup) ?? []), navModule]);
        } else {
            singles.set(navModule.key, navModule);
        }
    }

    const registryOrder = Object.keys(APP_REGISTRY);
    // A utility the fixed order does not name still gets a place — after the
    // named ones and before Settings — rather than silently missing the rail.
    const unnamed = [...singles.keys(), ...groups.keys()]
        .filter((key) => !UTILITY_ORDER.includes(key))
        .sort((a, b) => registryOrder.indexOf(a) - registryOrder.indexOf(b));
    const settingsAt = UTILITY_ORDER.indexOf('account-settings');
    const order = [...UTILITY_ORDER.slice(0, settingsAt), ...unnamed, ...UTILITY_ORDER.slice(settingsAt)];

    const utility: RailEntry[] = [];
    for (const key of order) {
        const single = singles.get(key);
        if (single) {
            utility.push({ key, label: single.label, icon: single.icon, modules: [single] });
            continue;
        }
        const members = groups.get(key);
        if (!members?.length) continue;
        const ordered = [...members].sort((a, b) => registryOrder.indexOf(a.key) - registryOrder.indexOf(b.key));
        utility.push({
            key,
            label: ordered.length === 1 ? ordered[0].label : groupLabel,
            icon: ordered[0].icon,
            modules: ordered,
        });
    }

    return { business, utility };
}

/** The rail entry a module belongs to — its group's key, or its own. */
export function railKeyFor(moduleKey: string): string {
    return APP_REGISTRY[moduleKey]?.railGroup ?? moduleKey;
}
