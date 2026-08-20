import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { HrReportsController } from './hr-reports.controller';
import { HrReportsService } from './hr-reports.service';

/**
 * Instantiated directly rather than through a Nest testing module: nothing here
 * exercises the HTTP layer, and standing one up would drag in
 * `TenantInterceptor` and its `DatabaseService` for assertions that are pure
 * reflection and delegation.
 */
describe('HrReportsController', () => {
    let controller: HrReportsController;
    let service: {
        attendanceSummary: jest.Mock;
        leaveBalance: jest.Mock;
        payrollCost: jest.Mock;
    };

    const tenant = { tenantId: 'tenant-1', userId: 'user-1', userRole: 'STAFF' } as any;

    beforeEach(() => {
        service = {
            attendanceSummary: jest.fn().mockResolvedValue({ rows: [] }),
            leaveBalance: jest.fn().mockResolvedValue({ rows: [] }),
            payrollCost: jest.fn().mockResolvedValue({ rows: [] }),
        };
        controller = new HrReportsController(service as unknown as HrReportsService);
    });

    const permissionsOn = (method: 'attendanceSummary' | 'leaveBalance' | 'payrollCost') =>
        Reflect.getMetadata(STORE_PERMISSIONS_KEY, HrReportsController.prototype[method]);

    /**
     * The permission split is the design decision on this controller, not an
     * implementation detail: days are VIEW_HR so an HR officer with no pay
     * access can still run them, money is VIEW_PAYROLL. A decorator dropped in
     * a refactor would hand payroll cost to everyone holding VIEW_HR.
     */
    it('gates the days reports on VIEW_HR', () => {
        expect(permissionsOn('attendanceSummary')).toEqual([StorePermission.VIEW_HR]);
        expect(permissionsOn('leaveBalance')).toEqual([StorePermission.VIEW_HR]);
    });

    it('gates payroll cost on VIEW_PAYROLL', () => {
        expect(permissionsOn('payrollCost')).toEqual([StorePermission.VIEW_PAYROLL]);
    });

    /**
     * The leave report gets the whole tenant context, not just the id — it
     * needs the user to decide whether the money columns are permitted. The
     * other two only ever need the tenant to scope by.
     */
    it('passes the tenant context to the leave report so it can check pay access', async () => {
        await controller.leaveBalance(tenant, { year: 2026 } as any);

        expect(service.leaveBalance).toHaveBeenCalledWith(tenant, { year: 2026 });
    });

    it('scopes the other two reports to the tenant id', async () => {
        const query = { fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 3 } as any;

        await controller.attendanceSummary(tenant, query);
        await controller.payrollCost(tenant, query);

        expect(service.attendanceSummary).toHaveBeenCalledWith('tenant-1', query);
        expect(service.payrollCost).toHaveBeenCalledWith('tenant-1', query);
    });
});
