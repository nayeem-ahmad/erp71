import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShortLinksService } from './short-links.service';

/**
 * The cases below concentrate on the three places a mistake is expensive:
 * rejecting an unsafe target before it is ever stored, keeping a revoked link
 * dead, and never leaking one tenant's links into another tenant's list.
 */
describe('ShortLinksService', () => {
    const db = {
        shortLink: {
            create: jest.fn(),
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
    } as any;

    let service: ShortLinksService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new ShortLinksService(db);
    });

    const row = (overrides: Record<string, unknown> = {}) => ({
        id: 'link-1',
        tenant_id: 'tenant-1',
        code: 'aB3xK9m',
        target_url: 'https://example.com/',
        label: 'Campaign',
        kind: 'MANUAL',
        entity_type: null,
        entity_id: null,
        click_count: 0,
        last_click_at: null,
        created_by: 'user-1',
        created_at: new Date('2026-08-04'),
        revoked_at: null,
        ...overrides,
    });

    describe('createManual', () => {
        it('rejects an unsafe target before touching the database', async () => {
            await expect(
                service.createManual('tenant-1', 'user-1', { target_url: 'javascript:alert(1)' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.shortLink.create).not.toHaveBeenCalled();
        });

        it('stores the normalized URL returned by validation', async () => {
            db.shortLink.create.mockResolvedValue(row());
            await service.createManual('tenant-1', 'user-1', { target_url: '  https://example.com  ' });

            expect(db.shortLink.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        target_url: 'https://example.com/',
                        kind: 'MANUAL',
                        tenant_id: 'tenant-1',
                        created_by: 'user-1',
                    }),
                }),
            );
        });

        it('retries with a fresh code when the generated one collides', async () => {
            const collision = Object.assign(new Error('unique'), { code: 'P2002' });
            db.shortLink.create.mockRejectedValueOnce(collision).mockResolvedValueOnce(row());

            const result = await service.createManual('tenant-1', 'user-1', {
                target_url: 'https://example.com',
            });

            expect(db.shortLink.create).toHaveBeenCalledTimes(2);
            const first = db.shortLink.create.mock.calls[0][0].data.code;
            const second = db.shortLink.create.mock.calls[1][0].data.code;
            expect(first).not.toEqual(second);
            expect(result.code).toBe('aB3xK9m');
        });

        it('stores tenant_id: null for platform staff', async () => {
            db.shortLink.create.mockResolvedValue(row({ tenant_id: null }));
            await service.createManual(null, 'user-1', { target_url: 'https://example.com' });

            expect(db.shortLink.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        target_url: 'https://example.com/',
                        kind: 'MANUAL',
                        tenant_id: null,
                        created_by: 'user-1',
                    }),
                }),
            );
        });
    });

    describe('createForEntity', () => {
        it('reuses the existing live link rather than minting a second code', async () => {
            db.shortLink.findFirst.mockResolvedValue(row({ kind: 'ENTITY' }));

            const result = await service.createForEntity({
                tenantId: 'tenant-1',
                userId: 'user-1',
                entityType: 'QUOTATION',
                entityId: 'quote-1',
                targetUrl: '/q/token-1',
            });

            expect(db.shortLink.create).not.toHaveBeenCalled();
            expect(result.code).toBe('aB3xK9m');
        });

        it('mints a link when none exists', async () => {
            db.shortLink.findFirst.mockResolvedValue(null);
            db.shortLink.create.mockResolvedValue(row({ kind: 'ENTITY', target_url: '/q/token-1' }));

            await service.createForEntity({
                tenantId: 'tenant-1',
                userId: 'user-1',
                entityType: 'QUOTATION',
                entityId: 'quote-1',
                targetUrl: '/q/token-1',
            });

            expect(db.shortLink.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        kind: 'ENTITY',
                        entity_type: 'QUOTATION',
                        entity_id: 'quote-1',
                        target_url: '/q/token-1',
                    }),
                }),
            );
        });
    });

    describe('resolve', () => {
        it('returns the target and its kind', async () => {
            db.shortLink.findUnique.mockResolvedValue(row({ target_url: '/q/token-1' }));
            await expect(service.resolve('aB3xK9m', false)).resolves.toEqual({
                target_url: '/q/token-1',
                kind: 'internal',
            });
        });

        it('increments the click count only when asked', async () => {
            db.shortLink.findUnique.mockResolvedValue(row());
            await service.resolve('aB3xK9m', false);
            expect(db.shortLink.update).not.toHaveBeenCalled();

            await service.resolve('aB3xK9m', true);
            expect(db.shortLink.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'link-1' },
                    data: expect.objectContaining({ click_count: { increment: 1 } }),
                }),
            );
        });

        it('404s a revoked link', async () => {
            db.shortLink.findUnique.mockResolvedValue(row({ revoked_at: new Date() }));
            await expect(service.resolve('aB3xK9m', true)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('404s an unknown code', async () => {
            db.shortLink.findUnique.mockResolvedValue(null);
            await expect(service.resolve('nope123', true)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('404s a stored target that no longer validates', async () => {
            // Defence in depth: a row written before a rule tightened must not
            // start redirecting just because it is already in the table.
            db.shortLink.findUnique.mockResolvedValue(row({ target_url: 'javascript:alert(1)' }));
            await expect(service.resolve('aB3xK9m', true)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('list', () => {
        it('scopes to the tenant', async () => {
            db.shortLink.findMany.mockResolvedValue([row()]);
            await service.list('tenant-1');
            expect(db.shortLink.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
            );
        });

        it('lists only platform-owned links for platform staff', async () => {
            db.shortLink.findMany.mockResolvedValue([row({ tenant_id: null })]);
            await service.list(null);
            expect(db.shortLink.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: null } }),
            );
        });

        it('never issues an unfiltered query', async () => {
            // `where: {}` is what made the platform-admin page a viewer for every
            // tenant's links, quotation share targets included. Both callers must
            // carry a tenant_id clause — one for a real tenant, one for null.
            db.shortLink.findMany.mockResolvedValue([]);

            await service.list('tenant-1');
            await service.list(null);

            for (const [args] of db.shortLink.findMany.mock.calls) {
                expect(Object.keys(args.where)).toEqual(['tenant_id']);
            }
        });

        it('does not return another tenant\'s rows to platform staff', async () => {
            // A `where` assertion alone would not have caught the original bug —
            // `{}` is a perfectly valid `where`. So this one runs the filter for
            // real against a mixed table and checks what comes back.
            const table = [
                row({ id: 'platform-1', tenant_id: null, code: 'plat001', target_url: 'https://erp71.com/pricing' }),
                row({ id: 'tenant-quote', tenant_id: 'tenant-1', code: 'quot001', target_url: '/q/secret-token' }),
                row({ id: 'other-tenant', tenant_id: 'tenant-2', code: 'othr001' }),
            ];
            db.shortLink.findMany.mockImplementation(async ({ where }: any) =>
                table.filter((r) => r.tenant_id === where.tenant_id),
            );

            const result = await service.list(null);

            expect(result.map((r) => r.id)).toEqual(['platform-1']);
            expect(JSON.stringify(result)).not.toContain('secret-token');
        });

        it('does not return platform links to a tenant', async () => {
            const table = [
                row({ id: 'platform-1', tenant_id: null }),
                row({ id: 'mine', tenant_id: 'tenant-1' }),
                row({ id: 'theirs', tenant_id: 'tenant-2' }),
            ];
            db.shortLink.findMany.mockImplementation(async ({ where }: any) =>
                table.filter((r) => r.tenant_id === where.tenant_id),
            );

            const result = await service.list('tenant-1');

            expect(result.map((r) => r.id)).toEqual(['mine']);
        });
    });

    describe('revoke', () => {
        it('refuses to revoke another tenant\'s link', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.revoke('link-1', 'tenant-2')).rejects.toBeInstanceOf(NotFoundException);
        });

        it('marks the link revoked', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 1 });
            await service.revoke('link-1', 'tenant-1');
            expect(db.shortLink.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'link-1', tenant_id: 'tenant-1' },
                    data: expect.objectContaining({ revoked_at: expect.any(Date) }),
                }),
            );
        });

        it('revokes an unscoped link for platform staff', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 1 });
            await service.revoke('link-1', null);
            expect(db.shortLink.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'link-1' },
                    data: expect.objectContaining({ revoked_at: expect.any(Date) }),
                }),
            );
        });

        it('throws 404 when revoking a non-existent link as platform staff', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.revoke('link-1', null)).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
