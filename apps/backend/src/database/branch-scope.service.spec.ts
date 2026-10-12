import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorePermission, TenantRecordScope } from '@erp71/shared-types';
import { BranchScopeService } from './branch-scope.service';
import { AuthCacheService } from './auth-cache.service';
import { TenantContext } from './tenant.decorator';

const P = StorePermission;
const SALES_READ = [P.CREATE_SALE, P.VIEW_FINANCIAL_REPORTS];

/** The cross-request cache switched off, so each case sees its own rows. */
const noCache = () => new AuthCacheService({ ttlMs: 0 });

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
    return {
        tenantId: 't1',
        userId: 'u1',
        userRole: 'CASHIER',
        storeId: 'A',
        timezone: 'Asia/Dhaka',
        recordScope: TenantRecordScope.ALL,
        ...overrides,
    };
}

describe('BranchScopeService', () => {
    let db: any;
    let service: BranchScopeService;

    /** Member access rows and per-branch grants for `u1` in `t1`. */
    function member(access: string[], grants: Record<string, StorePermission[]>) {
        db.userStoreAccess.findMany.mockResolvedValue(
            access.map((store_id) => ({ store_id, access_level: 'STORE_ONLY' })),
        );
        db.userStorePermission.findMany.mockResolvedValue(
            Object.entries(grants).flatMap(([store_id, permissions]) =>
                permissions.map((permission) => ({ store_id, permission })),
            ),
        );
    }

    beforeEach(() => {
        db = {
            userStoreAccess: { findMany: jest.fn().mockResolvedValue([]) },
            userStorePermission: { findMany: jest.fn().mockResolvedValue([]) },
            store: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        service = new BranchScopeService(db, noCache());
    });

    describe('owner', () => {
        const owner = ctx({ userRole: 'OWNER' });

        it('may name any branch of the tenant', async () => {
            db.store.findFirst.mockResolvedValue({ id: 'B' });
            await expect(service.resolveStoreId(owner, 'B')).resolves.toBe('B');
            expect(db.store.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'B', tenant_id: 't1' } }),
            );
        });

        it('is refused a branch of another tenant', async () => {
            db.store.findFirst.mockResolvedValue(null);
            await expect(service.resolveStoreId(owner, 'X')).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('reads the whole tenant for `all` and when nothing is named', async () => {
            await expect(service.resolveStoreId(owner, 'all')).resolves.toBeUndefined();
            await expect(service.resolveStoreId(owner, undefined)).resolves.toBeUndefined();
        });

        it('gets the header branch on a one-branch endpoint when nothing is named', async () => {
            await expect(service.resolveStoreId(owner, undefined, { allowAll: false })).resolves.toBe('A');
        });
    });

    describe('single-branch member', () => {
        beforeEach(() => member(['A'], { A: SALES_READ }));

        it('may read their own branch', async () => {
            await expect(service.resolveStoreId(ctx(), 'A', { permissions: SALES_READ })).resolves.toBe('A');
        });

        it('is refused another branch', async () => {
            await expect(service.resolveStoreId(ctx(), 'B', { permissions: SALES_READ })).rejects.toBeInstanceOf(
                ForbiddenException,
            );
        });

        it('is refused `all`', async () => {
            await expect(service.resolveStoreId(ctx(), 'all')).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('gets the header branch when nothing is named', async () => {
            await expect(service.resolveStoreId(ctx(), undefined)).resolves.toBe('A');
            await expect(service.resolveStoreId(ctx(), '')).resolves.toBe('A');
        });

        it('needs a header branch when nothing is named', async () => {
            await expect(service.resolveStoreId(ctx({ storeId: undefined }), undefined)).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('multi-branch member without consolidated access', () => {
        beforeEach(() => member(['A', 'B'], { A: SALES_READ, B: SALES_READ }));

        it('may read each of their branches', async () => {
            await expect(service.resolveStoreId(ctx(), 'A', { permissions: SALES_READ })).resolves.toBe('A');
            await expect(service.resolveStoreId(ctx(), 'B', { permissions: SALES_READ })).resolves.toBe('B');
        });

        it('is refused `all`, and narrowed to the header branch when nothing is named', async () => {
            await expect(service.resolveStoreId(ctx(), 'all')).rejects.toBeInstanceOf(ForbiddenException);
            await expect(service.resolveStoreId(ctx({ storeId: 'B' }), undefined)).resolves.toBe('B');
        });

        it('is refused a branch where they lack the read permission', async () => {
            member(['A', 'B'], { A: SALES_READ, B: [P.STOCK_TAKE] });
            await expect(service.resolveStoreId(ctx(), 'B', { permissions: SALES_READ })).rejects.toBeInstanceOf(
                ForbiddenException,
            );
        });
    });

    describe('consolidated member', () => {
        beforeEach(() =>
            member(['A', 'B'], {
                A: [...SALES_READ, P.VIEW_CONSOLIDATED_REPORTS],
                B: SALES_READ,
            }),
        );

        it('reads the whole tenant for `all` and when nothing is named', async () => {
            await expect(service.resolveStoreId(ctx(), 'all')).resolves.toBeUndefined();
            await expect(service.resolveStoreId(ctx(), undefined)).resolves.toBeUndefined();
        });

        it('checks the consolidated grant in the header branch', async () => {
            await expect(service.resolveStoreId(ctx({ storeId: 'B' }), 'all')).rejects.toBeInstanceOf(
                ForbiddenException,
            );
        });

        it('still cannot name a branch outside their access', async () => {
            await expect(service.resolveStoreId(ctx(), 'C')).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('is refused `all` on a one-branch endpoint', async () => {
            await expect(service.resolveStoreId(ctx(), 'all', { allowAll: false })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            await expect(service.resolveStoreId(ctx(), undefined, { allowAll: false })).resolves.toBe('A');
        });
    });

    describe('resolveStoreIds', () => {
        beforeEach(() => member(['A', 'B'], { A: SALES_READ, B: SALES_READ }));

        it('accepts the member’s branches, de-duplicated', async () => {
            await expect(service.resolveStoreIds(ctx(), ['A', 'B', 'A'])).resolves.toEqual(['A', 'B']);
        });

        it('rejects the set when one id is foreign', async () => {
            await expect(service.resolveStoreIds(ctx(), ['A', 'C'])).rejects.toBeInstanceOf(ForbiddenException);
        });
    });
});
