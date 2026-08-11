import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CrmPhotosService } from './crm-photos.service';
import { AssetsService } from '../assets/assets.service';

// 1x1 transparent PNG.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('CrmPhotosService', () => {
    let service: CrmPhotosService;
    let assets: any;

    const TENANT = 'tenant-1';

    beforeEach(async () => {
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn().mockResolvedValue({
                url: 'https://cdn.example/photo.jpg',
                publicId: 'retail/tenant-1/crm-photos/photo',
                bytes: 4,
            }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [CrmPhotosService, { provide: AssetsService, useValue: assets }],
        }).compile();

        service = module.get<CrmPhotosService>(CrmPhotosService);
    });

    describe('upload', () => {
        it('stores the image in the tenant folder and returns url + storage key', async () => {
            const result = await service.upload(TENANT, {
                imageBase64: `data:image/png;base64,${PNG_BASE64}`,
                fileName: 'Rahim Uddin.png',
            });

            expect(result).toEqual({
                url: 'https://cdn.example/photo.jpg',
                storageKey: 'retail/tenant-1/crm-photos/photo',
            });
            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                'tenant-1/crm-photos',
                'Rahim-Uddin',
                'image',
            );
        });

        it('falls back to a safe stem when no filename is given', async () => {
            await service.upload(TENANT, { imageBase64: PNG_BASE64 });
            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                'tenant-1/crm-photos',
                'photo',
                'image',
            );
        });

        it('fails clearly when storage is not configured', async () => {
            assets.isEnabled.mockReturnValue(false);
            await expect(service.upload(TENANT, { imageBase64: PNG_BASE64 })).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        it('reports an upload failure as unavailable rather than leaking the driver error', async () => {
            assets.uploadBuffer.mockRejectedValue(new Error('cloudinary exploded'));
            await expect(service.upload(TENANT, { imageBase64: PNG_BASE64 })).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
        });

        it('rejects an unsupported image type', async () => {
            await expect(
                service.upload(TENANT, { imageBase64: `data:image/gif;base64,${PNG_BASE64}` }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('assertTenantPhotoKey', () => {
        it('accepts a key inside the tenant folder', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-1/crm-photos/abc'),
            ).not.toThrow();
        });

        it('treats an absent or cleared key as nothing to check', () => {
            expect(() => service.assertTenantPhotoKey(TENANT, null)).not.toThrow();
            expect(() => service.assertTenantPhotoKey(TENANT, undefined)).not.toThrow();
            expect(() => service.assertTenantPhotoKey(TENANT, '')).not.toThrow();
        });

        it("rejects another tenant's key — this is the cross-tenant delete vector", () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-2/crm-photos/abc'),
            ).toThrow(BadRequestException);
        });

        it('rejects a key in a different folder of the same tenant', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-1/contact-cards/abc'),
            ).toThrow(BadRequestException);
        });

        it('rejects a key that only mentions the tenant folder later in the string', () => {
            expect(() =>
                service.assertTenantPhotoKey(TENANT, 'retail/tenant-2/x/retail/tenant-1/crm-photos/abc'),
            ).toThrow(BadRequestException);
        });
    });
});
