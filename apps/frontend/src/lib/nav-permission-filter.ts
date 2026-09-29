import type { ResolvedNavChild, ResolvedNavLink, ResolvedNavModule } from './nav-resolver';

export interface NavViewer {
    /** The workspace owner sees every entry, whatever they hold. */
    isOwner: boolean;
    permissions: readonly string[];
}

/**
 * Whether the viewer clears a node's own tag. A node with no tag is open, and
 * so is one whose tag is empty — an empty list must never mean "nobody".
 */
function clears(node: { permissions?: readonly string[] }, held: ReadonlySet<string>): boolean {
    if (!node.permissions || node.permissions.length === 0) return true;
    return node.permissions.some((permission) => held.has(permission));
}

/**
 * Drops the nav entries a member holds no permission for.
 *
 * A tag on a module or subgroup covers everything under it, so a tagged parent
 * that the viewer does not clear takes its children with it. A subgroup or module
 * that ends up with nothing left is dropped too rather than rendered as an empty
 * heading; a module that never had children (Dashboard, Chat) is kept when its
 * own tag clears.
 *
 * This is presentation only — the API enforces access itself. It exists so a
 * member is not offered pages that can only refuse them.
 */
export function filterNavByPermissions(
    modules: ResolvedNavModule[],
    viewer: NavViewer,
): ResolvedNavModule[] {
    if (viewer.isOwner) return modules;
    const held = new Set(viewer.permissions);

    const result: ResolvedNavModule[] = [];
    for (const navModule of modules) {
        if (!clears(navModule, held)) continue;
        if (!navModule.children) {
            result.push(navModule);
            continue;
        }

        const children: ResolvedNavChild[] = [];
        for (const child of navModule.children) {
            if (!clears(child, held)) continue;
            if ('type' in child) {
                const links = child.children.filter((link: ResolvedNavLink) => clears(link, held));
                if (links.length > 0) children.push({ ...child, children: links });
                continue;
            }
            children.push(child);
        }

        // A module that started with children and lost them all has nothing to
        // show; the sidebar would otherwise draw an empty, unclickable heading.
        if (children.length > 0 || navModule.children.length === 0) {
            result.push({ ...navModule, children });
        }
    }
    return result;
}
