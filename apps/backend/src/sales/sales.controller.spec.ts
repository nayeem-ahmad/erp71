import { BadRequestException } from '@nestjs/common';
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

describe('SalesController list filters', () => {
    const tenant = { tenantId: 't1', userId: 'u1', timezone: 'Asia/Dhaka' } as any;
    const make = () => {
        const service = {
            findAll: jest.fn().mockResolvedValue({ items: [] }),
            summary: jest.fn().mockResolvedValue({ count: 0 }),
        };
        const branchScope = { resolveStoreId: jest.fn().mockResolvedValue('s1') };
        return { service, controller: new SalesController(service as any, branchScope as any) };
    };
    /** Every list param up to `filters`, blank, then the new ones. */
    const blanks = (n: number) => Array.from({ length: n }, () => undefined);

    it('reads the filter row\'s params into the service options', async () => {
        const { service, controller } = make();

        await controller.findAll(
            tenant, ...(blanks(13) as []),
            'true', 'c1,none', 'r1', 'pm-1,pm-2', 'partial,unpaid', 'between:100,500', 'gt:0',
        );

        expect(service.findAll).toHaveBeenCalledWith('t1', expect.objectContaining({
            statusExclude: true,
            customerIds: ['c1', 'none'],
            salesRepIds: ['r1'],
            paymentMethodIds: ['pm-1', 'pm-2'],
            paymentStatus: ['partial', 'unpaid'],
            total: { op: 'between', value: 100, to: 500 },
            paid: { op: 'gt', value: 0 },
        }));
    });

    it('refuses a payment status it does not know', async () => {
        const { controller } = make();
        await expect(
            controller.findAll(tenant, ...(blanks(17) as []), 'overdue'),
        ).rejects.toThrow(BadRequestException);
    });

    it('serves the stats strip from the same filters, branch included', async () => {
        const { service, controller } = make();

        await controller.summary(
            tenant, undefined, 'INV', 'COMPLETED', undefined, undefined, 'all', '2026-10-01', '2026-10-26',
            undefined, undefined, undefined, undefined, undefined, undefined, 'gt:1000',
        );

        expect(service.summary).toHaveBeenCalledWith('t1', expect.objectContaining({
            storeId: 's1',
            search: 'INV',
            status: 'COMPLETED',
            dateFrom: '2026-10-01',
            dateTo: '2026-10-26',
            total: { op: 'gt', value: 1000 },
            timezone: 'Asia/Dhaka',
        }));
    });
});
