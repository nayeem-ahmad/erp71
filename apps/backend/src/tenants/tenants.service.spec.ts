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
        db.tenant.findUnique.mockResolvedValue({ default_locale: 'bn' });

        const result = await service.getLocalizationSettings('tenant-1');

        expect(db.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            select: { default_locale: true },
        });
        expect(result).toEqual({ default_locale: 'bn' });
    });

    it('updates tenant localization settings', async () => {
        db.tenant.update.mockResolvedValue({ default_locale: 'bn' });

        const result = await service.updateLocalizationSettings('tenant-1', { default_locale: 'bn' });

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: { default_locale: 'bn' },
            select: { default_locale: true },
        });
        expect(result).toEqual({ default_locale: 'bn' });
    });
});