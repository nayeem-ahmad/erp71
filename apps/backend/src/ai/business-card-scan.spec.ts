import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ProductsService } from '../products/products.service';

/**
 * The vision leg of the business-card scanner. The OpenRouter call is stubbed at
 * `fetch`, which is what the rest of AiService already does, so these cover the
 * parts that are ours: what goes on the wire, and what survives coming back.
 */
describe('AiService.scanBusinessCard', () => {
    let service: AiService;
    let db: any;
    let fetchMock: jest.Mock;

    const TENANT = 'tenant-1';
    const PIXEL = 'iVBORw0KGgoAAAANSUhEUg==';

    const respondWith = (content: string) => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { content } }],
                usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 },
            }),
        });
    };

    const sentPayload = () => JSON.parse(fetchMock.mock.calls[0][1].body);

    beforeEach(async () => {
        db = {
            aiUsageLog: {
                create: jest.fn().mockResolvedValue({}),
                aggregate: jest.fn().mockResolvedValue({ _sum: { credits_used: 0 } }),
            },
            tenantSubscription: {
                findUnique: jest.fn().mockResolvedValue({
                    current_period_start: new Date('2026-07-01'),
                    current_period_end: new Date('2026-07-31'),
                    plan: { code: 'PREMIUM', features_json: { premiumAi: true, aiCreditsMonthly: 1000 } },
                }),
            },
            tenant: { findUnique: jest.fn().mockResolvedValue({ ai_credits_bonus: 0 }) },
        };

        const platformSettings = { getRawValue: jest.fn().mockResolvedValue(null) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                { provide: DatabaseService, useValue: db },
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: ProductsService, useValue: {} },
            ],
        }).compile();

        service = module.get<AiService>(AiService);

        process.env.OPENROUTER_API_KEY = 'test-key';
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        delete process.env.OPENROUTER_API_KEY;
        jest.restoreAllMocks();
    });

    it('sends the card as an image part alongside the extraction instruction', async () => {
        respondWith('{"name":"Rafiq Islam"}');

        await service.scanBusinessCard(TENANT, { imageBase64: PIXEL, mimeType: 'image/png' });

        const parts = sentPayload().messages[1].content;
        expect(parts[0].type).toBe('text');
        expect(parts[1]).toEqual({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${PIXEL}` },
        });
    });

    // FileReader.readAsDataURL hands the browser a full data: URL, so the server
    // has to accept one without the client remembering to strip the prefix.
    it('accepts a full data URL and reads the mime type off it', async () => {
        respondWith('{"name":"Rafiq Islam"}');

        await service.scanBusinessCard(TENANT, { imageBase64: `data:image/webp;base64,${PIXEL}` });

        expect(sentPayload().messages[1].content[1].image_url.url).toBe(
            `data:image/webp;base64,${PIXEL}`,
        );
    });

    it('returns the card fields, dropping blanks and keys the schema has no slot for', async () => {
        respondWith(
            '{"name":"  Rafiq Islam  ","company":"Karim Traders","designation":"","fax":"02-9999","raw_text":"Karim Traders"}',
        );

        const result = await service.scanBusinessCard(TENANT, { imageBase64: PIXEL });

        expect(result).toEqual({
            name: 'Rafiq Islam',
            company: 'Karim Traders',
            raw_text: 'Karim Traders',
        });
    });

    it('unwraps a fenced JSON reply', async () => {
        respondWith('```json\n{"name":"Rafiq Islam"}\n```');

        await expect(service.scanBusinessCard(TENANT, { imageBase64: PIXEL })).resolves.toEqual({
            name: 'Rafiq Islam',
        });
    });

    it('bills the scan against the tenant credit allowance', async () => {
        respondWith('{"name":"Rafiq Islam"}');

        await service.scanBusinessCard(TENANT, { imageBase64: PIXEL });

        expect(db.aiUsageLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ tenant_id: TENANT, feature: 'business_card_scan' }),
            }),
        );
    });

    it('rejects a file type the vision model cannot read', async () => {
        await expect(
            service.scanBusinessCard(TENANT, { imageBase64: PIXEL, mimeType: 'application/pdf' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an oversized photo before paying for the round-trip', async () => {
        await expect(
            service.scanBusinessCard(TENANT, { imageBase64: 'a'.repeat(7 * 1024 * 1024) }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an empty payload', async () => {
        await expect(service.scanBusinessCard(TENANT, { imageBase64: '   ' })).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });
});
