/**
 * Opens remaining hours at the estimate on tasks that never had any.
 *
 * Why these exist
 * ---------------
 * `ProjectTasksService.create` opens `remaining_hours` at the estimate only
 * when the estimate arrives with the task. A task created blank and estimated
 * later — on the form, or by an import updating it — was left with an estimate
 * and no remaining at all, so the sprint table, its totals and the burndown all
 * read it as zero work. `update` now opens remaining when an estimate lands on
 * such a task; this fills in the ones that were estimated before that fix.
 *
 * Which tasks it touches
 * ----------------------
 * Only the unambiguous case: not deleted, not in a DONE column, an estimate set,
 * no remaining hours, and **no time logged**. With nothing spent, the estimate
 * is the only defensible remaining. Three near-misses are counted and left:
 *
 *   - DONE tasks — their remaining is zero, not the estimate; putting hours
 *     back on finished work would raise every burndown they sit in.
 *   - Tasks with time logged — "estimate minus logged" is a guess about how
 *     much is really left, which is the person's call, not a script's.
 *   - Tasks with no estimate — there is nothing to copy.
 *
 * How it writes
 * -------------
 * Exactly as `RemainingHoursService.write` does: the column and a
 * `ProjectTaskRemainingLog` row together, in one transaction per task, source
 * RE_ESTIMATED and a note saying it was backfilled. The log row is stamped now,
 * not at the task's creation — the history records when the figure was set,
 * and a backdated row would claim the burndown knew it all along. So an active
 * sprint's remaining line steps up by these hours from the day this runs.
 *
 * Idempotent: a task it fixed has remaining hours, so a second run skips it.
 *
 * Report-only by default. Read the summary, then re-run with --apply.
 *
 * Usage:
 *   npx tsx prisma/backfill-task-remaining.ts                   # report, all tenants
 *   npx tsx prisma/backfill-task-remaining.ts --tenant=<id>     # report, one tenant
 *   npx tsx prisma/backfill-task-remaining.ts --apply           # write
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOTE = 'Backfilled: opened at the estimate — no remaining hours had been recorded.';

function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
    const tenantId = tenantArg ? tenantArg.slice('--tenant='.length) : undefined;

    const base = {
        deleted_at: null,
        remaining_hours: null,
        ...(tenantId ? { tenant_id: tenantId } : {}),
    };
    const open = { status: { category: { not: 'DONE' as const } } };

    const candidates = await prisma.projectTask.findMany({
        where: { ...base, ...open, estimate_hours: { not: null }, timeEntries: { none: {} } },
        select: {
            id: true,
            tenant_id: true,
            project_id: true,
            sprint_id: true,
            reference: true,
            title: true,
            estimate_hours: true,
            project: { select: { code: true } },
        },
        orderBy: [{ tenant_id: 'asc' }, { project_id: 'asc' }, { reference: 'asc' }],
    });

    const [skippedDone, skippedLogged, skippedNoEstimate] = await Promise.all([
        prisma.projectTask.count({
            where: { ...base, estimate_hours: { not: null }, status: { category: 'DONE' } },
        }),
        prisma.projectTask.count({
            where: { ...base, ...open, estimate_hours: { not: null }, timeEntries: { some: {} } },
        }),
        prisma.projectTask.count({ where: { ...base, ...open, estimate_hours: null } }),
    ]);

    const byTenant = new Map<string, { tasks: number; hours: number }>();
    for (const task of candidates) {
        const entry = byTenant.get(task.tenant_id) ?? { tasks: 0, hours: 0 };
        entry.tasks += 1;
        entry.hours = round2(entry.hours + Number(task.estimate_hours));
        byTenant.set(task.tenant_id, entry);
    }

    console.log(`[backfill-task-remaining] ${apply ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'}`);
    console.log(`  To fix: ${candidates.length} task(s) — remaining := estimate`);
    for (const [tenant, entry] of byTenant) {
        console.log(`    tenant ${tenant}: ${entry.tasks} task(s), ${entry.hours}h`);
    }
    for (const task of candidates.slice(0, 50)) {
        console.log(`      ${task.project.code}-${task.reference}  ${Number(task.estimate_hours)}h  ${task.title}`);
    }
    if (candidates.length > 50) console.log(`      … and ${candidates.length - 50} more`);
    console.log('  Left alone:');
    console.log(`    ${skippedDone} done task(s) with an estimate and no remaining (remaining should be 0, not the estimate)`);
    console.log(`    ${skippedLogged} open task(s) with time logged and no remaining (needs a person to re-estimate)`);
    console.log(`    ${skippedNoEstimate} open task(s) with no estimate (nothing to copy)`);

    if (!apply || candidates.length === 0) return;

    let written = 0;
    for (const task of candidates) {
        const hours = round2(Number(task.estimate_hours));
        await prisma.$transaction(async (tx) => {
            // Re-checked inside the transaction, so a task that got remaining
            // hours (or a time entry) since the scan is not overwritten.
            const updated = await tx.projectTask.updateMany({
                where: { id: task.id, remaining_hours: null, timeEntries: { none: {} } },
                data: { remaining_hours: hours },
            });
            if (updated.count === 0) return;
            await tx.projectTaskRemainingLog.create({
                data: {
                    tenant_id: task.tenant_id,
                    task_id: task.id,
                    project_id: task.project_id,
                    sprint_id: task.sprint_id,
                    previous_hours: null,
                    new_hours: hours,
                    delta: hours,
                    source: 'RE_ESTIMATED',
                    note: NOTE,
                    changed_by: null,
                },
            });
            written += 1;
        });
    }
    console.log(`[backfill-task-remaining] Wrote remaining hours on ${written} task(s).`);
}

main()
    .catch((error) => {
        console.error('[backfill-task-remaining] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
