import { StorePermission } from '@erp71/shared-types';
import { PayrollRunsController } from './payroll-runs.controller';

describe('PayrollRunsController — adjustment branch', () => {
    const member = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = {
        listAdjustments: jest.fn(),
        createAdjustment: jest.fn(),
        deleteAdjustment: jest.fn(),
    };
    const branchScope = { resolveStoreId: jest.fn(), canSeeAllBranches: jest.fn() };
    const controller = new PayrollRunsController(service as any, {} as any, branchScope as any);

    beforeEach(() => {
        jest.clearAllMocks();
        branchScope.resolveStoreId.mockResolvedValue('s1');
        branchScope.canSeeAllBranches.mockResolvedValue(false);
    });

    it('lists adjustments for the caller’s branch', async () => {
        await controller.listAdjustments(member, { year: 2026, month: 10 } as any);
        expect(service.listAdjustments).toHaveBeenCalledWith('t1', 2026, 10, {
            consolidated: false,
            storeId: 's1',
        });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, undefined, {
            permissions: [StorePermission.VIEW_PAYROLL],
        });
    });

    it('creates an adjustment only for an employee at the caller’s branch', async () => {
        const dto = { employee_id: 'e1', year: 2026, month: 10, kind: 'EARNING', name: 'Bonus', amount: 10 };
        await controller.createAdjustment(member, dto as any);
        expect(service.createAdjustment).toHaveBeenCalledWith('t1', dto, 'u1', {
            consolidated: false,
            storeId: 's1',
        });
    });

    it('deletes an adjustment only when the employee is at the caller’s branch', async () => {
        await controller.deleteAdjustment(member, 'adj-1');
        expect(service.deleteAdjustment).toHaveBeenCalledWith('t1', 'adj-1', {
            consolidated: false,
            storeId: 's1',
        });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, undefined, {
            permissions: [StorePermission.MANAGE_HR],
        });
    });
});
