import type { ResolvedNavChild, ResolvedNavModule } from '@/lib/nav-resolver';

function isNavSubgroup(
    child: ResolvedNavChild,
): child is Extract<ResolvedNavChild, { type: 'subgroup' }> {
    return 'type' in child && child.type === 'subgroup';
}

export function normalizeNavSearchQuery(query: string): string {
    return query.trim().toLowerCase();
}

function labelMatches(label: string, query: string): boolean {
    return label.toLowerCase().includes(query);
}

export function filterNavChildren(children: ResolvedNavChild[], query: string): ResolvedNavChild[] {
    if (!query) return children;

    const result: ResolvedNavChild[] = [];

    for (const child of children) {
        if (isNavSubgroup(child)) {
            const subgroupMatches = labelMatches(child.label, query);
            const filteredLinks = subgroupMatches
                ? child.children
                : child.children.filter((link) => labelMatches(link.label, query));

            if (filteredLinks.length > 0) {
                result.push({ ...child, children: filteredLinks });
            }
            continue;
        }

        if (child.section) continue;

        if (labelMatches(child.label, query)) {
            result.push(child);
        }
    }

    return result;
}

export function filterNavModules(modules: ResolvedNavModule[], rawQuery: string): ResolvedNavModule[] {
    const query = normalizeNavSearchQuery(rawQuery);
    if (!query) return modules;

    return modules
        .map((mod) => {
            const moduleMatches = labelMatches(mod.label, query);

            if (mod.href || mod.soon) {
                return moduleMatches ? mod : null;
            }

            if (!mod.children?.length) return null;

            const children = moduleMatches
                ? mod.children.filter((child) => !('section' in child && child.section))
                : filterNavChildren(mod.children, query);

            if (children.length === 0) return null;

            return { ...mod, children };
        })
        .filter((mod): mod is ResolvedNavModule => mod !== null);
}

export function collectNavGroupKeys(modules: ResolvedNavModule[]): string[] {
    const keys: string[] = [];

    for (const mod of modules) {
        if (!mod.children?.length || mod.href || mod.soon) continue;

        keys.push(mod.key);

        for (const child of mod.children) {
            if (isNavSubgroup(child)) {
                keys.push(`${mod.key}:${child.key}`);
            }
        }
    }

    return keys;
}

export function buildOpenGroupsState(keys: string[], open: boolean): Record<string, boolean> {
    return Object.fromEntries(keys.map((key) => [key, open]));
}