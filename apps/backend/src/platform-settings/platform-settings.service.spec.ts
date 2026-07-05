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
        it('returns assist features off and manufacturing on by default', async () => {
            const features = await service.getPlatformFeatures();

            expect(features).toEqual({
                feedback: false,
                support: false,
                help: false,
                voice: false,
                manufacturing: true,
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
            });
        });
    });
});