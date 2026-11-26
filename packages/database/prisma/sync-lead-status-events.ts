/**
 * Backfills `LeadStatusEvent` for leads that were already won or lost before
 * the movement log existed, so past periods on the Lead movement report are
 * not empty.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else. `LeadStatusEvent` is additive, so the table appears,
 * but nothing writes a landing for deals that closed last month. Without this
 * script the movement report would show won/lost only from the day of deploy.
 *
 * Open-stage hops from before deploy cannot be rebuilt. Only a closed lead
 * (`closed_at` set, lifecycle CONVERTED or LOST) gets a synthetic landing,
 * dated at `closed_at`, `from_*` null, `to_*` the current stage, `created_by`
 * null.
 *
 * It runs on every container start, so it must be idempotent. It is: a lead
 * that already has any event is left alone, so a second run is a no-op and a
 * landing the app has since written is never overwritten. Skip a lead that
 * already has any event.
 *
 * Guarded on information_schema so a missing `lead_status_events` table is a
 * no-op rather than an error — this script sits in the container start chain,
 * where a throw would be a full outage.
 *
 * Usage:
 *   npx tsx prisma/sync-lead-status-events.ts --dry-run
 *   npx tsx prisma/sync-lead-status-events.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SyncResult {
    /** Closed CONVERTED/LOST leads. */
    scanned: number;
    /** Of those, the ones with zero events — inserted (or would be, on dry-run). */
    filled: number;
    /** Already had at least one event; left alone. */
    skipped: number;
    /** Table was missing; nothing ran. */
    missingTable: boolean;
}

async function eventsTableExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'lead_status_events'
        ) AS "exists"
    `;
    return rows[0]?.exists === true;
}

export async function syncLeadStatusEvents(dryRun = false): Promise<SyncResult> {
    if (!(await eventsTableExists())) {
        return { scanned: 0, filled: 0, skipped: 0, missingTable: true };
    }

    const [{ scanned, fillable }] = await prisma.$queryRawUnsafe<
        { scanned: bigint; fillable: bigint }[]
    >(`
        SELECT COUNT(*) AS scanned,
               COUNT(*) FILTER (
                   WHERE NOT EXISTS (
                       SELECT 1 FROM "lead_status_events" e WHERE e."lead_id" = l."id"
                   )
               ) AS fillable
        FROM "Lead" l
        WHERE l."closed_at" IS NOT NULL
          AND l."status" IN ('CONVERTED'::"LeadStatus", 'LOST'::"LeadStatus")
    `);

    const result: SyncResult = {
        scanned: Number(scanned),
        filled: Number(fillable),
        skipped: Number(scanned) - Number(fillable),
        missingTable: false,
    };

    if (!dryRun && result.filled > 0) {
        // One statement rather than a paged read/write loop: a partial run is
        // safe anyway — the next boot picks up whatever is left, and a lead
        // that already has any event is never rewritten.
        await prisma.$executeRawUnsafe(`
            INSERT INTO "lead_status_events" (
                "id", "tenant_id", "lead_id",
                "from_status_id", "to_status_id",
                "from_lifecycle", "to_lifecycle",
                "created_by", "created_at"
            )
            SELECT
                gen_random_uuid()::text,
                l."tenant_id",
                l."id",
                NULL,
                l."status_id",
                NULL,
                l."status",
                NULL,
                l."closed_at"
            FROM "Lead" l
            WHERE l."closed_at" IS NOT NULL
              AND l."status" IN ('CONVERTED'::"LeadStatus", 'LOST'::"LeadStatus")
              AND NOT EXISTS (
                  SELECT 1 FROM "lead_status_events" e WHERE e."lead_id" = l."id"
              )
        `);
    }

    return result;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result = await syncLeadStatusEvents(dryRun);

    const prefix = dryRun ? '[dry run] ' : '';
    if (result.missingTable) {
        console.log(`${prefix}sync-lead-status-events: lead_status_events table is missing; nothing to do.`);
        return;
    }
    console.log(
        `${prefix}sync-lead-status-events: scanned ${result.scanned} closed lead(s), ` +
            `filled ${result.filled}, left ${result.skipped} that already had an event.`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-lead-status-events failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
