import { PAYROLL_READ, PAYROLL_WRITE } from '../auth/permission-sets';
import { SalaryPaymentsController } from './salary-payments.controller';

describe('SalaryPaymentsController — home branch', () => {
    const member = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = {
        list: jest.fn(),
        getSummary: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
    };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new SalaryPaymentsController(service as any, branchScope as any);

    beforeEach(() => {
        jest.clearAllMocks();
        branchScope.resolveStoreId.mockResolvedValue('store-bb');
    });

    it('lists payments for the caller’s branch', async () => {
        await controller.list(member, { page: 1 } as any);
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, undefined, { permissions: PAYROLL_READ });
        expect(service.list).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 'store-bb' }));
    });

    it('hides a payment the caller’s branch does not own', async () => {
        await controller.findOne(member, 'p1');
        expect(service.findOne).toHaveBeenCalledWith('t1', 'p1', 'store-bb');
    });

    it('pays only an employee at the caller’s branch', async () => {
        const dto = { employeeId: 'e1', amount: 10, payPeriod: '2026-10', paymentDate: '2026-10-29' };
        await controller.create(member, dto as any);
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, undefined, { permissions: PAYROLL_WRITE });
        expect(service.create).toHaveBeenCalledWith('t1', 'u1', dto, 'store-bb');
    });
});
