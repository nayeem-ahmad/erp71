import { Test, TestingModule } from '@nestjs/testing';
import { PlatformSettingsService } from './platform-settings.service';
import { DatabaseService } from '../database/database.service';

describe('PlatformSettingsService', () => {
    let service: PlatformSettingsService;

    const db = {
        platformSetting: {
            findMany: jest.fn(),
            upsert: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        db.platformSetting.findMany.mockResolvedValue([]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlatformSettingsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(PlatformSettingsService);
    });

    describe('getPlatformFeatures', () => {
        it('returns assist features off, and manufacturing and platform projects on, by default', async () => {
            const features = await service.getPlatformFeatures();

            expect(features).toEqual({
                feedback: false,
                support: false,
                help: false,
                voice: false,
                manufacturing: true,
                aiChat: false,
                externalImport: false,
                projects: false,
                platformProjects: true,
            });
        });

        it('parses enabled feature flags from stored settings', async () => {
            db.platformSetting.findMany.mockResolvedValue([
                { group: 'general', key: 'feedback_enabled', value: 'true', is_secret: false },
                { group: 'general', key: 'voice_enabled', value: 'true', is_secret: false },
                { group: 'general', key: 'manufacturing_enabled', value: 'false', is_secret: false },
            ]);

            const features = await service.getPlatformFeatures();

            expect(features).toEqual({
                feedback: true,
                support: false,
                help: false,
                voice: true,
                manufacturing: false,
                aiChat: false,
                externalImport: false,
                projects: false,
                platformProjects: true,
            });
        });

        it('lets an operator switch off the platform project workspace', async () => {
            db.platformSetting.findMany.mockResolvedValue([
                { group: 'general', key: 'platform_projects_enabled', value: 'false', is_secret: false },
            ]);

            await expect(service.isFeatureEnabled('platformProjects')).resolves.toBe(false);
        });
    });
});