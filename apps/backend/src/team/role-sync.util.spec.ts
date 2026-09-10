import { setMemberRoles, syncMemberPermissionsFromRoles } from './role-sync.util';
import { StorePermission } from '@erp71/shared-types';

/** A member holding `roleSets` — one inner array of permissions per role held. */
function membershipWith(userId: string, roleSets: StorePermission[][]) {
    return {
        user_id: userId,
        roles: roleSets.map((permissions) => ({
            tenantRole: { permissions: permissions.map((permission) => ({ permission })) },
        })),
    };
}

describe('syncMemberPermissionsFromRoles', () => {
    it('rewrites UserStorePermission for each user×store access', async () => {
        const tx = {
            tenantUser: {
                findMany: jest.fn().mockResolvedValue([
                    membershipWith('u1', [[StorePermission.CREATE_SALE, StorePermission.VIEW_LEDGER]]),
                ]),
            },
            userStoreAccess: {
                findMany: jest.fn().mockResolvedValue([
                    { user_id: 'u1', store_id: 's1' },
                    { user_id: 'u1', store_id: 's2' },
                ]),
            },
            userStorePermission: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
                createMany: jest.fn().mockResolvedValue({ count: 4 }),
            },
        };

        const count = await syncMemberPermissionsFromRoles(tx, {
            tenantId: 't1',
            userIds: ['u1'],
            grantedBy: 'owner',
        });

        expect(count).toBe(1);
        expect(tx.userStorePermission.deleteMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', user_id: { in: ['u1'] } },
        });
        expect(tx.userStorePermission.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({
                    user_id: 'u1',
                    store_id: 's1',
                    permission: StorePermission.CREATE_SALE,
                }),
            ]),
            skipDuplicates: true,
        });
        // 2 permissions × 2 branches.
        expect(tx.userStorePermission.createMany.mock.calls[0][0].data).toHaveLength(4);
    });

    it('grants the union of every role the member holds, without duplicates', async () => {
        const tx = {
            tenantUser: {
                findMany: jest.fn().mockResolvedValue([
                    membershipWith('u1', [
                        [StorePermission.CREATE_SALE, StorePermission.VIEW_PRODUCT_CATALOG],
                        [StorePermission.VIEW_LEDGER, StorePermission.VIEW_PRODUCT_CATALOG],
                    ]),
                ]),
            },
            userStoreAccess: {
                findMany: jest.fn().mockResolvedValue([{ user_id: 'u1', store_id: 's1' }]),
            },
            userStorePermission: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 3 }),
            },
        };

        await syncMemberPermissionsFromRoles(tx, { tenantId: 't1', userIds: ['u1'], grantedBy: 'owner' });

        const written = tx.userStorePermission.createMany.mock.calls[0][0].data;
        expect(written.map((row: any) => row.permission).sort()).toEqual(
            [
                StorePermission.CREATE_SALE,
                StorePermission.VIEW_LEDGER,
                StorePermission.VIEW_PRODUCT_CATALOG,
            ].sort(),
        );
    });

    it('leaves a member with no roles holding no permissions', async () => {
        const tx = {
            tenantUser: { findMany: jest.fn().mockResolvedValue([membershipWith('u1', [])]) },
            userStoreAccess: {
                findMany: jest.fn().mockResolvedValue([{ user_id: 'u1', store_id: 's1' }]),
            },
            userStorePermission: {
                deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
                createMany: jest.fn(),
            },
        };

        await syncMemberPermissionsFromRoles(tx, { tenantId: 't1', userIds: ['u1'], grantedBy: 'owner' });

        expect(tx.userStorePermission.deleteMany).toHaveBeenCalled();
        expect(tx.userStorePermission.createMany).not.toHaveBeenCalled();
    });

    it('returns 0 when userIds is empty', async () => {
        const count = await syncMemberPermissionsFromRoles({} as any, {
            tenantId: 't1',
            userIds: [],
            grantedBy: 'o',
        });
        expect(count).toBe(0);
    });
});

describe('setMemberRoles', () => {
    function txFor(membershipId: string | null) {
        return {
            tenantUser: {
                findUnique: jest.fn().mockResolvedValue(membershipId ? { id: membershipId } : null),
                findMany: jest.fn().mockResolvedValue([membershipWith('u1', [[StorePermission.CREATE_SALE]])]),
            },
            tenantUserRole: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            userStoreAccess: { findMany: jest.fn().mockResolvedValue([]) },
            userStorePermission: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn(),
            },
        };
    }

    it('drops the roles no longer held and adds the new ones', async () => {
        const tx = txFor('tu1');

        await setMemberRoles(tx, {
            tenantId: 't1',
            userId: 'u1',
            tenantRoleIds: ['r1', 'r2'],
            grantedBy: 'owner',
        });

        expect(tx.tenantUserRole.deleteMany).toHaveBeenCalledWith({
            where: { tenant_user_id: 'tu1', tenant_role_id: { notIn: ['r1', 'r2'] } },
        });
        expect(tx.tenantUserRole.createMany).toHaveBeenCalledWith({
            data: [
                { tenant_user_id: 'tu1', tenant_role_id: 'r1' },
                { tenant_user_id: 'tu1', tenant_role_id: 'r2' },
            ],
            skipDuplicates: true,
        });
    });

    it('does nothing when the user is not a member of the tenant', async () => {
        const tx = txFor(null);

        await setMemberRoles(tx, {
            tenantId: 't1',
            userId: 'ghost',
            tenantRoleIds: ['r1'],
            grantedBy: 'owner',
        });

        expect(tx.tenantUserRole.deleteMany).not.toHaveBeenCalled();
        expect(tx.tenantUserRole.createMany).not.toHaveBeenCalled();
    });
});
