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
 * This is not hypothetical: as of 2026-07-28 the live platform layout's CRM
 * module contained only overview/leads/customers, so `crm.conversations`,
 * `crm.tasks`, `crm.campaigns` and `crm.custom-fields` had all shipped without
 * ever appearing in the sidebar.
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
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.lead-taxonomy --dry-run
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.lead-taxonomy
 *   npx tsx prisma/sync-nav-layout.ts --nodes=crm.tasks,crm.campaigns
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import {
    addNavNodesToLayout,
    validateNavLayout,
    type NavLayoutNode,
} from '@erp71/shared-types';

const prisma = new PrismaClient();

const NAVIGATION_GROUP = 'navigation';
const TENANT_LAYOUT_KEY = 'tenant_layout';

function parseLayout(raw: unknown): NavLayoutNode[] | null {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(value) ? (value as NavLayoutNode[]) : null;
    } catch {
        return null;
    }
}

/** Apply the merge and refuse to persist anything that would not load back. */
function merge(layout: NavLayoutNode[], nodeIds: string[], label: string) {
    const result = addNavNodesToLayout(layout, nodeIds);
    for (const s of result.skipped) {
        console.log(`    skipped ${s.id}: ${s.reason}`);
    }
    if (result.added.length === 0) return null;

    const validation = validateNavLayout(result.layout);
    if (validation.valid === false) {
        // A layout that fails validation is dropped by the resolver, which would
        // hide the ENTIRE sidebar — far worse than a missing menu item.
        console.error(`    !! ${label}: merge produced an invalid layout, skipping:`);
        for (const e of validation.errors) console.error(`       ${e}`);
        return null;
    }
    console.log(`    added ${result.added.join(', ')}`);
    return result.layout;
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

    let changed = 0;

    // --- platform-level tenant layout (what every tenant without an override gets)
    const setting = await prisma.platformSetting.findFirst({
        where: { group: NAVIGATION_GROUP, key: TENANT_LAYOUT_KEY },
    });
    if (!setting) {
        console.log('  platform tenant_layout: not set — tenants already fall back to the code default');
    } else {
        const layout = parseLayout(setting.value);
        if (!layout) {
            console.error('  platform tenant_layout: unparseable, leaving alone');
        } else {
            console.log('  platform tenant_layout:');
            const merged = merge(layout, nodeIds, 'platform tenant_layout');
            if (merged && !dryRun) {
                await prisma.platformSetting.update({
                    where: { id: setting.id },
                    data: { value: JSON.stringify(merged) },
                });
            }
            if (merged) changed++;
        }
    }

    // --- per-tenant overrides (layout === null means "pinned to default", skip)
    const overrides = await prisma.tenantNavLayout.findMany({
        include: { tenant: { select: { name: true } } },
    });
    for (const override of overrides) {
        if (override.layout === null) continue;
        const layout = parseLayout(override.layout);
        if (!layout) {
            console.error(`  tenant ${override.tenant.name}: unparseable layout, leaving alone`);
            continue;
        }
        console.log(`  tenant ${override.tenant.name}:`);
        const merged = merge(layout, nodeIds, override.tenant.name);
        if (merged && !dryRun) {
            await prisma.tenantNavLayout.update({
                where: { tenant_id: override.tenant_id },
                data: { layout: merged as any },
            });
        }
        if (merged) changed++;
    }

    console.log(
        changed === 0
            ? '\nNothing to do — every layout already has these nodes.'
            : `\n${dryRun ? 'Would update' : 'Updated'} ${changed} layout(s).`,
    );
    if (dryRun) console.log('DRY RUN — nothing was written.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
