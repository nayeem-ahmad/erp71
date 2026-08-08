import { AiService } from './ai.service';

/**
 * The billing split is the whole point of `completeUnbilled`: the platform blog
 * has no tenant to charge, and `AiUsageLog.tenant_id` is a required FK. A
 * refactor that quietly reunited the two would either crash the platform
 * endpoint or start writing usage rows against the wrong tenant.
 */
describe('AiService.completeUnbilled', () => {
    const platformSettings = { getRawValue: jest.fn() } as any;
    const db = { aiUsageLog: { create: jest.fn() } } as any;
    let service: AiService;

    beforeEach(() => {
        jest.clearAllMocks();
        platformSettings.getRawValue.mockResolvedValue(null);
        service = new AiService(db, platformSettings, {} as any);
        (service as any).callOpenRouter = jest.fn().mockResolvedValue({
            text: 'ok',
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        (service as any).getApiKey = jest.fn().mockResolvedValue('test-key');
    });

    it('returns the text, the usage and the normalized model', async () => {
        const result = await service.completeUnbilled('claude-haiku-4-5-20251001', 'system', 'user', 100);

        expect(result.text).toBe('ok');
        expect(result.usage.total_tokens).toBe(15);
        expect(result.model).toBe('anthropic/claude-haiku-4.5');
    });

    it('writes no usage row', async () => {
        await service.completeUnbilled('anthropic/claude-haiku-4.5', 'system', 'user', 100);

        expect(db.aiUsageLog.create).not.toHaveBeenCalled();
    });

    it('still logs usage when the billed path is used', async () => {
        await (service as any).complete('tenant-1', 'test_feature', 'anthropic/claude-haiku-4.5', 'system', 'user', 100);

        expect(db.aiUsageLog.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ tenant_id: 'tenant-1', feature: 'test_feature' }) }),
        );
    });
});
