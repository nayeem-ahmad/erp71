import { ForbiddenException } from '@nestjs/common';
import { PURCHASE_READ } from '../auth/permission-sets';
import { PurchaseReportsController } from './purchase-reports.controller';

describe('PurchaseReportsController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = {
        getPurchaseSummary: jest.fn(),
        getPurchaseTrend: jest.fn(),
        getPurchasesByProduct: jest.fn(),
        getPurchasesBySupplier: jest.fn(),
    };
    const lineItems = { getPurchaseLineItems: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new PurchaseReportsController(service as any, lineItems as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('line items: hands the service the resolved branch', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.getPurchaseLineItems(tenant, { storeId: 's1' } as any);
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: PURCHASE_READ });
        expect(lineItems.getPurchaseLineItems).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1' }), 'Asia/Dhaka');
    });

    // Regression: the line items trusted `?storeId=` as sent.
    it('line items: refuses a branch the caller cannot use before reading', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.getPurchaseLineItems(tenant, { storeId: 'foreign' } as any)).rejects.toBeInstanceOf(ForbiddenException);
        expect(lineItems.getPurchaseLineItems).not.toHaveBeenCalled();
    });

    describe.each(['getPurchaseSummary', 'getPurchaseTrend', 'getPurchasesByProduct', 'getPurchasesBySupplier'] as const)(
        '%s',
        (method) => {
            const call = (query: any) => (controller as any)[method](tenant, query);

            it('hands the service the resolved branch', async () => {
                branchScope.resolveStoreId.mockResolvedValue('s2');
                await call({ storeId: 's2' });
                expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's2', { permissions: PURCHASE_READ });
                expect(service[method]).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's2' }));
            });

            it('refuses a branch the caller cannot use before reading', async () => {
                branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
                await expect(call({ storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
                expect(service[method]).not.toHaveBeenCalled();
            });
        },
    );
});
