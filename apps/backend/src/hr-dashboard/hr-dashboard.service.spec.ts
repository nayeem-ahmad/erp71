import { Test } from '@nestjs/testing';
import { HrDashboardService } from './hr-dashboard.service';
import { DatabaseService } from '../database/database.service';

const OWNER = { tenantId: 'tenant-1', userId: 'u1', storeId: 'store-1', userRole: 'OWNER' };
const STAFF = { tenantId: 'tenant-1', userId: 'u2', storeId: 'store-1', userRole: 'MANAGER' };

describe('HrDashboardService', () => {
    let service: HrDashboardService;
    let db: any;

    beforeEach(async () => {
        db = {
            employee: {
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _sum: { basic_salary: null } }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            attendanceRecord: {
                groupBy: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            leaveRequest: {
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _sum: { days: null } }),
            },
            salaryPayment: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            department: { findMany: jest.fn().mockResolvedValue([]) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
        };

        const moduleRef = await Test.createTestingModule({
            providers: [HrDashboardService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = moduleRef.get(HrDashboardService);
    });

    it('gives an owner the payroll figures without asking for a grant', async () => {
        db.salaryPayment.aggregate.mockResolvedValue({ _sum: { amount: 120_000 }, _count: { _all: 8 } });

        const result = await service.getOverview(OWNER, {});

        expect(result.can_view_payroll).toBe(true);
        expect(result.payroll?.paid_in_period).toBe(120_000);
        // Owners bypass permission checks everywhere else in the app.
        expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
    });

    it('withholds payroll from a user without the grant, without refusing the rest', async () => {
        const result = await service.getOverview(STAFF, {});

        expect(result.can_view_payroll).toBe(false);
        expect(result.payroll).toBeNull();
        expect(result.recent_payments).toEqual([]);
        // Headcount, attendance and leave are still there.
        expect(result.headcount).toBeDefined();
        expect(result.attendance).toBeDefined();
        expect(db.salaryPayment.aggregate).not.toHaveBeenCalled();
    });

    it('gives payroll to a non-owner who holds VIEW_PAYROLL on the store', async () => {
        db.userStorePermission.findFirst.mockResolvedValue({ id: 'grant-1' });

        const result = await service.getOverview(STAFF, {});

        expect(result.can_view_payroll).toBe(true);
        expect(result.payroll).not.toBeNull();
        expect(db.userStorePermission.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ permission: 'VIEW_PAYROLL', store_id: 'store-1' }),
            }),
        );
    });

    it('refuses payroll when there is no store context to check a grant against', async () => {
        const result = await service.getOverview({ ...STAFF, storeId: undefined }, {});

        expect(result.can_view_payroll).toBe(false);
    });

    it('counts a half day as half present, and leaves holidays out of the base', async () => {
        db.attendanceRecord.groupBy.mockResolvedValue([
            { status: 'PRESENT', _count: { _all: 6 } },
            { status: 'HALF_DAY', _count: { _all: 2 } },
            { status: 'ABSENT', _count: { _all: 2 } },
            { status: 'HOLIDAY', _count: { _all: 20 } },
        ]);

        const result = await service.getOverview(OWNER, {});

        // (6 + 1) / 10 — the twenty holidays are nobody failing to show up.
        expect(result.attendance.rate_pct).toBe(70);
        expect(result.attendance.records).toBe(10);
    });

    it('reports no attendance rate rather than zero when nothing was recorded', async () => {
        const result = await service.getOverview(OWNER, {});

        expect(result.attendance.rate_pct).toBeNull();
    });

    it('counts employees with no salary on file rather than quietly leaving them out of the bill', async () => {
        db.employee.aggregate.mockResolvedValue({ _sum: { basic_salary: 300_000 } });
        db.employee.count.mockResolvedValue(4);

        const result = await service.getOverview(OWNER, {});

        expect(result.payroll?.monthly_commitment).toBe(300_000);
        expect(result.payroll?.employees_without_salary).toBe(4);
    });

    it('counts someone on leave today by the span of their request, not its start date', async () => {
        await service.getOverview(OWNER, {});

        const onLeaveCall = db.leaveRequest.count.mock.calls
            .map((call: any[]) => call[0])
            .find((arg: any) => arg.where.end_date);

        expect(onLeaveCall.where.start_date.lte).toBeInstanceOf(Date);
        expect(onLeaveCall.where.end_date.gte).toBeInstanceOf(Date);
        expect(onLeaveCall.where.status).toBe('APPROVED');
    });

    it('names employees with no department rather than dropping them from the breakdown', async () => {
        db.employee.groupBy.mockResolvedValue([
            { department_id: 'd1', _count: { _all: 5 } },
            { department_id: null, _count: { _all: 2 } },
        ]);
        db.department.findMany.mockResolvedValue([{ id: 'd1', name: 'Warehouse' }]);

        const result = await service.getOverview(OWNER, {});

        expect(result.departments).toEqual([
            { id: 'd1', name: 'Warehouse', headcount: 5 },
            { id: null, name: 'Unassigned', headcount: 2 },
        ]);
    });

    it('buckets attendance trends by local calendar day and zero-fills the quiet ones', async () => {
        db.attendanceRecord.findMany.mockResolvedValue([
            { date: new Date(2026, 7, 2), status: 'PRESENT' },
            { date: new Date(2026, 7, 2), status: 'ABSENT' },
        ]);

        const result = await service.getTrends('tenant-1', { from: '2026-08-01', to: '2026-08-03' });

        expect(result.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
        expect(result.points[1]).toEqual({ date: '2026-08-02', present: 1, absent: 1, on_leave: 0 });
    });
});
