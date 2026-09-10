import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from '../assets/assets.service';
import { StorefrontMediaService, storefrontMediaFolder } from './storefront-media.service';

const PIXEL_BASE64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('StorefrontMediaService', () => {
    let service: StorefrontMediaService;

    const assets = {
        isEnabled: jest.fn(),
        uploadBuffer: jest.fn(),
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        assets.isEnabled.mockReturnValue(true);
        assets.uploadBuffer.mockResolvedValue({
            url: 'https://cdn.example/hero.png',
            publicId: 'retail/tenant-1/storefront/hero',
            bytes: 12,
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [StorefrontMediaService, { provide: AssetsService, useValue: assets }],
        }).compile();

        service = module.get(StorefrontMediaService);
    });

    it('stores the image under the tenant’s own storefront folder', async () => {
        const result = await service.upload('tenant-1', {
            imageBase64: PIXEL_BASE64,
            kind: 'hero',
            fileName: 'Shop Front.png',
        });

        expect(assets.uploadBuffer).toHaveBeenCalledWith(
            expect.any(Buffer),
            storefrontMediaFolder('tenant-1'),
            'hero-Shop-Front',
            'image',
        );
        expect(result).toEqual({ url: 'https://cdn.example/hero.png' });
    });

    it('falls back to the slot name when no filename is given', async () => {
        await service.upload('tenant-1', { imageBase64: PIXEL_BASE64, kind: 'logo' });

        expect(assets.uploadBuffer).toHaveBeenCalledWith(
            expect.any(Buffer),
            storefrontMediaFolder('tenant-1'),
            'logo-logo',
            'image',
        );
    });

    it('rejects a file type a browser could not render back', async () => {
        await expect(
            service.upload('tenant-1', {
                imageBase64: 'data:image/svg+xml;base64,PHN2Zy8+',
                kind: 'logo',
            }),
        ).rejects.toThrow(BadRequestException);
        expect(assets.uploadBuffer).not.toHaveBeenCalled();
    });

    it('says so plainly when storage is not configured', async () => {
        assets.isEnabled.mockReturnValue(false);

        await expect(
            service.upload('tenant-1', { imageBase64: PIXEL_BASE64, kind: 'hero' }),
        ).rejects.toThrow(ServiceUnavailableException);
        expect(assets.uploadBuffer).not.toHaveBeenCalled();
    });

    it('turns a CDN failure into a retryable error rather than a 500', async () => {
        assets.uploadBuffer.mockRejectedValue(new Error('cloudinary down'));

        await expect(
            service.upload('tenant-1', { imageBase64: PIXEL_BASE64, kind: 'hero' }),
        ).rejects.toThrow(ServiceUnavailableException);
    });
});
