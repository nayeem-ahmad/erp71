import { SupportController } from './support.controller';

const TENANT = { tenantId: 'ten-1', userId: 'usr-1' } as any;

function makeController() {
    const db: any = {
        supportThread: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
    const support: any = {
        assertInboxEnabled: jest.fn().mockResolvedValue({ support: true, feedback: true }),
    };
    return { controller: new SupportController(db, support), db, support };
}

/** The `where` the controller handed Prisma on the most recent call. */
const whereOf = (db: any) => db.supportThread.findMany.mock.calls.at(-1)[0].where;

describe('SupportController.listThreads', () => {
    it('scopes to the caller’s tenant and adds nothing when no filter is passed', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT);

        expect(whereOf(db)).toEqual({ tenantId: 'ten-1' });
    });

    it('searches the subject and the message bodies', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT, 'printer');

        expect(whereOf(db)).toEqual({
            tenantId: 'ten-1',
            OR: [
                { subject: { contains: 'printer', mode: 'insensitive' } },
                { messages: { some: { body: { contains: 'printer', mode: 'insensitive' } } } },
            ],
        });
    });

    it('treats a whitespace-only term as no search at all', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT, '   ');

        expect(whereOf(db)).toEqual({ tenantId: 'ten-1' });
    });

    it('filters by status, and ignores a status that is not one of ours', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT, undefined, 'resolved');
        expect(whereOf(db)).toEqual({ tenantId: 'ten-1', status: 'resolved' });

        await controller.listThreads(TENANT, undefined, 'deleted');
        expect(whereOf(db)).toEqual({ tenantId: 'ten-1' });
    });

    it('filters by category, and folds "feedback" into the three feedback types', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT, undefined, undefined, 'bug');
        expect(whereOf(db)).toEqual({ tenantId: 'ten-1', category: 'bug' });

        await controller.listThreads(TENANT, undefined, undefined, 'feedback');
        expect(whereOf(db)).toEqual({
            tenantId: 'ten-1',
            category: { in: ['bug', 'feature', 'general'] },
        });
    });

    it('combines search, status and category', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(TENANT, 'printer', 'open', 'support');

        expect(whereOf(db)).toEqual({
            tenantId: 'ten-1',
            status: 'open',
            category: 'support',
            OR: [
                { subject: { contains: 'printer', mode: 'insensitive' } },
                { messages: { some: { body: { contains: 'printer', mode: 'insensitive' } } } },
            ],
        });
    });

    it('checks the inbox is switched on before reading anything', async () => {
        const { controller, support, db } = makeController();
        support.assertInboxEnabled.mockRejectedValue(new Error('Support is not available'));

        await expect(controller.listThreads(TENANT)).rejects.toThrow('Support is not available');
        expect(db.supportThread.findMany).not.toHaveBeenCalled();
    });
});
