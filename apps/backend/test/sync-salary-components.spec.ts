import { syncSalaryComponents, DEFAULT_COMPONENTS } from '../../../packages/database/prisma/sync-salary-components';

/**
 * Runs on every deploy, so the property under test is inertness on the second
 * run — not correctness on the first.
 */
describe('syncSalaryComponents', () => {
    const buildDb = (state: { tenants?: { id: string }[]; countsByTenant?: Record<string, number> }) => {
        const created: any[] = [];
        const db = {
            tenant: { findMany: jest.fn().mockResolvedValue(state.tenants ?? []) },
            salaryComponent: {
                count: jest.fn(async ({ where }: any) => state.countsByTenant?.[where.tenant_id] ?? 0),
                createMany: jest.fn(async ({ data }: any) => {
                    created.push(...data);
                    return { count: data.length };
                }),
            },
        };
        return { db, created };
    };

    it('seeds the standard split for a tenant with no components', async () => {
        const { db, created } = buildDb({ tenants: [{ id: 't1' }] });

        const result = await syncSalaryComponents(db);

        expect(result.tenantsSeeded).toBe(1);
        expect(result.componentsCreated).toBe(DEFAULT_COMPONENTS.length);
        expect(created.map((c) => c.name)).toEqual([
            'Basic', 'House Rent', 'Medical Allowance', 'Conveyance', 'Provident Fund',
        ]);
    });

    it('marks exactly one component as basic', async () => {
        const { db, created } = buildDb({ tenants: [{ id: 't1' }] });
        await syncSalaryComponents(db);
        expect(created.filter((c) => c.is_basic)).toHaveLength(1);
        expect(created.find((c) => c.is_basic)?.name).toBe('Basic');
    });

    it('never makes the basic component a percentage of itself', async () => {
        // That would make every structure circular.
        const { db, created } = buildDb({ tenants: [{ id: 't1' }] });
        await syncSalaryComponents(db);
        expect(created.find((c) => c.is_basic)?.calculation).toBe('FIXED');
    });

    it('is inert on a second run', async () => {
        const { db, created } = buildDb({
            tenants: [{ id: 't1' }],
            countsByTenant: { t1: DEFAULT_COMPONENTS.length },
        });

        const result = await syncSalaryComponents(db);

        expect(result.tenantsSeeded).toBe(0);
        expect(result.tenantsAlreadyConfigured).toBe(1);
        expect(created).toHaveLength(0);
    });

    it('leaves a tenant that curated its list down to one component alone', async () => {
        // Re-adding the defaults every deploy is worse than respecting a list
        // somebody deliberately trimmed.
        const { db } = buildDb({ tenants: [{ id: 't1' }], countsByTenant: { t1: 1 } });
        const result = await syncSalaryComponents(db);
        expect(result.tenantsSeeded).toBe(0);
    });

    it('seeds only the tenants that need it', async () => {
        const { db } = buildDb({
            tenants: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
            countsByTenant: { t2: 5 },
        });

        const result = await syncSalaryComponents(db);

        expect(result.tenantsScanned).toBe(3);
        expect(result.tenantsSeeded).toBe(2);
        expect(result.tenantsAlreadyConfigured).toBe(1);
    });

    it('writes nothing on a dry run but reports what it would do', async () => {
        const { db, created } = buildDb({ tenants: [{ id: 't1' }] });
        const result = await syncSalaryComponents(db, { dryRun: true });
        expect(result.tenantsSeeded).toBe(1);
        expect(created).toHaveLength(0);
    });

    it('does not touch employee salary structures', async () => {
        // The deliberate omission: backfilling structures would stamp an
        // effective date nobody chose and silently stop Employee.basic_salary
        // affecting pay.
        const { db } = buildDb({ tenants: [{ id: 't1' }] });
        await syncSalaryComponents(db);
        expect(Object.keys(db)).not.toContain('employeeSalaryStructure');
    });
});
