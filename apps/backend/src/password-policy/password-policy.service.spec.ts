import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '@erp71/shared-types';
import { PasswordPolicyService } from './password-policy.service';

const columns = (overrides: Partial<Record<string, unknown>> = {}) => ({
    password_min_length: 8,
    password_require_uppercase: false,
    password_require_lowercase: false,
    password_require_number: false,
    password_require_symbol: false,
    password_block_common: true,
    ...overrides,
});

describe('PasswordPolicyService', () => {
    const db = {
        tenant: { findUnique: jest.fn() },
        tenantUser: { findMany: jest.fn() },
    };
    const service = new PasswordPolicyService(db as any);

    beforeEach(() => jest.clearAllMocks());

    describe('getForTenant', () => {
        it('reads the workspace columns', async () => {
            db.tenant.findUnique.mockResolvedValue(
                columns({ password_min_length: 12, password_require_symbol: true }),
            );

            await expect(service.getForTenant('t1')).resolves.toEqual({
                min_length: 12,
                require_uppercase: false,
                require_lowercase: false,
                require_number: false,
                require_symbol: true,
                block_common: true,
            });
        });

        it('falls back to the platform default for a tenant that is gone', async () => {
            db.tenant.findUnique.mockResolvedValue(null);
            await expect(service.getForTenant('missing')).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
        });

        it('clamps a row written below the platform floor', async () => {
            db.tenant.findUnique.mockResolvedValue(columns({ password_min_length: 3 }));
            await expect(service.getForTenant('t1')).resolves.toMatchObject({ min_length: 8 });
        });
    });

    describe('getForUser', () => {
        it('takes the strictest policy across every workspace they are in', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                { tenant: columns({ password_min_length: 10, password_require_uppercase: true }) },
                { tenant: columns({ password_min_length: 16, password_require_number: true }) },
            ]);

            await expect(service.getForUser('u1')).resolves.toEqual({
                min_length: 16,
                require_uppercase: true,
                require_lowercase: false,
                require_number: true,
                require_symbol: false,
                block_common: true,
            });
        });

        it('uses the platform default for somebody in no workspace', async () => {
            db.tenantUser.findMany.mockResolvedValue([]);
            await expect(service.getForUser('shopper')).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
        });

        it('ignores a deleted workspace', async () => {
            db.tenantUser.findMany.mockResolvedValue([]);
            await service.getForUser('u1');

            expect(db.tenantUser.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { user_id: 'u1', tenant: { deleted_at: null } },
                }),
            );
        });
    });

    describe('assertValid', () => {
        const strict: PasswordPolicy = {
            min_length: 12,
            require_uppercase: true,
            require_lowercase: true,
            require_number: true,
            require_symbol: true,
            block_common: true,
        };

        it('accepts a password that satisfies the policy', () => {
            expect(() => service.assertValid('Sadia#Rahman2026', strict)).not.toThrow();
        });

        it('rejects one that does not, naming the whole policy rather than one rule', () => {
            expect(() => service.assertValid('sadia', strict)).toThrow(BadRequestException);
            expect(() => service.assertValid('sadia', strict)).toThrow(
                'at least 12 characters, an uppercase letter, a lowercase letter, a number and a symbol',
            );
        });
    });

    describe('assertValidForTenant', () => {
        it('holds an invitee to the inviting workspace', async () => {
            db.tenant.findUnique.mockResolvedValue(columns({ password_require_number: true }));

            await expect(service.assertValidForTenant('nonumbers', 't1')).rejects.toThrow(
                BadRequestException,
            );
            await expect(service.assertValidForTenant('withnumber1', 't1')).resolves.toBeUndefined();
        });
    });

    describe('assertValidForUser', () => {
        it('holds a member of two workspaces to the stricter one', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                { tenant: columns() },
                { tenant: columns({ password_min_length: 14 }) },
            ]);

            await expect(service.assertValidForUser('twelvechars1', 'u1')).rejects.toThrow(
                'at least 14 characters',
            );
        });
    });
});
