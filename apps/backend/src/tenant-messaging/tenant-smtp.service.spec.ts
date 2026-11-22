import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { DatabaseService } from '../database/database.service';
import { decryptValue, encryptValue } from '../platform-settings/crypto.util';
import { SECRET_MASK } from './tenant-messaging-identity.service';
import { TenantSmtpError, TenantSmtpService, describeSmtpError } from './tenant-smtp.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

const mockLookup = lookup as unknown as jest.Mock;
const mockCreateTransport = nodemailer.createTransport as unknown as jest.Mock;

function savedRow(overrides: Record<string, unknown> = {}) {
    return {
        enabled: false,
        host: 'smtp.shop.example',
        port: 587,
        security: 'starttls',
        username: 'hello@shop.example',
        password: encryptValue('app-password'),
        from_email: 'hello@shop.example',
        from_name: 'Shop',
        reply_to: null,
        verified_at: null,
        last_error: null,
        last_error_at: null,
        updated_at: new Date(),
        ...overrides,
    };
}

describe('TenantSmtpService', () => {
    let service: TenantSmtpService;
    const sendMail = jest.fn();
    const close = jest.fn();

    const db = {
        tenant: { findUnique: jest.fn() },
        tenantSmtpServer: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        db.tenant.findUnique.mockResolvedValue({ name: 'Shop' });
        db.tenantSmtpServer.findUnique.mockResolvedValue(null);
        db.tenantSmtpServer.upsert.mockResolvedValue({});
        db.tenantSmtpServer.update.mockResolvedValue({});
        db.tenantSmtpServer.updateMany.mockResolvedValue({ count: 1 });
        mockLookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
        sendMail.mockResolvedValue({});
        mockCreateTransport.mockReturnValue({ sendMail, close });

        const module: TestingModule = await Test.createTestingModule({
            providers: [TenantSmtpService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get(TenantSmtpService);
    });

    describe('resolve()', () => {
        it('is null without a tenant, so platform mail never reads the table', async () => {
            expect(await service.resolve(null)).toBeNull();
            expect(db.tenantSmtpServer.findUnique).not.toHaveBeenCalled();
        });

        it('is null while switched off', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ enabled: false }));
            expect(await service.resolve('tenant-1')).toBeNull();
        });

        it('returns the decrypted server when switched on', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ enabled: true }));
            expect(await service.resolve('tenant-1')).toEqual(
                expect.objectContaining({ host: 'smtp.shop.example', password: 'app-password', fromEmail: 'hello@shop.example' }),
            );
        });

        it('treats a password that no longer decrypts as not configured', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ enabled: true, password: 'not-ciphertext' }));
            expect(await service.resolve('tenant-1')).toBeNull();
        });
    });

    describe('update()', () => {
        it('stores the password encrypted and returns it masked', async () => {
            db.tenantSmtpServer.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(savedRow());

            const result = await service.update('tenant-1', {
                host: 'SMTP.Shop.Example',
                port: 465,
                security: 'ssl',
                username: 'hello@shop.example',
                password: 'app-password',
                from_email: 'hello@shop.example',
            });

            const data = db.tenantSmtpServer.upsert.mock.calls[0][0].create;
            expect(data.host).toBe('smtp.shop.example');
            expect(data.password).not.toBe('app-password');
            expect(decryptValue(data.password)).toBe('app-password');
            expect(result.password).toBe(SECRET_MASK);
        });

        it('keeps the stored password when the mask comes back', async () => {
            const existing = savedRow();
            db.tenantSmtpServer.findUnique.mockResolvedValue(existing);

            await service.update('tenant-1', { password: SECRET_MASK, from_name: 'New name' });

            expect(db.tenantSmtpServer.upsert.mock.calls[0][0].update.password).toBe(existing.password);
        });

        it('refuses to switch on a server that has never passed a test', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow());
            await expect(service.update('tenant-1', { enabled: true })).rejects.toThrow(
                'Send a test email successfully before switching this on.',
            );
        });

        it('switches on once the saved settings have passed a test', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ verified_at: new Date() }));
            await service.update('tenant-1', { enabled: true });
            expect(db.tenantSmtpServer.upsert.mock.calls[0][0].update.enabled).toBe(true);
        });

        it('voids the last test when a connection field changes', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ enabled: true, verified_at: new Date() }));
            await expect(service.update('tenant-1', { host: 'smtp.other.example' })).rejects.toBeInstanceOf(
                BadRequestException,
            );

            await service.update('tenant-1', { host: 'smtp.other.example', enabled: false });
            const data = db.tenantSmtpServer.upsert.mock.calls[0][0].update;
            expect(data.verified_at).toBeNull();
        });

        it('keeps the last test when only the display name changes', async () => {
            const verifiedAt = new Date();
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ enabled: true, verified_at: verifiedAt }));
            await service.update('tenant-1', { from_name: 'Shop Ltd' });
            expect(db.tenantSmtpServer.upsert.mock.calls[0][0].update.verified_at).toBe(verifiedAt);
        });

        it('refuses ports other than the mail submission ones', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow());
            await expect(service.update('tenant-1', { port: 5432 })).rejects.toThrow('Port must be one of');
        });
    });

    describe('sendTest()', () => {
        it('connects to the checked address, keeps the name for TLS, and marks the settings verified', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow());

            await service.sendTest('tenant-1', 'owner@shop.example');

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: '203.0.113.10',
                    port: 587,
                    secure: false,
                    requireTLS: true,
                    tls: expect.objectContaining({ servername: 'smtp.shop.example' }),
                    auth: { user: 'hello@shop.example', pass: 'app-password' },
                }),
            );
            expect(sendMail).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'Shop <hello@shop.example>', to: 'owner@shop.example' }),
            );
            expect(db.tenantSmtpServer.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ verified_at: expect.any(Date) }) }),
            );
        });

        it.each([
            ['loopback', '127.0.0.1'],
            ['the Docker network', '172.18.0.5'],
            ['cloud metadata', '169.254.169.254'],
            ['a mapped private v6 address', '::ffff:10.0.0.1'],
        ])('refuses a host that resolves to %s', async (_label, address) => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ host: 'evil.example' }));
            mockLookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);

            await expect(service.sendTest('tenant-1', 'owner@shop.example')).rejects.toThrow('private network address');
            expect(mockCreateTransport).not.toHaveBeenCalled();
            expect(db.tenantSmtpServer.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ last_error: expect.stringContaining('private') }) }),
            );
        });

        it('turns an authentication failure into advice and stores it', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow());
            sendMail.mockRejectedValue(Object.assign(new Error('Invalid login'), {
                code: 'EAUTH',
                response: '535 5.7.8 Username and Password not accepted',
            }));

            await expect(service.sendTest('tenant-1', 'owner@shop.example')).rejects.toThrow('app password');
            expect(db.tenantSmtpServer.update).not.toHaveBeenCalled();
            expect(close).toHaveBeenCalled();
        });

        it('asks for the settings before testing', async () => {
            await expect(service.sendTest('tenant-1', 'owner@shop.example')).rejects.toThrow('Save the server');
        });
    });

    describe('deliver()', () => {
        const config = {
            host: 'smtp.shop.example',
            port: 587,
            security: 'starttls' as const,
            username: 'u',
            password: 'p',
            fromEmail: 'hello@shop.example',
            fromName: null,
            replyTo: 'replies@shop.example',
        };
        const message = { to: 'c@example.com', subject: 'Receipt', html: '<p>Thanks</p>' };

        it('sends with the shop reply-to', async () => {
            await service.deliver('tenant-1', config, message);
            expect(sendMail).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'hello@shop.example', replyTo: 'replies@shop.example', to: 'c@example.com' }),
            );
        });

        it('stops trying a failing server after three failures in a row', async () => {
            sendMail.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }));

            for (let i = 0; i < 3; i += 1) {
                await expect(service.deliver('tenant-1', config, message)).rejects.toBeInstanceOf(TenantSmtpError);
            }
            sendMail.mockClear();
            await expect(service.deliver('tenant-1', config, message)).rejects.toThrow('failed several times in a row');
            expect(sendMail).not.toHaveBeenCalled();
        });

        it('clears a stored error once mail goes through again', async () => {
            db.tenantSmtpServer.findUnique.mockResolvedValue(savedRow({ last_error: 'old failure' }));
            await service.deliver('tenant-1', config, message);
            expect(db.tenantSmtpServer.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: { last_error: null, last_error_at: null } }),
            );
        });
    });

    describe('describeSmtpError()', () => {
        it('explains a security/port mismatch', () => {
            expect(
                describeSmtpError(Object.assign(new Error('ssl3_get_record:wrong version number'), { code: 'ESOCKET' })),
            ).toContain('SSL/TLS with port 465');
        });

        it('explains a certificate that does not match the name', () => {
            expect(
                describeSmtpError(
                    Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: 'ESOCKET' }),
                ),
            ).toContain('certificate');
        });
    });
});
