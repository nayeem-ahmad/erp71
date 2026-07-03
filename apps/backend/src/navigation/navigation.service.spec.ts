import { BadRequestException } from '@nestjs/common';
import { getDefaultNavLayout, NavScope } from '@erp71/shared-types';
import { NavigationService } from './navigation.service';

describe('NavigationService', () => {
    const platformSettings = {
        getRawValue: jest.fn(),
        upsertSettings: jest.fn(),
    };

    const db = {
        tenantNavLayout: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        tenant: {
            findFirst: jest.fn(),
        },
    };

    let service: NavigationService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new NavigationService(platformSettings as any, db as any);
    });

    it('returns default layout when nothing is stored', async () => {
        platformSettings.getRawValue.mockResolvedValue(null);
        db.tenantNavLayout.findUnique.mockResolvedValue(null);

        const result = await service.getLayout(NavScope.TENANT);

        expect(result.isDefault).toBe(true);
        expect(result.source).toBe('code_default');
        expect(result.layout).toEqual(getDefaultNavLayout(NavScope.TENANT));
    });

    it('pins a tenant to code defaults when reset', async () => {
        platformSettings.getRawValue.mockResolvedValue(JSON.stringify(getDefaultNavLayout(NavScope.TENANT)));
        db.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
        db.tenantNavLayout.upsert.mockResolvedValue({ tenant_id: 'tenant-1', layout: null });
        db.tenantNavLayout.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', layout: null });

        const result = await service.resetTenantNavLayout('tenant-1', 'admin-user');

        expect(db.tenantNavLayout.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenant_id: 'tenant-1' },
            create: expect.objectContaining({ layout: null }),
            update: expect.objectContaining({ layout: null }),
        }));
        expect(result.source).toBe('tenant_default_pin');
        expect(result.isDefault).toBe(true);
    });

    it('rejects invalid layout on save', async () => {
        await expect(
            service.saveLayout(NavScope.TENANT, [
                { id: 'unknown-node', parentId: null, sortOrder: 0, visible: true },
            ]),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists valid layout updates', async () => {
        const layout = getDefaultNavLayout(NavScope.TENANT);

        await service.saveLayout(NavScope.TENANT, layout, 'admin-user');

        expect(platformSettings.upsertSettings).toHaveBeenCalledWith(
            'navigation',
            expect.objectContaining({ tenant_layout: expect.any(String) }),
            'admin-user',
        );
    });

    it('clears all tenant overrides', async () => {
        db.tenantNavLayout.deleteMany.mockResolvedValue({ count: 3 });

        const result = await service.resetAllTenantNavLayouts('admin-user');

        expect(result.resetCount).toBe(3);
    });
});