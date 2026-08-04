/**
 * Adds newly-registered navigation nodes to layouts that were saved before those
 * nodes existed.
 *
 * Why this is needed
 * -----------------
 * `NavigationService.resolveTenantSidebarLayout` returns a saved layout
 * **verbatim** — it never merges `NAV_REGISTRY` into it. So once an admin has
 * customised the sidebar (or a platform-level `tenant_layout` has been saved),
 * every nav entry added in code afterwards is invisible in production while
 * looking perfectly correct in the repo. There is no error and no log line; the
 * menu item simply is not there.
 *
 * There is one escape hatch that happens to be load-bearing today:
 * `parseNavLayoutJson` falls back to the code default when a saved layout fails
 * `validateNavLayout`. As of 2026-07-28 the live platform `tenant_layout` is
 * invalid — it still references `accounting.transactions*` and `admin.tenants`,
 * which were removed from NAV_REGISTRY — so production is already serving the
 * code default and every registry addition does appear. That is luck, not
 * design: the moment someone saves a valid layout through the nav admin, this
 * script becomes the only way a new entry reaches the sidebar.
 *
 * Deliberately NOT run on boot
 * ----------------------------
 * Hiding a node is `visible: false`, not omission, so absence normally means
 * "postdates this layout" — but nothing structurally prevents a layout from
 * dropping a node outright, and a boot-time "append everything missing" would
 * silently override that. Node ids are passed explicitly so each addition is a
 * deliberate call, and re-running is a no-op.
 *
 * Usage:
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.setup --dry-run
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.setup
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.follow-ups,crm.campaigns
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import {
    addNavNodesToLayout,
    validateNavLayout,
    DEFAULT_TENANT_NAV_LAYOUT,
    DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
    NAV_LAYOUT_SETTING_KEYS,
    NAV_REGISTRY,
    NavScope,
    type NavLayoutNode,
} from '@erp71/shared-types';

const prisma = new PrismaClient();

const NAVIGATION_GROUP = 'navigation';
// Taken from the shared constant rather than re-typed, so a key rename cannot
// leave this script silently looking up a setting that no longer exists.
const TENANT_LAYOUT_KEY = NAV_LAYOUT_SETTING_KEYS[NavScope.TENANT];
const PLATFORM_ADMIN_LAYOUT_KEY = NAV_LAYOUT_SETTING_KEYS[NavScope.PLATFORM_ADMIN];

function parseLayout(raw: unknown): NavLayoutNode[] | null {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(value) ? (value as NavLayoutNode[]) : null;
    } catch {
        return null;
    }
}

/** Apply the merge and refuse to persist anything that would not load back. */
function merge(
    layout: NavLayoutNode[],
    nodeIds: string[],
    label: string,
    defaults: NavLayoutNode[] = DEFAULT_TENANT_NAV_LAYOUT,
): { layout: NavLayoutNode[] } | { refused: true } | null {
    const result = addNavNodesToLayout(layout, nodeIds, NAV_REGISTRY, defaults);
    for (const s of result.skipped) {
        console.log(`    skipped ${s.id}: ${s.reason}`);
    }
    if (result.added.length === 0) return null;

    const validation = validateNavLayout(result.layout);
    if (validation.valid === false) {
        // Refuse rather than persist. A layout that fails validation is silently
        // replaced by the code default at read time, so writing one back would
        // discard the customisation without saying so. Note the errors below may
        // predate this run entirely — a layout can already be stale against the
        // current registry, in which case it is inert and nothing needs adding.
        console.error(`    !! ${label}: refusing to write — the merged layout is invalid:`);
        for (const e of validation.errors) console.error(`       ${e}`);
        return { refused: true };
    }
    console.log(`    added ${result.added.join(', ')}`);
    return { layout: result.layout };
}

type Tally = { changed: number; refused: number };

/** The layout every tenant without an override is served. */
async function syncPlatformLayout(nodeIds: string[], dryRun: boolean): Promise<Tally> {
    const setting = await prisma.platformSetting.findFirst({
        where: { group: NAVIGATION_GROUP, key: TENANT_LAYOUT_KEY },
    });
    if (!setting) {
        console.log('  platform tenant_layout: not set — tenants already fall back to the code default');
        return { changed: 0, refused: 0 };
    }

    const layout = parseLayout(setting.value);
    if (!layout) {
        console.error('  platform tenant_layout: unparseable, leaving alone');
        return { changed: 0, refused: 0 };
    }

    console.log('  platform tenant_layout:');
    const merged = merge(layout, nodeIds, 'platform tenant_layout');
    if (!merged) return { changed: 0, refused: 0 };
    if ('refused' in merged) return { changed: 0, refused: 1 };

    if (!dryRun) {
        await prisma.platformSetting.update({
            where: { id: setting.id },
            data: { value: JSON.stringify(merged.layout) },
        });
    }
    return { changed: 1, refused: 0 };
}

/** Per-tenant overrides. A null layout means "pinned to default" and is skipped. */
async function syncTenantOverrides(nodeIds: string[], dryRun: boolean): Promise<Tally> {
    const overrides = await prisma.tenantNavLayout.findMany({
        include: { tenant: { select: { name: true } } },
    });

    const tally: Tally = { changed: 0, refused: 0 };
    for (const override of overrides) {
        // Note this is `null` for a JSON `null` literal too, not just SQL NULL —
        // which is what NavigationService treats as "pinned to default".
        if (override.layout === null) continue;

        const layout = parseLayout(override.layout);
        if (!layout) {
            console.error(`  tenant ${override.tenant.name}: unparseable layout, leaving alone`);
            continue;
        }

        console.log(`  tenant ${override.tenant.name}:`);
        const merged = merge(layout, nodeIds, override.tenant.name);
        if (!merged) continue;
        if ('refused' in merged) {
            tally.refused++;
            continue;
        }

        if (!dryRun) {
            await prisma.tenantNavLayout.update({
                where: { tenant_id: override.tenant_id },
                data: { layout: merged.layout as any },
            });
        }
        tally.changed++;
    }
    return tally;
}

/**
 * The platform-admin sidebar. Saved only if someone has customised it through the
 * nav admin; absent means admins are already served the code default. Its nodes
 * come from a different default layout, so the merge has to be told which one —
 * passing the tenant defaults would skip every admin node as "not in the default
 * layout".
 */
async function syncPlatformAdminLayout(nodeIds: string[], dryRun: boolean): Promise<Tally> {
    const setting = await prisma.platformSetting.findFirst({
        where: { group: NAVIGATION_GROUP, key: PLATFORM_ADMIN_LAYOUT_KEY },
    });
    if (!setting) {
        console.log('  platform_admin_layout: not set — admins already fall back to the code default');
        return { changed: 0, refused: 0 };
    }

    const layout = parseLayout(setting.value);
    if (!layout) {
        console.error('  platform_admin_layout: unparseable, leaving alone');
        return { changed: 0, refused: 0 };
    }

    console.log('  platform_admin_layout:');
    const merged = merge(layout, nodeIds, 'platform_admin_layout', DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT);
    if (!merged) return { changed: 0, refused: 0 };
    if ('refused' in merged) return { changed: 0, refused: 1 };

    if (!dryRun) {
        await prisma.platformSetting.update({
            where: { id: setting.id },
            data: { value: JSON.stringify(merged.layout) },
        });
    }
    return { changed: 1, refused: 0 };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const nodesArg = process.argv.find((a) => a.startsWith('--nodes='))?.split('=')[1];
    if (!nodesArg) {
        console.error('Usage: sync-nav-layout.ts --nodes=<id>[,<id>...] [--dry-run]');
        process.exit(1);
    }
    const nodeIds = nodesArg.split(',').map((s) => s.trim()).filter(Boolean);

    console.log(
        `Sync nav layout (${dryRun ? 'DRY RUN' : 'LIVE'}) — adding: ${nodeIds.join(', ')}`,
    );

    const platform = await syncPlatformLayout(nodeIds, dryRun);
    const platformAdmin = await syncPlatformAdminLayout(nodeIds, dryRun);
    const tenants = await syncTenantOverrides(nodeIds, dryRun);
    const changed = platform.changed + platformAdmin.changed + tenants.changed;
    const refused = platform.refused + platformAdmin.refused + tenants.refused;

    if (changed > 0) {
        console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${changed} layout(s).`);
    } else if (refused > 0) {
        console.log(`\nNothing written — ${refused} layout(s) refused (see errors above).`);
    } else {
        console.log('\nNothing to do — every layout already has these nodes.');
    }
    if (refused > 0) {
        // A layout that is already stale against the registry is inert: the
        // resolver silently serves the code default instead, so the new node is
        // already reaching users and there is nothing to fix here.
        console.log(
            'A layout that fails validation is replaced by the code default at read time, ' +
            'so those tenants already see every registered nav entry.',
        );
    }
    if (dryRun) console.log('DRY RUN — nothing was written.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
