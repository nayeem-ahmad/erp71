import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';
import { TenantMessagingIdentityService } from '../tenant-messaging/tenant-messaging-identity.service';

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

    const tenantIdentity = {
        resolveEmailIdentity: jest.fn().mockResolvedValue(null),
    };

    beforeEach(async () => {
        process.env = { ...originalEnv };
        global.fetch = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailService,
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: CircuitBreakerRegistry, useValue: breakers },
                { provide: TenantMessagingIdentityService, useValue: tenantIdentity },
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

    it('sends a good-standing note with no amount and no payment ask', async () => {
        process.env.BREVO_API_KEY = 'xkeysib-test-key';
        process.env.EMAIL_FROM = 'notify@erp71.com';
        process.env.FRONTEND_URL = 'https://app.erp71.com';
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201, text: async () => '' });

        await service.sendSubscriptionGoodStanding(
            'owner@example.com',
            'Tenant One',
            'Premium',
            new Date('2026-10-01T00:00:00Z'),
        );

        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.subject).toContain('nothing due');
        expect(body.htmlContent).toContain('Premium');
        expect(body.htmlContent).toContain('https://app.erp71.com/billing');
        expect(body.htmlContent).not.toMatch(/retry payment|outstanding payment|pay now/i);
    });

    describe('tenant sender identity', () => {
        const brevoBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

        beforeEach(() => {
            process.env.BREVO_API_KEY = 'xkeysib-test-key';
            process.env.EMAIL_FROM = 'notify@erp71.com';
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
        });

        it('sends from the platform address when the tenant has no identity', async () => {
            await service.sendCustom('c@example.com', 'Hi', '<p>Hi</p>', { tenantId: 'tenant-1' });

            expect(brevoBody().sender).toEqual({ email: 'notify@erp71.com', name: 'ERP71' });
            expect(brevoBody().replyTo).toBeUndefined();
        });

        it('sends from the tenant address, name and reply-to when one is configured', async () => {
            tenantIdentity.resolveEmailIdentity.mockResolvedValueOnce({
                from: 'hello@shop.com',
                fromName: 'Shop BD',
                replyTo: 'support@shop.com',
            });

            await service.sendCustom('c@example.com', 'Hi', '<p>Hi</p>', { tenantId: 'tenant-1' });

            expect(brevoBody().sender).toEqual({ email: 'hello@shop.com', name: 'Shop BD' });
            expect(brevoBody().replyTo).toEqual({ email: 'support@shop.com' });
        });

        it('never asks for a tenant identity on platform mail', async () => {
            await service.sendPasswordReset('user@example.com', 'raw-token');

            expect(tenantIdentity.resolveEmailIdentity).toHaveBeenCalledWith(undefined);
            expect(brevoBody().sender).toEqual({ email: 'notify@erp71.com', name: 'ERP71' });
        });
    });
});