import { createHash } from 'crypto';
import { BadRequestException, ForbiddenException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { AssetsController, UploadSignatureDto } from './assets.controller';
import { AssetsService } from './assets.service';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../database/tenant.decorator';

/**
 * The signing half of browser → Cloudinary uploads. The real `AssetsService`
 * and the real Cloudinary SDK sign here — only the database is faked — and the
 * signature is re-derived by hand below, so a test passing means Cloudinary
 * would accept exactly these parameters and nothing more.
 */
describe('AssetsController — POST /assets/upload-signature', () => {
    const ENV = {
        CLOUDINARY_CLOUD_NAME: 'erp71',
        CLOUDINARY_API_KEY: '123456789012345',
        CLOUDINARY_API_SECRET: 'shh-its-a-secret',
    };
    const saved: Record<string, string | undefined> = {};

    let controller: AssetsController;
    let db: { userStorePermission: { findFirst: jest.Mock } };

    const tenantA: TenantContext = {
        tenantId: 'tenant-a',
        storeId: 'store-a',
        userId: 'user-1',
        userRole: 'STAFF',
        timezone: 'Asia/Dhaka',
    };
    const tenantB: TenantContext = { ...tenantA, tenantId: 'tenant-b', storeId: 'store-b' };
    const owner: TenantContext = { ...tenantA, userRole: 'OWNER' };

    /** Cloudinary's own recipe: sorted `k=v` pairs joined by `&`, then the secret, SHA-1. */
    const expectedSignature = (params: Record<string, string>) =>
        createHash('sha1')
            .update(
                Object.keys(params)
                    .sort()
                    .map((key) => `${key}=${params[key]}`)
                    .join('&') + ENV.CLOUDINARY_API_SECRET,
            )
            .digest('hex');

    /** Grant exactly these permissions to the member. */
    const grant = (...permissions: StorePermission[]) =>
        db.userStorePermission.findFirst.mockImplementation(({ where }: any) =>
            Promise.resolve(permissions.includes(where.permission) ? { id: 'grant' } : null),
        );

    beforeAll(() => {
        for (const [key, value] of Object.entries(ENV)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    beforeEach(() => {
        db = { userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) } };
        // Built by hand rather than through a testing module: the controller's
        // TenantInterceptor drags in services this test has no use for.
        const service = new AssetsService();
        service.onModuleInit(); // reads the env
        controller = new AssetsController(service, db as unknown as DatabaseService);
    });

    it('signs exactly the params it returns, folder and formats included', async () => {
        grant(StorePermission.EDIT_PRODUCTS);

        const before = Math.floor(Date.now() / 1000);
        const signed = await controller.uploadSignature(tenantA, { purpose: 'product-image' });

        expect(signed).toMatchObject({
            cloudName: 'erp71',
            apiKey: ENV.CLOUDINARY_API_KEY,
            folder: 'retail/tenant-a/products',
            publicIdPrefix: 'retail/tenant-a/products/',
            resourceType: 'image',
            uploadUrl: 'https://api.cloudinary.com/v1_1/erp71/image/upload',
            allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
            maxBytes: 5 * 1024 * 1024,
        });
        expect(signed.params).toEqual({
            allowed_formats: 'jpg,jpeg,png,webp',
            folder: 'retail/tenant-a/products',
            timestamp: String(signed.timestamp),
            transformation: 'f_auto,q_auto',
        });
        expect(signed.timestamp).toBeGreaterThanOrEqual(before);
        expect(signed.signature).toBe(expectedSignature(signed.params));
        // The secret is what makes the signature mean anything.
        expect(JSON.stringify(signed)).not.toContain(ENV.CLOUDINARY_API_SECRET);
    });

    it('puts each tenant’s upload in that tenant’s own folder', async () => {
        const a = await controller.uploadSignature({ ...tenantA, userRole: 'OWNER' }, { purpose: 'crm-photo' });
        const b = await controller.uploadSignature({ ...tenantB, userRole: 'OWNER' }, { purpose: 'crm-photo' });

        expect(a.folder).toBe('retail/tenant-a/crm-photos');
        expect(b.folder).toBe('retail/tenant-b/crm-photos');
        // Changing the folder in the form post breaks the signature.
        expect(expectedSignature({ ...a.params, folder: b.folder })).not.toBe(a.signature);
    });

    it.each([
        ['product-image', 'retail/tenant-a/products'],
        ['print-template-image', 'retail/tenant-a/print-templates'],
        ['storefront-image', 'retail/tenant-a/storefront'],
        ['crm-photo', 'retail/tenant-a/crm-photos'],
        ['board-background', 'retail/tenant-a/project-boards'],
        ['sprint-background', 'retail/tenant-a/project-sprints'],
        ['avatar', 'retail/avatars/user-1'],
    ] as const)('%s lands in %s — the folder the server-side path uses', async (purpose, folder) => {
        const signed = await controller.uploadSignature(owner, { purpose });
        expect(signed.folder).toBe(folder);
    });

    it('rejects an unknown purpose', async () => {
        await expect(
            controller.uploadSignature(owner, { purpose: 'anything-goes' as any }),
        ).rejects.toBeInstanceOf(BadRequestException);

        // And the DTO refuses it before the handler runs.
        const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
        await expect(
            pipe.transform({ purpose: 'anything-goes' }, { type: 'body', metatype: UploadSignatureDto }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            pipe.transform({ purpose: 'avatar', folder: 'retail/tenant-b' }, { type: 'body', metatype: UploadSignatureDto }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a member who could not save what they upload', async () => {
        grant(StorePermission.CREATE_SALE);

        await expect(
            controller.uploadSignature(tenantA, { purpose: 'product-image' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            controller.uploadSignature(tenantA, { purpose: 'storefront-image' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('checks the permission in the member’s own workspace and store', async () => {
        grant(StorePermission.MANAGE_PROJECTS);

        await controller.uploadSignature(tenantA, { purpose: 'board-background' });

        expect(db.userStorePermission.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ user_id: 'user-1', tenant_id: 'tenant-a', store_id: 'store-a' }),
            }),
        );
    });

    it('lets any member sign for their own avatar', async () => {
        const signed = await controller.uploadSignature(tenantA, { purpose: 'avatar' });

        expect(signed.folder).toBe('retail/avatars/user-1');
        expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
    });

    it('answers 503 when Cloudinary is not configured, so the browser falls back', async () => {
        const service = new AssetsService(); // never initialised: no credentials
        const bare = new AssetsController(service, db as unknown as DatabaseService);

        await expect(bare.uploadSignature(owner, { purpose: 'avatar' })).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});
