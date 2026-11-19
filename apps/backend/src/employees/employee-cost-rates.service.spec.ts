import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeCostRatesService } from './employee-cost-rates.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('EmployeeCostRatesService', () => {
    let db: any;
    let audit: { log: jest.Mock };
    let service: EmployeeCostRatesService;

    beforeEach(() => {
        db = {
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', basic_salary: 41600 }) },
            employeeCostRate: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn(),
                create: jest.fn().mockResolvedValue({ id: 'r1' }),
                delete: jest.fn(),
            },
            projectCostingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        service = new EmployeeCostRatesService(db, audit as any);
    });

    it('shows what an hour costs today from the salary when no rate is set', async () => {
        const result = await service.list('t1', 'e1');

        expect(result.current).toEqual({ hourlyCost: 200, source: 'SALARY' });
        expect(result.derivedFromSalary).toBe(200);
        expect(result.rates).toEqual([]);
    });

    it('prefers a rate in force today, and still shows the salary figure beside it', async () => {
        db.employeeCostRate.findMany.mockResolvedValue([
            { id: 'r1', hourly_cost: 320, effective_from: day('2020-01-01'), note: 'Senior', created_at: new Date() },
        ]);

        const result = await service.list('t1', 'e1');

        expect(result.current).toEqual({ hourlyCost: 320, source: 'RATE' });
        expect(result.derivedFromSalary).toBe(200);
        expect(result.rates[0]).toEqual(expect.objectContaining({ hourlyCost: 320, effectiveFrom: '2020-01-01' }));
    });

    it('records and audits a new rate', async () => {
        await service.create('t1', 'e1', { hourlyCost: 300, effectiveFrom: '2026-09-01', note: ' Raise ' }, undefined, { userId: 'hr' });

        expect(db.employeeCostRate.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 't1',
                employee_id: 'e1',
                hourly_cost: 300,
                effective_from: day('2026-09-01'),
                note: 'Raise',
                created_by: 'hr',
            },
        });
        expect(audit.log).toHaveBeenCalledWith(
            'EMPLOYEE_COST_RATE_SET', 'Employee', { userId: 'hr', tenantId: 't1' }, 'e1',
            { hourly_cost: 300, effective_from: '2026-09-01' },
        );
    });

    it('answers a second rate on the same day with 409', async () => {
        db.employeeCostRate.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

        await expect(
            service.create('t1', 'e1', { hourlyCost: 300, effectiveFrom: '2026-09-01' }, undefined, {}),
        ).rejects.toThrow(ConflictException);
    });

    it('keeps the employee inside the caller\'s branch', async () => {
        db.employee.findFirst.mockResolvedValue(null);

        await expect(service.list('t1', 'e1', 'store-a')).rejects.toThrow(NotFoundException);
        expect(db.employee.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ store_id: 'store-a' }) }),
        );
    });

    it('removes only a rate that belongs to this employee', async () => {
        db.employeeCostRate.findFirst.mockResolvedValue(null);

        await expect(service.remove('t1', 'e1', 'r-other', undefined, {})).rejects.toThrow(NotFoundException);
        expect(db.employeeCostRate.delete).not.toHaveBeenCalled();
    });
});
