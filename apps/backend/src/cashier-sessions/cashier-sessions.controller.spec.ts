import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { POS_STAFF } from '../auth/permission-sets';
import { CashierSessionsController } from './cashier-sessions.controller';

describe('CashierSessionsController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'CASHIER', timezone: 'Asia/Dhaka' } as any;
    const service = {
        openSession: jest.fn(),
        getSessionsByStore: jest.fn(),
        getOpenSessionsByStore: jest.fn(),
        getOverview: jest.fn(),
    };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new CashierSessionsController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('reads sessions for a branch the caller may use, one branch only', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.getSessionsByStore(tenant, 's1');
        await controller.getOpenSessionsByStore(tenant, 's1');
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: POS_STAFF, allowAll: false });
        expect(service.getSessionsByStore).toHaveBeenCalledWith('t1', 's1');
        expect(service.getOpenSessionsByStore).toHaveBeenCalledWith('t1', 's1');
    });

    // Regression: the path id was trusted, so any branch's tills were readable.
    it('refuses a foreign branch in the path before reading', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.getSessionsByStore(tenant, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.getOpenSessionsByStore(tenant, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.getSessionsByStore).not.toHaveBeenCalled();
        expect(service.getOpenSessionsByStore).not.toHaveBeenCalled();
    });

    it("refuses 'all' in the path", async () => {
        branchScope.resolveStoreId.mockRejectedValue(new BadRequestException());
        await expect(controller.getSessionsByStore(tenant, 'all')).rejects.toBeInstanceOf(BadRequestException);
        expect(service.getSessionsByStore).not.toHaveBeenCalled();
    });

    it('opens a session only in a branch the caller may use', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(
            controller.openSession(tenant, { storeId: 'foreign', openingCash: 0 } as any),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.openSession).not.toHaveBeenCalled();

        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.openSession(tenant, { storeId: 's1', openingCash: 100 } as any);
        expect(service.openSession).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ storeId: 's1', openingCash: 100 }));
    });

    describe('overview', () => {
        it("lets 'all' through to the whole tenant for a caller who may see it", async () => {
            branchScope.resolveStoreId.mockResolvedValue(undefined);
            await controller.getOverview(tenant, { storeId: 'all' });
            // Unlike the per-store reads, `all` is allowed here.
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 'all', { permissions: POS_STAFF });
            expect(service.getOverview).toHaveBeenCalledWith('t1', undefined, 'Asia/Dhaka');
        });

        it('reads one branch the caller may use', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await controller.getOverview(tenant, {});
            expect(service.getOverview).toHaveBeenCalledWith('t1', 's1', 'Asia/Dhaka');
        });

        it('refuses a branch the caller cannot use before reading', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(controller.getOverview(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
            expect(service.getOverview).not.toHaveBeenCalled();
        });
    });
});
