/**
 * Mirrors every legacy CRM row into `CrmActivity`, the unified table that
 * replaces `LeadConversation`, `CustomerInteraction` and `CrmFollowUp`.
 *
 * Why this exists
 * ---------------
 * R1 makes `CrmActivity` the write path while every legacy table keeps serving
 * reads. Nothing moves the history across on its own, so a tenant would open the
 * new activity list and see only what was written after the deploy. This script
 * carries the past over — the same role `sync-lead-taxonomy.ts` plays for the
 * CRM lookup lists.
 *
 * It runs on every container start, so it must be idempotent. That rests on
 * `@@unique([tenant_id, legacy_source, legacy_id])` plus `skipDuplicates`: a row
 * already mirrored is skipped, and a re-run is a no-op. Postgres treats NULLs as
 * distinct, so the index constrains only backfilled rows — user-created
 * activities carry null provenance and are never touched.
 *
 * Ordering matters
 * ----------------
 * 1. load the tenant's purpose and channel codes -> ids (one query each)
 * 2. mirror LeadConversation / CustomerInteraction / CrmFollowUp in batches
 * 3. materialise `Lead.next_step` — but only where it is not already a
 *    duplicate of a follow-up mirrored in step 2, which it very often is
 * 4. recalculate every touched parent's rollup with the same earliest-planned
 *    rule CrmActivitiesService.recalculateRollup applies
 *
 * Step 3 runs after step 2 on purpose: the same-day check needs the follow-ups
 * already present to compare against.
 *
 * Runs ahead of the API in the container start chain, so `sync-lead-taxonomy`
 * must have seeded the four activity purposes before this runs.
 *
 * Survives the contract release
 * -----------------------------
 * R3 drops the three legacy tables. The reads here are guarded on
 * `information_schema` rather than assumed present, so this degrades to a no-op
 * instead of erroring — it sits inside the `&&` chain in apps/backend/Dockerfile,
 * where a non-zero exit means the backend never boots.
 *
 * Usage:
 *   npx tsx prisma/sync-crm-activities.ts --dry-run
 *   npx tsx prisma/sync-crm-activities.ts --tenant=<uuid>
 *   npx tsx prisma/sync-crm-activities.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

export type LegacySource =
    | 'LEAD_CONVERSATION'
    | 'CUSTOMER_INTERACTION'
    | 'CRM_FOLLOW_UP'
    | 'LEAD_NEXT_STEP';

/** Maps one legacy row to a CrmActivity create payload. See the mapping table in the spec. */
export function mapLegacyRow(
    source: LegacySource,
    row: any,
    purposes: Record<string, string>,
    channels: Record<string, string> = {},
) {
    const base = {
        tenant_id: row.tenant_id,
        store_id: row.store_id ?? null,
        lead_id: row.lead_id ?? null,
        customer_id: row.customer_id ?? null,
        created_by: row.created_by ?? null,
        assigned_to: row.assigned_to ?? null,
        origin: 'IMPORT',
        legacy_source: source,
        legacy_id: row.id,
    };

    if (source === 'LEAD_CONVERSATION' || source === 'CUSTOMER_INTERACTION') {
        // A logged touch has no separate title — subject stays null and the UI
        // renders `subject ?? summary`.
        return {
            ...base,
            subject: null,
            status: 'DONE',
            due_at: null,
            completed_at: row.created_at,
            summary: row.summary ?? null,
            outcome: row.outcome ?? null,
            notes: null,
            direction: row.direction ?? 'OUTBOUND',
            purpose_id: null,
            // LeadConversation already carries a resolved channel_id; the
            // customer side only has a type string, matched against the tenant's
            // channel codes. Unmatched leaves the FK null but keeps the code, so
            // nothing is silently lost and the residual is reportable.
            channel_id: row.channel_id ?? channels[row.type] ?? null,
            channel_code: row.type ?? null,
        };
    }

    if (source === 'CRM_FOLLOW_UP') {
        const done = row.status === 'DONE';
        return {
            ...base,
            subject: row.title,
            status: done ? 'DONE' : 'PLANNED',
            due_at: row.due_at,
            completed_at: done ? row.completed_at : null,
            summary: null,
            outcome: null,
            notes: row.notes ?? null,
            direction: 'OUTBOUND',
            purpose_id: purposes[row.type] ?? purposes.GENERAL ?? null,
            channel_id: null,
            channel_code: null,
        };
    }

    return {
        ...base,
        lead_id: row.id,
        customer_id: null,
        assigned_to: row.next_step_assigned_to ?? null,
        subject: row.next_step,
        status: 'PLANNED',
        due_at: row.next_step_date ?? null,
        completed_at: null,
        summary: null,
        outcome: null,
        notes: null,
        direction: 'OUTBOUND',
        purpose_id: purposes.GENERAL ?? null,
        channel_id: null,
        channel_code: null,
    };
}

const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * `Lead.next_step` is very often a duplicate of a follow-up that already exists —
 * that duplication is the whole reason for this migration. Materialising it
 * anyway would manufacture a second copy of one task on day one.
 */
export function shouldMaterialiseNextStep(
    lead: { status: string; next_step: string | null; next_step_date: Date | null },
    plannedActivities: { due_at: Date | null }[],
) {
    if (!lead.next_step) return false;
    // A closed lead's next step is stale by definition; importing it would
    // recreate the stale-overdue bug this migration exists to fix.
    if (lead.status === 'CONVERTED' || lead.status === 'LOST') return false;
    if (!lead.next_step_date) return plannedActivities.length === 0;
    return !plannedActivities.some((a) => a.due_at && sameDay(a.due_at, lead.next_step_date!));
}

/* ------------------------------------------------------------------ */
/*  Driver                                                             */
/* ------------------------------------------------------------------ */

const prisma = new PrismaClient();

/** Legacy tables hold five figures of rows on a busy tenant; stream, do not slurp. */
const BATCH = 500;

type Delta = {
    tenantId: string;
    tenantName: string;
    conversations: number;
    interactions: number;
    followUps: number;
    nextSteps: number;
    nextStepsSkipped: number;
    unresolvedChannels: number;
    rollupsRecalculated: number;
};

function emptyDelta(tenantId: string, tenantName: string): Delta {
    return {
        tenantId,
        tenantName,
        conversations: 0,
        interactions: 0,
        followUps: 0,
        nextSteps: 0,
        nextStepsSkipped: 0,
        unresolvedChannels: 0,
        rollupsRecalculated: 0,
    };
}

/**
 * True when a legacy table is still present. False after R3 drops it, which
 * turns the matching mirror step into a no-op rather than an error — this script
 * gates the backend's boot.
 */
async function legacyTableExists(table: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = ${table}
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

/** code -> id, one query per list per tenant rather than one lookup per row. */
async function loadCodeMaps(tenantId: string) {
    const [purposeRows, channelRows] = await Promise.all([
        prisma.crmActivityPurpose.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, code: true },
        }),
        prisma.conversationChannel.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, code: true },
        }),
    ]);

    const purposes: Record<string, string> = {};
    for (const p of purposeRows) purposes[p.code] = p.id;
    const channels: Record<string, string> = {};
    for (const c of channelRows) channels[c.code] = c.id;
    return { purposes, channels };
}

/**
 * Mirror one legacy table in batches. Returns how many rows were written.
 *
 * `skipDuplicates` against @@unique([tenant_id, legacy_source, legacy_id]) is
 * what makes a re-run free: already-mirrored rows are dropped by the database,
 * not filtered in JS.
 */
async function mirrorTable(
    source: LegacySource,
    fetchPage: (skip: number) => Promise<any[]>,
    purposes: Record<string, string>,
    channels: Record<string, string>,
    dryRun: boolean,
    onRow?: (row: any, mapped: any) => void,
): Promise<number> {
    let skip = 0;
    let written = 0;

    for (;;) {
        const page = await fetchPage(skip);
        if (page.length === 0) break;

        const data = page.map((row) => {
            const mapped = mapLegacyRow(source, row, purposes, channels);
            onRow?.(row, mapped);
            return mapped;
        });

        if (dryRun) {
            // Count what *would* be new rather than what exists, so a dry run on
            // an already-synced database reports zero instead of the full table.
            const existing = await prisma.crmActivity.count({
                where: {
                    tenant_id: page[0].tenant_id,
                    legacy_source: source,
                    legacy_id: { in: page.map((r) => r.id) },
                },
            });
            written += page.length - existing;
        } else {
            const res = await prisma.crmActivity.createMany({ data, skipDuplicates: true });
            written += res.count;
        }

        if (page.length < BATCH) break;
        skip += BATCH;
    }

    return written;
}

/**
 * The same earliest-planned rule CrmActivitiesService.recalculateRollup applies.
 * Duplicated rather than imported: this script runs from packages/database and
 * cannot reach into the Nest service, and the rule is four columns wide.
 */
async function recalculateRollups(tenantId: string, dryRun: boolean): Promise<number> {
    if (dryRun) return 0;

    // Only parents that actually have a mirrored activity — recalculating every
    // lead in the tenant would rewrite rows this script never touched.
    const [leadIds, customerIds] = await Promise.all([
        prisma.crmActivity.findMany({
            where: { tenant_id: tenantId, lead_id: { not: null } },
            select: { lead_id: true },
            distinct: ['lead_id'],
        }),
        prisma.crmActivity.findMany({
            where: { tenant_id: tenantId, customer_id: { not: null } },
            select: { customer_id: true },
            distinct: ['customer_id'],
        }),
    ]);

    let count = 0;

    for (const { lead_id } of leadIds) {
        if (!lead_id) continue;
        const next = await earliestPlanned({ tenant_id: tenantId, lead_id, status: 'PLANNED' });
        await prisma.lead.update({
            where: { id: lead_id },
            data: {
                next_step: next?.subject ?? null,
                next_step_date: next?.due_at ?? null,
                next_step_assigned_to: next?.assigned_to ?? null,
                next_activity_id: next?.id ?? null,
            },
        });
        count++;
    }

    for (const { customer_id } of customerIds) {
        if (!customer_id) continue;
        const next = await earliestPlanned({ tenant_id: tenantId, customer_id, status: 'PLANNED' });
        await prisma.customer.update({
            where: { id: customer_id },
            data: {
                next_activity_id: next?.id ?? null,
                next_activity_date: next?.due_at ?? null,
            },
        });
        count++;
    }

    return count;
}

/** Dated rows first — an undated activity must not outrank a dated one. */
async function earliestPlanned(where: Record<string, unknown>) {
    const select = { id: true, subject: true, due_at: true, assigned_to: true };
    return (
        (await prisma.crmActivity.findFirst({
            where: { ...where, due_at: { not: null } } as any,
            orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
            select,
        })) ??
        (await prisma.crmActivity.findFirst({
            where: where as any,
            orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
            select,
        }))
    );
}

async function syncTenant(
    tenantId: string,
    tenantName: string,
    present: { conversations: boolean; interactions: boolean; followUps: boolean },
    dryRun: boolean,
): Promise<Delta> {
    const delta = emptyDelta(tenantId, tenantName);
    const { purposes, channels } = await loadCodeMaps(tenantId);

    if (Object.keys(purposes).length === 0) {
        console.warn(
            `  !! ${tenantName} (${tenantId}) has no activity purposes — run sync:lead-taxonomy first. Skipping.`,
        );
        return delta;
    }

    if (present.conversations) {
        delta.conversations = await mirrorTable(
            'LEAD_CONVERSATION',
            (skip) =>
                prisma.leadConversation.findMany({
                    where: { tenant_id: tenantId },
                    orderBy: { id: 'asc' },
                    skip,
                    take: BATCH,
                }),
            purposes,
            channels,
            dryRun,
            (_row, mapped) => {
                if (!mapped.channel_id && mapped.channel_code) delta.unresolvedChannels++;
            },
        );
    }

    if (present.interactions) {
        delta.interactions = await mirrorTable(
            'CUSTOMER_INTERACTION',
            (skip) =>
                prisma.customerInteraction.findMany({
                    where: { tenant_id: tenantId },
                    orderBy: { id: 'asc' },
                    skip,
                    take: BATCH,
                }),
            purposes,
            channels,
            dryRun,
            (_row, mapped) => {
                if (!mapped.channel_id && mapped.channel_code) delta.unresolvedChannels++;
            },
        );
    }

    if (present.followUps) {
        delta.followUps = await mirrorTable(
            'CRM_FOLLOW_UP',
            (skip) =>
                prisma.crmFollowUp.findMany({
                    where: { tenant_id: tenantId },
                    orderBy: { id: 'asc' },
                    skip,
                    take: BATCH,
                }),
            purposes,
            channels,
            dryRun,
        );
    }

    // --- Lead.next_step, last, so the same-day check sees the follow-ups above.
    const openLeads = await prisma.lead.findMany({
        where: {
            tenant_id: tenantId,
            next_step: { not: null },
            status: { notIn: ['CONVERTED', 'LOST'] },
        },
        select: {
            id: true,
            tenant_id: true,
            store_id: true,
            status: true,
            next_step: true,
            next_step_date: true,
            next_step_assigned_to: true,
        },
    });

    for (const lead of openLeads) {
        const planned = await prisma.crmActivity.findMany({
            where: { tenant_id: tenantId, lead_id: lead.id, status: 'PLANNED' },
            select: { due_at: true },
        });

        if (!shouldMaterialiseNextStep(lead as any, planned)) {
            delta.nextStepsSkipped++;
            continue;
        }

        if (dryRun) {
            delta.nextSteps++;
            continue;
        }

        const res = await prisma.crmActivity.createMany({
            data: [mapLegacyRow('LEAD_NEXT_STEP', lead, purposes, channels)],
            skipDuplicates: true,
        });
        delta.nextSteps += res.count;
    }

    // Only when something was actually mirrored. This script runs on every
    // container start, and recalculating a settled tenant's whole lead and
    // customer base each time would be thousands of pointless writes — from
    // the first run onward CrmActivitiesService.recalculateRollup keeps the
    // columns current.
    const mirrored =
        delta.conversations + delta.interactions + delta.followUps + delta.nextSteps;
    if (mirrored > 0) {
        delta.rollupsRecalculated = await recalculateRollups(tenantId, dryRun);
    }

    return delta;
}

function isNoop(d: Delta) {
    return (
        d.conversations === 0 &&
        d.interactions === 0 &&
        d.followUps === 0 &&
        d.nextSteps === 0 &&
        d.unresolvedChannels === 0
    );
}

function reportTenant(d: Delta, dryRun: boolean) {
    const verb = dryRun ? 'would mirror' : 'mirrored';
    console.log(`\n  ${d.tenantName} (${d.tenantId})`);
    if (d.conversations) console.log(`    ${verb} ${d.conversations} lead conversation(s)`);
    if (d.interactions) console.log(`    ${verb} ${d.interactions} customer interaction(s)`);
    if (d.followUps) console.log(`    ${verb} ${d.followUps} follow-up(s)`);
    if (d.nextSteps) console.log(`    ${verb} ${d.nextSteps} lead next_step(s)`);
    if (d.nextStepsSkipped) {
        console.log(
            `    skipped ${d.nextStepsSkipped} next_step(s) already covered by a same-day planned activity`,
        );
    }
    if (d.rollupsRecalculated) console.log(`    recalculated ${d.rollupsRecalculated} rollup(s)`);
    if (d.unresolvedChannels) {
        console.log(
            `    !! ${d.unresolvedChannels} row(s) carried a channel code matching no ConversationChannel — ` +
                'channel_code kept, channel_id left null',
        );
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const present = {
        conversations: await legacyTableExists('LeadConversation'),
        interactions: await legacyTableExists('CustomerInteraction'),
        followUps: await legacyTableExists('CrmFollowUp'),
    };

    if (!present.conversations && !present.interactions && !present.followUps) {
        // Guarded rather than assumed, so this degrades to a no-op after R3 drops
        // the legacy tables instead of erroring.
        console.log('Legacy CRM tables absent — nothing to backfill.');
        return;
    }

    const tenants = await loadTenants(tenantId);
    console.log(
        `Sync CRM activities (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`,
    );

    const changed: Delta[] = [];
    for (const tenant of tenants) {
        const delta = await syncTenant(tenant.id, tenant.name, present, dryRun);
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
            rows: acc.rows + d.conversations + d.interactions + d.followUps + d.nextSteps,
            skipped: acc.skipped + d.nextStepsSkipped,
            unresolved: acc.unresolved + d.unresolvedChannels,
        }),
        { rows: 0, skipped: 0, unresolved: 0 },
    );

    console.log(
        `\n${dryRun ? 'Would mirror' : 'Mirrored'} ${totals.rows} row(s) across ` +
            `${changed.length} of ${tenants.length} tenant(s); ` +
            `${totals.skipped} next_step(s) skipped as same-day duplicates.`,
    );

    if (totals.unresolved > 0) {
        console.warn(
            `\nWARNING: ${totals.unresolved} mirrored row(s) carry a channel code that matches no ` +
                'ConversationChannel. Their channel_code is preserved and channel_id is null, so ' +
                'nothing is lost and they stay filterable by code. Add the missing channels from ' +
                'CRM -> Setup to give them a FK. (sync:lead-taxonomy reconciles LeadConversation.type ' +
                'only — CustomerInteraction.type has no such pass, and is the usual source of these.)',
        );
    }

    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
        console.log(
            '  Note: the next_step count is an upper bound on a first run. The same-day check ' +
                'compares against follow-ups this pass would have written but did not, so a live ' +
                'run mirrors the same rows or fewer, never more.',
        );
    }
}

// Only run the driver when invoked as a script. The two pure functions above are
// imported by the backend's tests, which must not open a database connection.
if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-crm-activities failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
