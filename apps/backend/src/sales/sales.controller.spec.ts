import { SalesController } from './sales.controller';

/**
 * Nest binds each `@Query` by name, so the order of `findAll`'s parameters is
 * free; what has to hold is that the sale-date window reaches the service under
 * its own keys, apart from the created-date one.
 */
describe('SalesController.findAll', () => {
    it('hands dateFrom/dateTo to the service next to createdFrom/createdTo', async () => {
        const service = { findAll: jest.fn().mockResolvedValue({ items: [] }) };
        const branchScope = { resolveStoreId: jest.fn().mockResolvedValue('s1') };
        const controller = new SalesController(service as any, branchScope as any);
        const tenant = { tenantId: 't1', userId: 'u1', timezone: 'Asia/Dhaka' } as any;

        await controller.findAll(
            tenant,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            '2026-10-01', '2026-10-13', 's1', '2026-10-12T18:00', '2026-10-13T02:00',
        );

        expect(service.findAll).toHaveBeenCalledWith('t1', expect.objectContaining({
            createdFrom: '2026-10-01',
            createdTo: '2026-10-13',
            dateFrom: '2026-10-12T18:00',
            dateTo: '2026-10-13T02:00',
            timezone: 'Asia/Dhaka',
        }));
    });
});
