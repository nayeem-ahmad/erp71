import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';

describe('EmailService', () => {
    let service: EmailService;
    const originalFetch = global.fetch;
    const originalEnv = process.env;

    const platformSettings = {
        getRawGroup: jest.fn().mockResolvedValue({}),
    };

    const breakers = {
        get: jest.fn(() => ({
            execute: (fn: () => Promise<unknown>) => fn(),
        })),
    };

    beforeEach(async () => {
        process.env = { ...originalEnv };
        global.fetch = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailService,
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: CircuitBreakerRegistry, useValue: breakers },
            ],
        }).compile();

        service = module.get(EmailService);
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env = originalEnv;
        jest.clearAllMocks();
    });

    it('sends verification email via Brevo API when SMTP_PASS is an API key', async () => {
        process.env.SMTP_PASS = 'xkeysib-test-key';
        process.env.EMAIL_FROM = 'notify@erp71.com';
        process.env.FRONTEND_URL = 'https://app.erp71.com';

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 201,
            text: async () => '',
        });

        await service.sendEmailVerification('user@example.com', 'raw-token', { throwOnError: true });

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.brevo.com/v3/smtp/email',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'api-key': 'xkeysib-test-key' }),
            }),
        );
    });

    it('surfaces Brevo API errors when throwOnError is set', async () => {
        process.env.BREVO_API_KEY = 'xkeysib-bad-key';

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => '{"message":"Key not found"}',
        });

        await expect(
            service.sendEmailVerification('user@example.com', 'raw-token', { throwOnError: true }),
        ).rejects.toThrow('Brevo API 401');
    });
});