import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';
import { TenantMessagingIdentityService } from '../tenant-messaging/tenant-messaging-identity.service';
import { SmsCreditService } from '../sms/sms-credit.service';
import { InsufficientMessagingCreditsError } from '../sms/messaging-channel';

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

    const credits = {
        consume: jest.fn().mockResolvedValue({ allowed: true, balance: 99 }),
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
                { provide: SmsCreditService, useValue: credits },
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

    describe('email credits', () => {
        beforeEach(() => {
            process.env.SMTP_PASS = 'xkeysib-test-key';
            process.env.EMAIL_FROM = 'notify@erp71.com';
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
            credits.consume.mockResolvedValue({ allowed: true, balance: 99 });
        });

        it('bills one email credit to the tenant for a campaign email', async () => {
            await service.sendCustom('c@example.com', 'Hi', '<p>Hi</p>', { tenantId: 'tenant-1', purpose: 'CRM campaign' });

            expect(credits.consume).toHaveBeenCalledWith('tenant-1', 1, {
                channel: 'EMAIL',
                recipient: 'c@example.com',
                description: 'CRM campaign',
            });
            expect(global.fetch).toHaveBeenCalled();
        });

        it('does not send a campaign email the balance cannot cover', async () => {
            credits.consume.mockResolvedValue({ allowed: false, balance: 0 });

            await expect(
                service.sendCustom('c@example.com', 'Hi', '<p>Hi</p>', { tenantId: 'tenant-1' }),
            ).rejects.toBeInstanceOf(InsufficientMessagingCreditsError);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('skips a sale receipt quietly when the shop is out of email credits', async () => {
            credits.consume.mockResolvedValue({ allowed: false, balance: 0 });

            await service.sendBillingInvoice('customer@example.com', 'Shop', 500, 'BDT', undefined, {
                billTenantId: 'tenant-1',
                purpose: 'Sale receipt',
            });

            expect(credits.consume).toHaveBeenCalledWith('tenant-1', 1, expect.objectContaining({ channel: 'EMAIL' }));
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('never bills platform mail', async () => {
            await service.sendPasswordReset('user@example.com', 'raw-token');
            await service.sendBillingInvoice('owner@example.com', 'Shop', 500, 'BDT');

            expect(credits.consume).not.toHaveBeenCalled();
        });

        it('sendMeet71Invite is unbilled platform mail', async () => {
            process.env.MEET71_PUBLIC_URL = 'https://meet.erp71.com';

            await service.sendMeet71Invite('new@erp71.com', 'Actor <script>');

            expect(credits.consume).not.toHaveBeenCalled();
            expect(tenantIdentity.resolveEmailIdentity).toHaveBeenCalledWith(undefined);
            const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
            expect(body.subject).toBe('You can now use Meet71');
            expect(body.htmlContent).toContain('https://meet.erp71.com');
            expect(body.htmlContent).toContain('You can use Meet71');
            expect(body.htmlContent).toContain('Actor &lt;script&gt;');
            expect(body.htmlContent).not.toContain('<script>');
        });

        it('sendMeet71Invite throws on transport failure', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'boom',
            });

            await expect(service.sendMeet71Invite('new@erp71.com', 'Actor')).rejects.toThrow('Brevo API 500');
            expect(credits.consume).not.toHaveBeenCalled();
        });
    });
});