/**
 * Gives every existing tenant a default work schedule, and every existing
 * employee an assignment to it.
 *
 * Why this is not a migration
 * ---------------------------
 * Production never runs migrations. The backend container reconciles its schema
 * with `prisma db push` on boot (apps/backend/Dockerfile) and applies no
 * migration files, so a backfill living in `prisma/migrations/` reaches exactly
 * nobody. This is the third time that has bitten the project — the account-code
 * rollout, the conversation-channel backfill, and the Phase 3L board columns —
 * so Phase 2 of the HRIS plan was written as a boot-time sync from the start.
 *
 * Why it must run before attendance capture ships
 * -----------------------------------------------
 * `WorkSchedulesService.resolveScheduleDays` falls back to the in-code default
 * when a tenant has no schedule, so nothing *breaks* without this. What breaks
 * is editability: a tenant whose hours are not 9–6 Sun–Thu has no row to change
 * until someone opens the screen, and every attendance status computed before
 * that used hours they never agreed to.
 *
 * Idempotency
 * -----------
 * A tenant that already has any schedule is skipped entirely — including one
 * whose schedules were all deliberately deleted down to none, which is why the
 * check is on *any* schedule rather than on a default one. An employee that
 * already has any assignment is skipped for the same reason: re-adding one
 * would override a deliberate change on every deploy.
 *
 * Usage:
 *   npx tsx prisma/sync-work-schedules.ts --dry-run
 *   npx tsx prisma/sync-work-schedules.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const DEFAULT_SCHEDULE_NAME = 'Standard (Sun–Thu, 9:00–18:00)';
const WORKING_WEEKDAYS = [0, 1, 2, 3, 4]; // Sunday–Thursday
const START_MINUTE = 9 * 60;
const END_MINUTE = 18 * 60;
const BREAK_MINUTES = 60;

/**
 * The date every backfilled assignment starts from.
 *
 * Deliberately far in the past rather than "today": an assignment dated today
 * would leave every historical day with no schedule in force, so recomputing
 * last month would silently treat it as unscheduled. `scheduleInForce` picks
 * the newest row not in the future, so an early date is harmless for the
 * present and correct for the past.
 */
const BACKFILL_EFFECTIVE_FROM = new Date(Date.UTC(2000, 0, 1));

function defaultDays() {
    return Array.from({ length: 7 }, (_, weekday) => {
        const working = WORKING_WEEKDAYS.includes(weekday);
        return {
            weekday,
            is_working: working,
            start_minute: working ? START_MINUTE : null,
            end_minute: working ? END_MINUTE : null,
            break_minutes: working ? BREAK_MINUTES : 0,
        };
    });
}

export interface SyncResult {
    tenantsScanned: number;
    schedulesCreated: number;
    tenantsAlreadyConfigured: number;
    assignmentsCreated: number;
    employeesAlreadyAssigned: number;
}

export async function syncWorkSchedules(
    db: any,
    options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
    const dryRun = options.dryRun ?? false;
    const result: SyncResult = {
        tenantsScanned: 0,
        schedulesCreated: 0,
        tenantsAlreadyConfigured: 0,
        assignmentsCreated: 0,
        employeesAlreadyAssigned: 0,
    };

    const tenants = await db.tenant.findMany({
        where: { deleted_at: null },
        select: { id: true },
    });
    result.tenantsScanned = tenants.length;

    for (const tenant of tenants) {
        let scheduleId: string | null = null;

        const existing = await db.workSchedule.findFirst({
            where: { tenant_id: tenant.id, deleted_at: null },
            select: { id: true, is_default: true },
            orderBy: { is_default: 'desc' },
        });

        if (existing) {
            result.tenantsAlreadyConfigured += 1;
            scheduleId = existing.id;
        } else if (!dryRun) {
            const created = await db.workSchedule.create({
                data: {
                    tenant_id: tenant.id,
                    name: DEFAULT_SCHEDULE_NAME,
                    is_default: true,
                    days: { create: defaultDays() },
                },
                select: { id: true },
            });
            scheduleId = created.id;
            result.schedulesCreated += 1;
        } else {
            result.schedulesCreated += 1;
        }

        // Assign anyone who has no assignment at all. Employees are read in one
        // go per tenant rather than one query per employee — a tenant with 500
        // staff would otherwise make 500 round trips on every boot.
        const employees = await db.employee.findMany({
            where: { tenant_id: tenant.id, deleted_at: null },
            select: { id: true },
        });
        if (employees.length === 0) continue;

        const assigned = await db.employeeSchedule.findMany({
            where: { tenant_id: tenant.id, employee_id: { in: employees.map((e: any) => e.id) } },
            select: { employee_id: true },
            distinct: ['employee_id'],
        });
        const assignedIds = new Set(assigned.map((row: any) => row.employee_id));
        result.employeesAlreadyAssigned += assignedIds.size;

        const missing = employees.filter((employee: any) => !assignedIds.has(employee.id));
        if (missing.length === 0) continue;

        result.assignmentsCreated += missing.length;
        if (dryRun || !scheduleId) continue;

        await db.employeeSchedule.createMany({
            data: missing.map((employee: any) => ({
                tenant_id: tenant.id,
                employee_id: employee.id,
                schedule_id: scheduleId,
                effective_from: BACKFILL_EFFECTIVE_FROM,
            })),
            skipDuplicates: true,
        });
    }

    return result;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync work schedules (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const result = await syncWorkSchedules(prisma, { dryRun });

    console.log(
        `  ${result.tenantsScanned} tenant(s) scanned: ` +
        `${dryRun ? 'would create' : 'created'} ${result.schedulesCreated} default schedule(s), ` +
        `${result.tenantsAlreadyConfigured} already configured.`,
    );
    console.log(
        `  ${dryRun ? 'Would assign' : 'Assigned'} ${result.assignmentsCreated} employee(s); ` +
        `${result.employeesAlreadyAssigned} already had a schedule.`,
    );

    if (dryRun) console.log('DRY RUN — nothing was written.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
