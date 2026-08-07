import { syncWorkSchedules } from '../../../packages/database/prisma/sync-work-schedules';

/**
 * This script sits in the container start chain and runs on **every deploy**,
 * so the property under test is not "does it work once" but "is it inert the
 * second time". A sync that re-applies itself would reset a tenant's edited
 * hours on every release.
 */
describe('syncWorkSchedules', () => {
    const buildDb = (state: {
        tenants?: { id: string }[];
        schedulesByTenant?: Record<string, { id: string; is_default: boolean } | null>;
        employeesByTenant?: Record<string, { id: string }[]>;
        assignedEmployeeIds?: string[];
    }) => {
        const created: { schedules: any[]; assignments: any[] } = { schedules: [], assignments: [] };
        const db = {
            tenant: { findMany: jest.fn().mockResolvedValue(state.tenants ?? []) },
            workSchedule: {
                findFirst: jest.fn(async ({ where }: any) =>
                    state.schedulesByTenant?.[where.tenant_id] ?? null),
                create: jest.fn(async ({ data }: any) => {
                    created.schedules.push(data);
                    return { id: `sched-${created.schedules.length}` };
                }),
            },
            employee: {
                findMany: jest.fn(async ({ where }: any) =>
                    state.employeesByTenant?.[where.tenant_id] ?? []),
            },
            employeeSchedule: {
                findMany: jest.fn(async ({ where }: any) =>
                    (state.assignedEmployeeIds ?? [])
                        .filter((id) => where.employee_id.in.includes(id))
                        .map((employee_id) => ({ employee_id }))),
                createMany: jest.fn(async ({ data }: any) => {
                    created.assignments.push(...data);
                    return { count: data.length };
                }),
            },
        };
        return { db, created };
    };

    it('creates a default schedule and assigns everyone on a fresh tenant', async () => {
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            employeesByTenant: { t1: [{ id: 'e1' }, { id: 'e2' }] },
        });

        const result = await syncWorkSchedules(db);

        expect(result.schedulesCreated).toBe(1);
        expect(result.assignmentsCreated).toBe(2);
        expect(created.schedules[0].is_default).toBe(true);
        expect(created.schedules[0].days.create).toHaveLength(7);
    });

    it('is inert on a second run', async () => {
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            schedulesByTenant: { t1: { id: 'sched-1', is_default: true } },
            employeesByTenant: { t1: [{ id: 'e1' }, { id: 'e2' }] },
            assignedEmployeeIds: ['e1', 'e2'],
        });

        const result = await syncWorkSchedules(db);

        expect(result.schedulesCreated).toBe(0);
        expect(result.tenantsAlreadyConfigured).toBe(1);
        expect(result.assignmentsCreated).toBe(0);
        expect(created.assignments).toHaveLength(0);
        expect(db.workSchedule.create).not.toHaveBeenCalled();
    });

    it('skips a tenant whose only schedule is non-default', async () => {
        // Checked on *any* schedule rather than a default one: a tenant that
        // deliberately unset its default must not have one forced back.
        const { db } = buildDb({
            tenants: [{ id: 't1' }],
            schedulesByTenant: { t1: { id: 'sched-1', is_default: false } },
        });

        const result = await syncWorkSchedules(db);
        expect(result.schedulesCreated).toBe(0);
        expect(db.workSchedule.create).not.toHaveBeenCalled();
    });

    it('assigns only the employees who have no assignment yet', async () => {
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            schedulesByTenant: { t1: { id: 'sched-1', is_default: true } },
            employeesByTenant: { t1: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] },
            assignedEmployeeIds: ['e2'],
        });

        const result = await syncWorkSchedules(db);

        expect(result.assignmentsCreated).toBe(2);
        expect(result.employeesAlreadyAssigned).toBe(1);
        expect(created.assignments.map((a) => a.employee_id).sort()).toEqual(['e1', 'e3']);
    });

    it('backdates assignments so historical months still have a schedule', async () => {
        // An assignment dated today would leave every past day unscheduled, so
        // recomputing last month would silently treat it as no schedule at all.
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            schedulesByTenant: { t1: { id: 'sched-1', is_default: true } },
            employeesByTenant: { t1: [{ id: 'e1' }] },
        });

        await syncWorkSchedules(db);

        expect(created.assignments[0].effective_from.getUTCFullYear()).toBe(2000);
    });

    it('writes nothing on a dry run but still reports what it would do', async () => {
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            employeesByTenant: { t1: [{ id: 'e1' }] },
        });

        const result = await syncWorkSchedules(db, { dryRun: true });

        expect(result.schedulesCreated).toBe(1);
        expect(result.assignmentsCreated).toBe(1);
        expect(created.schedules).toHaveLength(0);
        expect(created.assignments).toHaveLength(0);
    });

    it('handles a tenant with no employees without touching the assignment table', async () => {
        const { db } = buildDb({
            tenants: [{ id: 't1' }],
            schedulesByTenant: { t1: { id: 'sched-1', is_default: true } },
            employeesByTenant: { t1: [] },
        });

        await syncWorkSchedules(db);
        expect(db.employeeSchedule.findMany).not.toHaveBeenCalled();
    });

    it('reads employees once per tenant, not once per employee', async () => {
        // A tenant with 500 staff would otherwise make 500 round trips on every
        // boot.
        const { db } = buildDb({
            tenants: [{ id: 't1' }, { id: 't2' }],
            employeesByTenant: {
                t1: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })),
                t2: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` })),
            },
        });

        await syncWorkSchedules(db);
        expect(db.employee.findMany).toHaveBeenCalledTimes(2);
        expect(db.employeeSchedule.createMany).toHaveBeenCalledTimes(2);
    });
});
