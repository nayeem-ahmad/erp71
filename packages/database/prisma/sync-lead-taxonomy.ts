/**
 * Brings every existing tenant's CRM lookup lists — lead sources, lead
 * categories and conversation channels — up to the current defaults, and
 * backfills `Lead.source_id` / `Lead.category_id` from the legacy enum columns
 * plus `LeadConversation.channel_id` from the code held in `type`.
 *
 * Why this exists
 * ---------------
 * `seedDefaultLeadTaxonomy` runs ONLY at tenant creation (`auth.service.ts`,
 * `admin-tenants.service.ts`). Every tenant that predates the lead-taxonomy
 * tables has zero rows, so their leads have no `source_id` and the CRM settings
 * screen would show an empty list. This script is what carries the defaults to
 * them — same role `sync-accounting.ts` plays for the chart of accounts.
 *
 * It is additive-only and idempotent, so it is safe to run on every deploy, and
 * it sits in the container start chain for exactly that reason.
 *
 * Ordering matters
 * ----------------
 * 1. seed defaults        — so the common codes exist
 * 2. reconcile in-use     — create a row for any legacy enum value actually
 *                           present on a lead that step 1 did not cover (a
 *                           tenant that deleted a default, say)
 * 3. backfill             — join leads onto options by `code`
 * 4. verify               — report residual unbackfilled rows LOUDLY
 *
 * Step 2 is what makes step 4 meaningful. Without it the backfill would have to
 * bucket unmatched leads into OTHER, which destroys the provenance signal and
 * hides the exact condition the contract release must check for.
 *
 * Survives the contract release
 * -----------------------------
 * Once `Lead.source` / `Lead.category` are dropped, steps 2-4 have nothing to
 * read. They are guarded on `information_schema` rather than assumed present, so
 * this script degrades to "seed defaults only" instead of erroring. That matters
 * because it runs inside the `&&` chain in apps/backend/Dockerfile — an error
 * here means the backend never boots.
 *
 * Usage:
 *   npx tsx prisma/sync-lead-taxonomy.ts --dry-run
 *   npx tsx prisma/sync-lead-taxonomy.ts --tenant=<uuid>
 *   npx tsx prisma/sync-lead-taxonomy.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import {
    DEFAULT_ACTIVITY_PURPOSES,
    DEFAULT_CONVERSATION_CHANNELS,
    DEFAULT_LEAD_CATEGORIES,
    DEFAULT_LEAD_SOURCES,
    FALLBACK_SOURCE_CODE,
} from './lead-taxonomy.seed';

const prisma = new PrismaClient();

/**
 * Prisma's 5s interactive-transaction default is not enough for a first-run
 * backfill over a large Lead table, and a timeout here would fail the container
 * start chain.
 */
const TX_OPTS = { maxWait: 15_000, timeout: 120_000 } as const;

type Delta = {
    tenantId: string;
    tenantName: string;
    sourcesCreated: string[];
    categoriesCreated: string[];
    channelsCreated: string[];
    purposesCreated: string[];
    leadsSourceBackfilled: number;
    leadsCategoryBackfilled: number;
    conversationsChannelBackfilled: number;
    unresolvedSources: number;
    unresolvedCategories: number;
    unresolvedChannels: number;
};

/** Thrown to abort the dry-run transaction. Never escapes previewTenant. */
class Rollback extends Error {}

/**
 * True when the legacy enum column is still present. False after the contract
 * release drops it, which turns the backfill steps into no-ops rather than
 * errors — this script gates the backend's boot.
 */
async function legacyColumnExists(column: 'source' | 'category'): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'Lead'
              AND column_name = ${column}
        ) AS "exists"
    `;
    return rows[0]?.exists === true;
}

async function loadTenants(tenantId?: string) {
    if (tenantId) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true },
        });
        if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
        return [tenant];
    }
    return prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

async function syncTenant(
    tx: any,
    tenantId: string,
    tenantName: string,
    hasSource: boolean,
    hasCategory: boolean,
): Promise<Delta> {
    const delta: Delta = {
        tenantId,
        tenantName,
        sourcesCreated: [],
        categoriesCreated: [],
        channelsCreated: [],
        purposesCreated: [],
        leadsSourceBackfilled: 0,
        leadsCategoryBackfilled: 0,
        conversationsChannelBackfilled: 0,
        unresolvedSources: 0,
        unresolvedCategories: 0,
        unresolvedChannels: 0,
    };

    // --- 1. Seed the shipped defaults -------------------------------------
    const existingSources = await tx.leadSourceOption.findMany({
        where: { tenant_id: tenantId },
        select: { code: true },
    });
    const haveSource = new Set(existingSources.map((s: { code: string }) => s.code));
    const missingSources = DEFAULT_LEAD_SOURCES.filter((s) => !haveSource.has(s.code));
    if (missingSources.length) {
        await tx.leadSourceOption.createMany({
            data: missingSources.map((s) => ({
                tenant_id: tenantId,
                code: s.code,
                name: s.name,
                score_weight: s.score_weight,
                sort_order: s.sort_order,
                is_system: true,
                is_active: true,
            })),
            skipDuplicates: true,
        });
        delta.sourcesCreated.push(...missingSources.map((s) => s.code));
        missingSources.forEach((s) => haveSource.add(s.code));
    }

    const existingCategories = await tx.leadCategoryOption.findMany({
        where: { tenant_id: tenantId },
        select: { code: true },
    });
    const haveCategory = new Set(existingCategories.map((c: { code: string }) => c.code));
    const missingCategories = DEFAULT_LEAD_CATEGORIES.filter((c) => !haveCategory.has(c.code));
    if (missingCategories.length) {
        await tx.leadCategoryOption.createMany({
            data: missingCategories.map((c) => ({
                tenant_id: tenantId,
                code: c.code,
                name: c.name,
                sort_order: c.sort_order,
                is_system: true,
                is_active: true,
            })),
            skipDuplicates: true,
        });
        delta.categoriesCreated.push(...missingCategories.map((c) => c.code));
        missingCategories.forEach((c) => haveCategory.add(c.code));
    }

    const existingChannels = await tx.conversationChannel.findMany({
        where: { tenant_id: tenantId },
        select: { code: true },
    });
    const haveChannel = new Set(existingChannels.map((c: { code: string }) => c.code));
    const missingChannels = DEFAULT_CONVERSATION_CHANNELS.filter((c) => !haveChannel.has(c.code));
    if (missingChannels.length) {
        await tx.conversationChannel.createMany({
            data: missingChannels.map((c) => ({
                tenant_id: tenantId,
                code: c.code,
                name: c.name,
                icon: c.icon,
                sort_order: c.sort_order,
                is_system: true,
                is_active: true,
            })),
            skipDuplicates: true,
        });
        delta.channelsCreated.push(...missingChannels.map((c) => c.code));
        missingChannels.forEach((c) => haveChannel.add(c.code));
    }

    // Activity purposes. sync-crm-activities runs after this script in the
    // container start chain and resolves backfilled CrmFollowUp.type values to a
    // purpose by `code`, so these rows must exist for every tenant first.
    const existingPurposes = await tx.crmActivityPurpose.findMany({
        where: { tenant_id: tenantId },
        select: { code: true },
    });
    const havePurpose = new Set(existingPurposes.map((p: { code: string }) => p.code));
    const missingPurposes = DEFAULT_ACTIVITY_PURPOSES.filter((p) => !havePurpose.has(p.code));
    if (missingPurposes.length) {
        await tx.crmActivityPurpose.createMany({
            data: missingPurposes.map((p) => ({
                tenant_id: tenantId,
                code: p.code,
                name: p.name,
                icon: p.icon,
                sort_order: p.sort_order,
                is_system: true,
                is_active: true,
            })),
            skipDuplicates: true,
        });
        delta.purposesCreated.push(...missingPurposes.map((p) => p.code));
        missingPurposes.forEach((p) => havePurpose.add(p.code));
    }

    // --- 2. Reconcile codes actually in use -------------------------------
    // A tenant may hold a legacy enum value whose option row was deleted. Create
    // it (is_system=false, so the tenant can remove it once nothing uses it)
    // rather than letting step 3 silently bucket those leads into OTHER.
    if (hasSource) {
        const inUse = await tx.$queryRaw<{ code: string }[]>`
            SELECT DISTINCT "source"::text AS code
            FROM "Lead"
            WHERE tenant_id = ${tenantId} AND source_id IS NULL
        `;
        const orphanCodes = inUse.map((r) => r.code).filter((c) => c && !haveSource.has(c));
        if (orphanCodes.length) {
            await tx.leadSourceOption.createMany({
                data: orphanCodes.map((code, i) => ({
                    tenant_id: tenantId,
                    code,
                    name: code,
                    score_weight: 5,
                    sort_order: 100 + i,
                    is_system: false,
                    is_active: true,
                })),
                skipDuplicates: true,
            });
            delta.sourcesCreated.push(...orphanCodes);
        }
    }

    if (hasCategory) {
        const inUse = await tx.$queryRaw<{ code: string }[]>`
            SELECT DISTINCT "category"::text AS code
            FROM "Lead"
            WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND category_id IS NULL
        `;
        const orphanCodes = inUse.map((r) => r.code).filter((c) => c && !haveCategory.has(c));
        if (orphanCodes.length) {
            await tx.leadCategoryOption.createMany({
                data: orphanCodes.map((code, i) => ({
                    tenant_id: tenantId,
                    code,
                    name: code,
                    sort_order: 100 + i,
                    is_system: false,
                    is_active: true,
                })),
                skipDuplicates: true,
            });
            delta.categoriesCreated.push(...orphanCodes);
        }
    }

    // `LeadConversation.type` is a plain string, so unlike the two lists above it has
    // no legacy enum column to guard on — a value here can be anything a past client
    // wrote. Same treatment: give it a row rather than letting the backfill drop it.
    {
        const inUse = await tx.$queryRaw<{ code: string }[]>`
            SELECT DISTINCT "type" AS code
            FROM "LeadConversation"
            WHERE tenant_id = ${tenantId} AND channel_id IS NULL AND "type" <> ''
        `;
        const orphanCodes = inUse.map((r) => r.code).filter((c) => c && !haveChannel.has(c));
        if (orphanCodes.length) {
            await tx.conversationChannel.createMany({
                data: orphanCodes.map((code, i) => ({
                    tenant_id: tenantId,
                    code,
                    name: code,
                    sort_order: 100 + i,
                    is_system: false,
                    is_active: true,
                })),
                skipDuplicates: true,
            });
            delta.channelsCreated.push(...orphanCodes);
        }
    }

    // --- 3. Backfill ------------------------------------------------------
    // Joins on the immutable `code`, never `name`, so a tenant renaming
    // "Facebook" to "Meta Ads" mid-migration cannot break the match.
    if (hasSource) {
        delta.leadsSourceBackfilled = await tx.$executeRaw`
            UPDATE "Lead" l
            SET source_id = o.id
            FROM "LeadSourceOption" o
            WHERE o.tenant_id = l.tenant_id
              AND o.code = l."source"::text
              AND l.tenant_id = ${tenantId}
              AND l.source_id IS NULL
        `;
    }

    if (hasCategory) {
        delta.leadsCategoryBackfilled = await tx.$executeRaw`
            UPDATE "Lead" l
            SET category_id = o.id
            FROM "LeadCategoryOption" o
            WHERE o.tenant_id = l.tenant_id
              AND o.code = l."category"::text
              AND l.tenant_id = ${tenantId}
              AND l.category_id IS NULL
              AND l."category" IS NOT NULL
        `;
    }

    delta.conversationsChannelBackfilled = await tx.$executeRaw`
        UPDATE "LeadConversation" c
        SET channel_id = ch.id
        FROM "ConversationChannel" ch
        WHERE ch.tenant_id = c.tenant_id
          AND ch.code = c."type"
          AND c.tenant_id = ${tenantId}
          AND c.channel_id IS NULL
    `;

    // --- 4. Verify --------------------------------------------------------
    // Reported, never silently absorbed: this count is the gate the contract
    // release (dropping the enum columns) must see at zero.
    if (hasSource) {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) AS count FROM "Lead"
            WHERE tenant_id = ${tenantId} AND source_id IS NULL
        `;
        delta.unresolvedSources = Number(count);
    }
    if (hasCategory) {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) AS count FROM "Lead"
            WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND category_id IS NULL
        `;
        delta.unresolvedCategories = Number(count);
    }
    {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) AS count FROM "LeadConversation"
            WHERE tenant_id = ${tenantId} AND channel_id IS NULL
        `;
        delta.unresolvedChannels = Number(count);
    }

    return delta;
}

async function previewTenant(
    tenantId: string,
    tenantName: string,
    hasSource: boolean,
    hasCategory: boolean,
): Promise<Delta> {
    let delta: Delta | undefined;
    try {
        await prisma.$transaction(async (tx) => {
            delta = await syncTenant(tx, tenantId, tenantName, hasSource, hasCategory);
            throw new Rollback();
        }, TX_OPTS);
    } catch (error) {
        if (!(error instanceof Rollback)) throw error;
    }
    return delta!;
}

function isNoop(d: Delta) {
    return (
        d.sourcesCreated.length === 0 &&
        d.categoriesCreated.length === 0 &&
        d.channelsCreated.length === 0 &&
        d.purposesCreated.length === 0 &&
        d.leadsSourceBackfilled === 0 &&
        d.leadsCategoryBackfilled === 0 &&
        d.conversationsChannelBackfilled === 0 &&
        d.unresolvedSources === 0 &&
        d.unresolvedCategories === 0 &&
        d.unresolvedChannels === 0
    );
}

function reportTenant(d: Delta, dryRun: boolean) {
    const verb = dryRun ? 'would add' : 'added';
    console.log(`\n  ${d.tenantName} (${d.tenantId})`);
    if (d.sourcesCreated.length) console.log(`    ${verb} sources: ${d.sourcesCreated.join(', ')}`);
    if (d.categoriesCreated.length) console.log(`    ${verb} categories: ${d.categoriesCreated.join(', ')}`);
    if (d.channelsCreated.length) console.log(`    ${verb} channels: ${d.channelsCreated.join(', ')}`);
    if (d.purposesCreated.length) console.log(`    ${verb} activity purposes: ${d.purposesCreated.join(', ')}`);
    if (d.leadsSourceBackfilled) console.log(`    ${dryRun ? 'would backfill' : 'backfilled'} source_id on ${d.leadsSourceBackfilled} lead(s)`);
    if (d.leadsCategoryBackfilled) console.log(`    ${dryRun ? 'would backfill' : 'backfilled'} category_id on ${d.leadsCategoryBackfilled} lead(s)`);
    if (d.conversationsChannelBackfilled) console.log(`    ${dryRun ? 'would backfill' : 'backfilled'} channel_id on ${d.conversationsChannelBackfilled} conversation(s)`);
    if (d.unresolvedSources) console.log(`    !! ${d.unresolvedSources} lead(s) still have no source_id`);
    if (d.unresolvedCategories) console.log(`    !! ${d.unresolvedCategories} lead(s) still have no category_id`);
    if (d.unresolvedChannels) console.log(`    !! ${d.unresolvedChannels} conversation(s) still have no channel_id`);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const hasSource = await legacyColumnExists('source');
    const hasCategory = await legacyColumnExists('category');
    const tenants = await loadTenants(tenantId);

    console.log(
        `Sync lead taxonomy (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)` +
        (hasSource || hasCategory ? '' : ' — legacy enum columns already dropped, seeding defaults only'),
    );

    const changed: Delta[] = [];
    for (const tenant of tenants) {
        const delta = dryRun
            ? await previewTenant(tenant.id, tenant.name, hasSource, hasCategory)
            : await prisma.$transaction(
                (tx) => syncTenant(tx, tenant.id, tenant.name, hasSource, hasCategory),
                TX_OPTS,
            );
        if (isNoop(delta)) continue;
        changed.push(delta);
        reportTenant(delta, dryRun);
    }

    if (changed.length === 0) {
        console.log(`\nAll ${tenants.length} tenant(s) already up to date. Nothing to do.`);
        return;
    }

    const totals = changed.reduce(
        (acc, d) => ({
            sources: acc.sources + d.sourcesCreated.length,
            categories: acc.categories + d.categoriesCreated.length,
            channels: acc.channels + d.channelsCreated.length,
            purposes: acc.purposes + d.purposesCreated.length,
            leads: acc.leads + d.leadsSourceBackfilled + d.leadsCategoryBackfilled,
            conversations: acc.conversations + d.conversationsChannelBackfilled,
            unresolved: acc.unresolved + d.unresolvedSources + d.unresolvedCategories,
        }),
        { sources: 0, categories: 0, channels: 0, purposes: 0, leads: 0, conversations: 0, unresolved: 0 },
    );

    console.log(
        `\n${dryRun ? 'Would sync' : 'Synced'} ${changed.length} of ${tenants.length} tenant(s): ` +
        `${totals.sources} source(s), ${totals.categories} category(ies), ${totals.channels} channel(s), ` +
        `${totals.purposes} activity purpose(s), ` +
        `${totals.leads} lead backfill(s), ${totals.conversations} conversation backfill(s).`,
    );

    if (totals.unresolved > 0) {
        // Loud, but deliberately NOT a non-zero exit: this script gates the
        // backend's boot in the Dockerfile `&&` chain, and a stale lead row must
        // not take the app down. The contract release is what must block on this.
        console.warn(
            `\nWARNING: ${totals.unresolved} lead row(s) could not be matched to a taxonomy row. ` +
            `Do NOT drop the legacy Lead.source / Lead.category columns until this reaches zero. ` +
            `Fallback source code is '${FALLBACK_SOURCE_CODE}'.`,
        );
    }

    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
