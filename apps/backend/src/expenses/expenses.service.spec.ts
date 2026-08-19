import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
    let service: ExpensesService;
    let db: {
        expenseEntry: { findMany: jest.Mock; count: jest.Mock };
    };

    beforeEach(() => {
        db = {
            expenseEntry: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
        };
        service = new ExpensesService(db as any);
    });

    it('listEntries() should filter created_at to the inclusive Dhaka day range', async () => {
        await service.listEntries('tenant-1', {
            page: 1,
            limit: 20,
            createdFrom: '2026-08-19',
            createdTo: '2026-08-19',
        });

        expect(db.expenseEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    created_at: {
                        gte: new Date('2026-08-18T18:00:00.000Z'),
                        lte: new Date('2026-08-19T17:59:59.999Z'),
                    },
                }),
            }),
        );
    });
});
