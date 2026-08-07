import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { decryptValue } from '../platform-settings/crypto.util';
import { SECRET_MASK, TenantMessagingIdentityService } from './tenant-messaging-identity.service';

describe('TenantMessagingIdentityService', () => {
    let service: TenantMessagingIdentityService;

    const db = {
        tenant: { findFirst: jest.fn() },
        tenantMessagingIdentity: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        db.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
        db.tenantMessagingIdentity.findUnique.mockResolvedValue(null);
        db.tenantMessagingIdentity.upsert.mockResolvedValue({});

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantMessagingIdentityService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(TenantMessagingIdentityService);
    });

    describe('resolveEmailIdentity()', () => {
        it('returns null without a tenant id so platform mail keeps the platform sender', async () => {
            expect(await service.resolveEmailIdentity(undefined)).toBeNull();
            expect(db.tenantMessagingIdentity.findUnique).not.toHaveBeenCalled();
        });

        it('returns null for a tenant with no identity row', async () => {
            expect(await service.resolveEmailIdentity('tenant-1')).toBeNull();
        });

        it('returns null when the row exists but email is switched off', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                email_enabled: false,
                email_from: 'hello@shop.com',
            });
            expect(await service.resolveEmailIdentity('tenant-1')).toBeNull();
        });

        it('returns the tenant sender when enabled', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                email_enabled: true,
                email_from: 'hello@shop.com',
                email_from_name: 'Shop BD',
                email_reply_to: 'support@shop.com',
            });

            expect(await service.resolveEmailIdentity('tenant-1')).toEqual({
                from: 'hello@shop.com',
                fromName: 'Shop BD',
                replyTo: 'support@shop.com',
            });
        });

        it('falls back to the platform sender when enabled without a from-address', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                email_enabled: true,
                email_from: null,
            });
            expect(await service.resolveEmailIdentity('tenant-1')).toBeNull();
        });

        it('caches the lookup, including the negative one', async () => {
            await service.resolveEmailIdentity('tenant-1');
            await service.resolveEmailIdentity('tenant-1');
            expect(db.tenantMessagingIdentity.findUnique).toHaveBeenCalledTimes(1);
        });
    });

    describe('resolveWhatsAppIdentity()', () => {
        it('decrypts the stored access token', async () => {
            await service.update('tenant-1', {
                whatsapp_phone_number_id: '123456',
                whatsapp_access_token: 'EAAG-secret',
                whatsapp_enabled: true,
            });

            const written = db.tenantMessagingIdentity.upsert.mock.calls[0][0].update;
            expect(written.whatsapp_access_token).not.toBe('EAAG-secret');
            db.tenantMessagingIdentity.findUnique.mockResolvedValue(written);

            expect(await service.resolveWhatsAppIdentity('tenant-1')).toEqual({
                phoneNumberId: '123456',
                accessToken: 'EAAG-secret',
                apiVersion: null,
            });
        });

        it('falls back to the platform number when the credentials are half-set', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                whatsapp_enabled: true,
                whatsapp_phone_number_id: '123456',
                whatsapp_access_token: null,
            });
            expect(await service.resolveWhatsAppIdentity('tenant-1')).toBeNull();
        });
    });

    describe('getForAdmin()', () => {
        it('masks the stored token and never returns ciphertext', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                email_enabled: true,
                email_from: 'hello@shop.com',
                whatsapp_access_token: 'ciphertext',
                updated_at: null,
            });

            const view = await service.getForAdmin('tenant-1');

            expect(view.whatsapp_access_token).toBe(SECRET_MASK);
            expect(view.email_from).toBe('hello@shop.com');
        });

        it('reports an unconfigured tenant as empty rather than 404', async () => {
            const view = await service.getForAdmin('tenant-1');
            expect(view.email_enabled).toBe(false);
            expect(view.whatsapp_access_token).toBe('');
        });
    });

    describe('update()', () => {
        it('rejects an unknown tenant', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            await expect(service.update('nope', { email_enabled: true })).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('refuses to enable email without a from-address', async () => {
            await expect(service.update('tenant-1', { email_enabled: true })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('refuses to enable WhatsApp with only a phone number id', async () => {
            await expect(
                service.update('tenant-1', { whatsapp_enabled: true, whatsapp_phone_number_id: '1' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('treats the returned mask as "leave the token alone"', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                whatsapp_enabled: true,
                whatsapp_phone_number_id: '123456',
                whatsapp_access_token: 'already-encrypted',
            });

            await service.update('tenant-1', { whatsapp_access_token: SECRET_MASK });

            const written = db.tenantMessagingIdentity.upsert.mock.calls[0][0].update;
            expect(written.whatsapp_access_token).toBe('already-encrypted');
        });

        it('clears the token on an explicit empty string', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                whatsapp_enabled: false,
                whatsapp_phone_number_id: '123456',
                whatsapp_access_token: 'already-encrypted',
            });

            await service.update('tenant-1', { whatsapp_access_token: '' });

            const written = db.tenantMessagingIdentity.upsert.mock.calls[0][0].update;
            expect(written.whatsapp_access_token).toBeNull();
        });

        it('keeps stored email fields an admin did not resend', async () => {
            db.tenantMessagingIdentity.findUnique.mockResolvedValue({
                email_enabled: true,
                email_from: 'hello@shop.com',
                email_from_name: 'Shop BD',
            });

            await service.update('tenant-1', { notes: 'domain verified 2026-08-06' });

            const written = db.tenantMessagingIdentity.upsert.mock.calls[0][0].update;
            expect(written.email_from).toBe('hello@shop.com');
            expect(written.email_from_name).toBe('Shop BD');
            expect(written.notes).toBe('domain verified 2026-08-06');
        });

        it('encrypts the token at rest', async () => {
            await service.update('tenant-1', { whatsapp_access_token: 'EAAG-secret' });
            const written = db.tenantMessagingIdentity.upsert.mock.calls[0][0].update;
            expect(decryptValue(written.whatsapp_access_token)).toBe('EAAG-secret');
        });
    });
});
