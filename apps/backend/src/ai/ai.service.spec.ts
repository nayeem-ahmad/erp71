import { BadRequestException, ForbiddenException } from '@nestjs/common';
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

/**
 * Structured callers (lead generation, blog drafts) need a JSON object and
 * cannot spend the token budget on hidden reasoning. An empty `content` with
 * finish_reason=length is how OpenRouter reports that a reasoning model ate
 * max_tokens thinking — the user then sees "invalid response".
 */
describe('AiService.completeUnbilled JSON extract options', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.OPENROUTER_API_KEY;
    });

    it('sends response_format=json_object and reasoning.enabled=false when asked', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: '{"ok":true}' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const service = new AiService(
            { aiUsageLog: { create: jest.fn() } } as any,
            { getRawValue: jest.fn().mockResolvedValue(null) } as any,
            {} as any,
        );

        await service.completeUnbilled('anthropic/claude-haiku-4.5', 'system', 'user', 4096, {
            json: true,
            reasoning: false,
        });

        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.response_format).toEqual({ type: 'json_object' });
        expect(payload.reasoning).toEqual({ enabled: false });
        expect(payload.max_tokens).toBe(4096);
    });

    it('omits those flags on an ordinary completion', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'ok' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const service = new AiService(
            { aiUsageLog: { create: jest.fn() } } as any,
            { getRawValue: jest.fn().mockResolvedValue(null) } as any,
            {} as any,
        );

        await service.completeUnbilled('anthropic/claude-haiku-4.5', 'system', 'user', 100);

        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.response_format).toBeUndefined();
        expect(payload.reasoning).toBeUndefined();
    });
});

/**
 * Ask's Better Bangla option. Same Whisper call the sale mic uses, without the
 * sale parser, billed on the tenant's existing AI credits.
 */
describe('AiService.transcribe', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function setup() {
        const db = { aiUsageLog: { create: jest.fn().mockResolvedValue({}) } };
        const service = new AiService(db as any, { getRawValue: jest.fn() } as any, {} as any);
        const credits = jest.spyOn(service, 'enforceCredits').mockResolvedValue(undefined);
        (service as any).getApiKey = jest.fn().mockResolvedValue('test-key');
        return { service, db, credits };
    }

    it('sends Bangla audio to Whisper and bills the existing credit pool', async () => {
        const { service, db, credits } = setup();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                text: 'আজকের বিক্রি',
                usage: { total_tokens: 250, input_tokens: 200, output_tokens: 50, cost: 0.001 },
            }),
        }) as unknown as typeof fetch;

        const result = await service.transcribe('tenant-1', {
            audioBase64: 'aaa',
            audioFormat: 'm4a',
            locale: 'bn',
        });

        expect(credits).toHaveBeenCalledWith('tenant-1');
        expect(result).toEqual({ transcript: 'আজকের বিক্রি', credits_used: 0.25 });
        const body = JSON.parse((global.fetch as unknown as jest.Mock).mock.calls[0][1].body);
        expect(body.model).toBe('openai/whisper-large-v3');
        expect(body.language).toBe('bn');
        expect(body.input_audio).toEqual({ data: 'aaa', format: 'm4a' });
        expect(db.aiUsageLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                feature: 'ask_transcription',
                model: 'openai/whisper-large-v3',
                credits_used: 0.25,
            }),
        });
    });

    it('bills by clip length when Whisper returns no token count, with a 0.05 floor', async () => {
        const { service, db } = setup();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'hello', usage: { seconds: 3 } }),
        }) as unknown as typeof fetch;

        const result = await service.transcribe('tenant-1', { audioBase64: 'aaa', locale: 'en' });

        // 3 seconds is under the floor, so the charge is 0.05 of a credit.
        expect(result.credits_used).toBe(0.05);
        expect(db.aiUsageLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ credits_used: 0.05, feature: 'ask_transcription' }),
        });
    });

    it('bills a minute of audio as one credit when no tokens come back', async () => {
        const { service } = setup();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'hello', usage: { seconds: 60 } }),
        }) as unknown as typeof fetch;

        const result = await service.transcribe('tenant-1', { audioBase64: 'aaa' });

        expect(result.credits_used).toBe(1);
    });

    it('refuses an empty recording before calling Whisper or charging credits', async () => {
        const { service, credits } = setup();
        global.fetch = jest.fn() as unknown as typeof fetch;

        await expect(service.transcribe('tenant-1', { audioBase64: '   ' })).rejects.toBeInstanceOf(BadRequestException);
        expect(credits).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not call Whisper when the credit pool is used up', async () => {
        const { service } = setup();
        jest.spyOn(service, 'enforceCredits').mockRejectedValue(new ForbiddenException('AI credit limit reached'));
        global.fetch = jest.fn() as unknown as typeof fetch;

        await expect(service.transcribe('tenant-1', { audioBase64: 'aaa' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
