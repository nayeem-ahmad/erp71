import { ConflictException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';

const OWNER_CTX = { tenantId: 't1', userId: 'u-owner', userRole: 'OWNER', timezone: 'Asia/Dhaka' } as any;

describe('StoresService.rename', () => {
    const db = {
        store: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };
    let service: StoresService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new StoresService(db as any, { log: jest.fn() } as any);
    });

    it('renames a store that belongs to the tenant', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1', tenant_id: 't1' });
        db.store.update.mockResolvedValue({ id: 's1', name: 'Gulshan Branch' });
        const result = await service.rename('t1', 's1', '  Gulshan Branch  ');
        expect(db.store.findFirst).toHaveBeenCalledWith({ where: { id: 's1', tenant_id: 't1' } });
        expect(db.store.update).toHaveBeenCalledWith({
            where: { id: 's1' },
            data: { name: 'Gulshan Branch' },
            select: { id: true, name: true },
        });
        expect(result).toEqual({ id: 's1', name: 'Gulshan Branch' });
    });

    it('rejects a store from another tenant', async () => {
        db.store.findFirst.mockResolvedValue(null);
        await expect(service.rename('t1', 'sX', 'Anything')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.store.update).not.toHaveBeenCalled();
    });
});

describe('StoresService.create', () => {
    const tx = {
        store: { create: jest.fn() },
        tenantUser: { findMany: jest.fn(), findUnique: jest.fn() },
        userStoreAccess: { createMany: jest.fn() },
        userStorePermission: { createMany: jest.fn() },
    };
    const db = {
        store: { findFirst: jest.fn() },
        $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const audit = { log: jest.fn() };
    let service: StoresService;

    beforeEach(() => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation((fn: any) => fn(tx));
        db.store.findFirst.mockResolvedValue(null);
        tx.store.create.mockResolvedValue({ id: 's-new', name: 'Dhanmondi Branch', address: null });
        tx.tenantUser.findMany.mockResolvedValue([{ user_id: 'u-owner' }]);
        tx.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER', tenantRole: null });
        service = new StoresService(db as any, audit as any);
    });

    it('creates the branch with a trimmed name and a null address when none is given', async () => {
        const result = await service.create(OWNER_CTX, { name: '  Dhanmondi Branch  ' });
        expect(tx.store.create).toHaveBeenCalledWith({
            data: { tenant_id: 't1', name: 'Dhanmondi Branch', address: null },
            select: { id: true, name: true, address: true },
        });
        expect(result).toEqual({ id: 's-new', name: 'Dhanmondi Branch', address: null });
    });

    it('keeps a trimmed address when one is given', async () => {
        await service.create(OWNER_CTX, { name: 'Uttara', address: '  Sector 7  ' });
        expect(tx.store.create).toHaveBeenCalledWith({
            data: { tenant_id: 't1', name: 'Uttara', address: 'Sector 7' },
            select: { id: true, name: true, address: true },
        });
    });

    it('rejects a name another branch in the tenant already uses, case-insensitively', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1' });
        await expect(service.create(OWNER_CTX, { name: 'dhanmondi branch' })).rejects.toBeInstanceOf(
            ConflictException,
        );
        expect(db.store.findFirst).toHaveBeenCalledWith({
            where: { tenant_id: 't1', name: { equals: 'dhanmondi branch', mode: 'insensitive' } },
            select: { id: true },
        });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('grants every owner access, so a new branch is not invisible in /auth/me', async () => {
        tx.tenantUser.findMany.mockResolvedValue([{ user_id: 'u-owner' }, { user_id: 'u-owner-2' }]);
        await service.create(OWNER_CTX, { name: 'Mirpur' });
        expect(tx.userStoreAccess.createMany).toHaveBeenCalledWith({
            data: [
                { user_id: 'u-owner', store_id: 's-new', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
                { user_id: 'u-owner-2', store_id: 's-new', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
            ],
            skipDuplicates: true,
        });
    });

    it('adds a non-owner creator to the grant list alongside the owners', async () => {
        tx.tenantUser.findMany.mockResolvedValue([{ user_id: 'u-owner' }]);
        tx.tenantUser.findUnique.mockResolvedValue({ role: 'MANAGER', tenantRole: { permissions: [] } });
        await service.create({ ...OWNER_CTX, userId: 'u-manager', userRole: 'MANAGER' }, { name: 'Mirpur' });
        expect(tx.userStoreAccess.createMany).toHaveBeenCalledWith({
            data: [
                { user_id: 'u-owner', store_id: 's-new', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
                { user_id: 'u-manager', store_id: 's-new', tenant_id: 't1', access_level: 'MULTI_STORE_CAPABLE' },
            ],
            skipDuplicates: true,
        });
    });

    it("seeds a non-owner creator's role permissions on the new branch", async () => {
        tx.tenantUser.findUnique.mockResolvedValue({
            role: 'MANAGER',
            tenantRole: {
                permissions: [
                    { permission: 'MANAGE_STORES' },
                    { permission: 'SWITCH_STORES' },
                    { permission: 'NOT_A_REAL_PERMISSION' },
                ],
            },
        });
        await service.create({ ...OWNER_CTX, userId: 'u-manager', userRole: 'MANAGER' }, { name: 'Mirpur' });
        expect(tx.userStorePermission.createMany).toHaveBeenCalledWith({
            data: [
                {
                    user_id: 'u-manager',
                    store_id: 's-new',
                    tenant_id: 't1',
                    permission: 'MANAGE_STORES',
                    granted_by: 'u-manager',
                },
                {
                    user_id: 'u-manager',
                    store_id: 's-new',
                    tenant_id: 't1',
                    permission: 'SWITCH_STORES',
                    granted_by: 'u-manager',
                },
            ],
            skipDuplicates: true,
        });
    });

    it('seeds no permission rows for an owner, who bypasses the permission guard', async () => {
        await service.create(OWNER_CTX, { name: 'Mirpur' });
        expect(tx.userStorePermission.createMany).not.toHaveBeenCalled();
    });

    it('audit-logs the creation', async () => {
        await service.create(OWNER_CTX, { name: 'Dhanmondi Branch' });
        expect(audit.log).toHaveBeenCalledWith(
            'store.created',
            'Store',
            { userId: 'u-owner', tenantId: 't1' },
            's-new',
            { name: 'Dhanmondi Branch' },
        );
    });
});
