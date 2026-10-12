import { Prisma } from '@prisma/client';
import { OnlineBranchService } from './online-branch.service';

describe('OnlineBranchService', () => {
    let db: any;
    let tx: any;
    let authCache: { invalidateTenant: jest.Mock };
    let service: OnlineBranchService;

    beforeEach(() => {
        tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            tenant: { findUnique: jest.fn().mockResolvedValue({ online_store_id: null }), update: jest.fn() },
            store: {
                findMany: jest.fn().mockResolvedValue([{ name: 'Dhaka' }]),
                create: jest.fn().mockResolvedValue({ id: 'online-1' }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            tenantUser: { findMany: jest.fn().mockResolvedValue([{ user_id: 'owner-1' }, { user_id: 'owner-2' }]) },
            userStoreAccess: { createMany: jest.fn() },
        };
        db = {
            tenant: { findUnique: jest.fn().mockResolvedValue({ online_store_id: null }) },
            $transaction: jest.fn(async (fn: (t: any) => Promise<unknown>) => fn(tx)),
        };
        authCache = { invalidateTenant: jest.fn() };
        service = new OnlineBranchService(db, authCache as any);
    });

    it('returns the existing online branch without creating anything', async () => {
        db.tenant.findUnique.mockResolvedValue({ online_store_id: 'online-0' });

        await expect(service.ensure('t1')).resolves.toBe('online-0');
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('creates "Online Store" once, gives every owner access, and points the tenant at it', async () => {
        await expect(service.ensure('t1')).resolves.toBe('online-1');

        expect(tx.store.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ tenant_id: 't1', name: 'Online Store' }),
        }));
        expect(tx.userStoreAccess.createMany).toHaveBeenCalledWith({
            data: [
                { user_id: 'owner-1', store_id: 'online-1', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
                { user_id: 'owner-2', store_id: 'online-1', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
            ],
            skipDuplicates: true,
        });
        expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { online_store_id: 'online-1' } });
        // Every owner's branch list just grew.
        expect(authCache.invalidateTenant).toHaveBeenCalledWith('t1');
    });

    it('serialises concurrent first calls on the tenant row, and the second finds the first one\'s branch', async () => {
        tx.tenant.findUnique.mockResolvedValue({ online_store_id: 'online-raced' });

        await expect(service.ensure('t1')).resolves.toBe('online-raced');
        expect(tx.$queryRaw).toHaveBeenCalled();
        expect(tx.store.create).not.toHaveBeenCalled();
    });

    it('steps past a branch already named "Online Store"', async () => {
        tx.store.findMany.mockResolvedValue([{ name: 'online store' }]);

        await service.ensure('t1');

        expect(tx.store.create.mock.calls[0][0].data.name).toBe('Online Store 2');
    });

    it('re-reads after a unique conflict instead of failing the sign-up', async () => {
        db.$transaction.mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );
        db.tenant.findUnique
            .mockResolvedValueOnce({ online_store_id: null })
            .mockResolvedValueOnce({ online_store_id: 'online-other' });

        await expect(service.ensure('t1')).resolves.toBe('online-other');
    });
});
