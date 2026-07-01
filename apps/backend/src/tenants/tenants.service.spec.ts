import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DatabaseService } from '../database/database.service';

describe('TenantsService', () => {
    let service: TenantsService;

    const db = {
        tenant: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(TenantsService);
    });

    it('returns tenant localization settings', async () => {
        db.tenant.findUnique.mockResolvedValue({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });

        const result = await service.getLocalizationSettings('tenant-1');

        expect(db.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });
        expect(result).toEqual({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });
    });

    it('updates tenant localization settings when enabled', async () => {
        db.tenant.findUnique.mockResolvedValue({
            localization_enabled: true,
            secondary_locale: 'bn',
        });
        db.tenant.update.mockResolvedValue({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });

        const result = await service.updateLocalizationSettings('tenant-1', { default_locale: 'bn' });

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: { default_locale: 'bn' },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });
        expect(result).toEqual({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });
    });

    it('rejects tenant localization updates when switching is disabled', async () => {
        db.tenant.findUnique.mockResolvedValue({
            localization_enabled: false,
            secondary_locale: null,
        });

        await expect(
            service.updateLocalizationSettings('tenant-1', { default_locale: 'bn' }),
        ).rejects.toThrow(BadRequestException);
        expect(db.tenant.update).not.toHaveBeenCalled();
    });
});