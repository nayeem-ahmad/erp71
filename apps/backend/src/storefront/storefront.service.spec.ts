import { Test, TestingModule } from '@nestjs/testing';
import { StorefrontService } from './storefront.service';
import { DatabaseService } from '../database/database.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { JwtService } from '@nestjs/jwt';
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

const mockTenant = {
    id: 'tenant-1',
    name: 'Test Store',
    storefront_banner: 'banner.jpg',
    storefront_hero_image: 'hero.jpg',
    storefront_hero_headline: 'Welcome',
    loyalty_points_enabled: false,
    loyalty_earn_rate: null,
    loyalty_redeem_rate: null,
    loyalty_min_redeem: null,
};

describe('StorefrontService', () => {
    let service: StorefrontService;
    let db: any;
    let jwtService: any;
    let priceListsService: any;
    let totpService: any;
    let auditService: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        db = {
            tenant: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            productGroup: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            product: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            storefrontOrder: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            customer: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            user: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            loyaltyTransaction: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
            $queryRaw: jest.fn(),
        };

        jwtService = {
            sign: jest.fn().mockReturnValue('test-token'),
        };

        priceListsService = {
            resolvePriceListForCustomer: jest.fn().mockResolvedValue(null),
            getResolvedPricesForProducts: jest.fn().mockResolvedValue(new Map()),
        };

        totpService = {
            isEnabled: jest.fn().mockReturnValue(false),
            verifyTotpForLogin: jest.fn().mockResolvedValue({ verified: true }),
        };

        auditService = {
            log: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StorefrontService,
                { provide: DatabaseService, useValue: db },
                { provide: JwtService, useValue: jwtService },
                { provide: PriceListsService, useValue: priceListsService },
                { provide: TotpService, useValue: totpService },
                { provide: AuditService, useValue: auditService },
            ],
        }).compile();

        service = module.get<StorefrontService>(StorefrontService);
    });

    // ── getStorefront ─────────────────────────────────────────────────────────

    describe('getStorefront', () => {
        const slug = 'my-store';

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.getStorefront(slug);
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Storefront not found or not available');
        });

        it('returns storefront data with categories and products', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.productGroup.findMany.mockResolvedValue([
                {
                    id: 'cat-1',
                    name: 'Electronics',
                    image_url: 'elec.jpg',
                    products: [{ id: 'p1' }, { id: 'p2' }],
                },
            ]);
            db.product.findMany
                .mockResolvedValueOnce([
                    // trending
                    {
                        id: 'p1',
                        name: 'Phone',
                        price: 100,
                        compare_at_price: 120,
                        image_url: 'phone.jpg',
                        group: { name: 'Electronics' },
                        stocks: [{ quantity: 5 }, { quantity: 3 }],
                    },
                ])
                .mockResolvedValueOnce([
                    // all products
                    {
                        id: 'p2',
                        name: 'Tablet',
                        price: 200,
                        compare_at_price: null,
                        image_url: null,
                        group: null,
                        stocks: [{ quantity: 2 }],
                    },
                ]);

            const result = await service.getStorefront(slug);

            expect(result.tenant.name).toBe('Test Store');
            expect(result.categories).toHaveLength(1);
            expect(result.categories[0].count).toBe(2);
            expect(result.trending_products).toHaveLength(1);
            expect(result.trending_products[0].stock_quantity).toBe(8);
            expect(result.all_products).toHaveLength(1);
            expect(result.all_products[0].group_name).toBe('Uncategorized');
        });

        it('maps loyalty fields when loyalty is enabled', async () => {
            db.tenant.findFirst.mockResolvedValue({
                ...mockTenant,
                loyalty_points_enabled: true,
                loyalty_earn_rate: '0.1',
                loyalty_redeem_rate: '0.5',
                loyalty_min_redeem: 100,
            });
            db.productGroup.findMany.mockResolvedValue([]);
            db.product.findMany.mockResolvedValue([]).mockResolvedValue([]);

            const result = await service.getStorefront(slug);

            expect(result.tenant.loyalty_enabled).toBe(true);
            expect(result.tenant.loyalty_earn_rate).toBe(0.1);
            expect(result.tenant.loyalty_redeem_rate).toBe(0.5);
            expect(result.tenant.loyalty_min_redeem).toBe(100);
        });

        it('uses Uncategorized when product has no group (trending)', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.productGroup.findMany.mockResolvedValue([]);
            db.product.findMany
                .mockResolvedValueOnce([
                    {
                        id: 'p1',
                        name: 'Item',
                        price: 50,
                        compare_at_price: null,
                        image_url: null,
                        group: null,
                        stocks: [],
                    },
                ])
                .mockResolvedValueOnce([]);

            const result = await service.getStorefront(slug);
            expect(result.trending_products[0].group_name).toBe('Uncategorized');
            expect(result.trending_products[0].stock_quantity).toBe(0);
        });
    });

    // ── getPublicProduct ──────────────────────────────────────────────────────

    describe('getPublicProduct', () => {
        const slug = 'my-store';
        const productId = 'prod-1';

        // Nine fields the endpoint is permitted to expose — kept as one list so
        // every assertion below (select args, returned keys) checks against the
        // same source of truth instead of independently-drifting literals.
        const permittedFields = [
            'id',
            'name',
            'sku',
            'price',
            'compare_at_price',
            'description',
            'image_url',
            'images_gallery',
            'unit_type',
        ];

        const mockProductRow = {
            id: productId,
            name: 'Premium Rice 5kg',
            sku: 'RICE-5KG',
            price: 650,
            compare_at_price: 700,
            description: 'Locally sourced, premium grade.',
            image_url: 'rice.jpg',
            images_gallery: ['rice-1.jpg', 'rice-2.jpg'],
            unit_type: 'kg',
        };

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.getPublicProduct(slug, productId);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('throws NotFoundException when product not found', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(null);

            const promise = service.getPublicProduct(slug, productId);
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Product not found');
        });

        it('resolves the tenant scoped to an enabled, non-deleted storefront by slug', async () => {
            // This is the regression guard for the findEnabledTenant() guard being
            // load-bearing: with a mocked Prisma client, a disabled or soft-deleted
            // storefront and an unknown slug both surface as findFirst resolving to
            // null (there is no real WHERE filtering to exercise here), so the only
            // way to catch a future change that drops these clauses — and quietly
            // starts serving products from a disabled/deleted storefront — is to
            // assert the query itself still carries both guards.
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(mockProductRow);

            await service.getPublicProduct(slug, productId);

            expect(db.tenant.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        storefront_slug: slug,
                        storefront_enabled: true,
                        deleted_at: null,
                    }),
                }),
            );
        });

        it('scopes the product query to the resolved tenant and excludes soft-deleted products', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(mockProductRow);

            await service.getPublicProduct(slug, productId);

            expect(db.product.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: productId, tenant_id: mockTenant.id, deleted_at: null },
                }),
            );
        });

        it('does not return a product belonging to a different tenant', async () => {
            // The mocked Prisma client can't itself enforce tenant scoping, so this
            // asserts the behaviour that scoping is meant to produce: a `findFirst`
            // that (per the assertion above) is filtered by `tenant_id` returns
            // nothing for a cross-tenant id, and the service surfaces that as 404
            // rather than ever falling back to an unscoped lookup.
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(null); // simulates: exists, but for another tenant

            const promise = service.getPublicProduct(slug, 'other-tenants-product');
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('selects only the nine permitted fields from Prisma', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(mockProductRow);

            await service.getPublicProduct(slug, productId);

            const call = db.product.findFirst.mock.calls[0][0];
            expect(Object.keys(call.select).sort()).toEqual([...permittedFields].sort());
        });

        it('returns exactly the nine permitted fields — nothing more, nothing less', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(mockProductRow);

            const result = await service.getPublicProduct(slug, productId);

            expect(Object.keys(result).sort()).toEqual([...permittedFields].sort());
        });

        it('never leaks internal planning fields, even if a widened select put them on the row', async () => {
            // Simulates the exact regression this method's doc-comment warns
            // about: a future `select` widened to include planning data. The
            // service builds its return value field-by-field rather than
            // spreading the Prisma row, so these must not survive even when
            // present on what Prisma resolves.
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue({
                ...mockProductRow,
                tenant_id: mockTenant.id,
                reorder_level: 10,
                safety_stock: 5,
                lead_time_days: 3,
            });

            const result = await service.getPublicProduct(slug, productId);

            expect(result).not.toHaveProperty('reorder_level');
            expect(result).not.toHaveProperty('safety_stock');
            expect(result).not.toHaveProperty('lead_time_days');
            expect(result).not.toHaveProperty('tenant_id');
        });

        it('converts Decimal price fields to plain numbers', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue(mockProductRow);

            const result = await service.getPublicProduct(slug, productId);

            expect(result.price).toBe(650);
            expect(result.compare_at_price).toBe(700);
        });

        it('returns null compare_at_price as null rather than 0', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findFirst.mockResolvedValue({ ...mockProductRow, compare_at_price: null });

            const result = await service.getPublicProduct(slug, productId);

            expect(result.compare_at_price).toBeNull();
        });
    });

    // ── placeOrder ────────────────────────────────────────────────────────────

    describe('placeOrder', () => {
        const slug = 'my-store';
        const dto = {
            customerName: 'John Doe',
            customerEmail: 'john@example.com',
            customerPhone: '01700000000',
            notes: 'Please hurry',
            items: [{ productId: 'prod-1', quantity: 2 }],
        };

        const mockProducts = [
            {
                id: 'prod-1',
                name: 'Phone',
                price: 500,
                stocks: [{ quantity: 10 }],
            },
        ];

        const mockCreatedOrder = {
            id: 'order-1',
            tenantId: 'tenant-1',
            totalAmount: 1000,
            status: 'PENDING',
            items: [],
        };

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.placeOrder(slug, dto as any);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('throws BadRequestException when product count mismatch', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findMany.mockResolvedValue([]); // returns empty, mismatch

            const promise = service.placeOrder(slug, dto as any);
            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('One or more products not found for this store');
        });

        it('throws BadRequestException when insufficient stock', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findMany.mockResolvedValue([
                {
                    id: 'prod-1',
                    name: 'Phone',
                    price: 500,
                    stocks: [{ quantity: 1 }], // only 1, need 2
                },
            ]);

            const promise = service.placeOrder(slug, dto as any);
            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Insufficient stock');
        });

        it('creates order successfully without user', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.storefrontOrder.create.mockResolvedValue(mockCreatedOrder);

            const result = await service.placeOrder(slug, dto as any);

            expect(result).toEqual(mockCreatedOrder);
            expect(db.storefrontOrder.create).toHaveBeenCalled();
        });

        it('creates order with logged-in customer but no loyalty', async () => {
            const userId = 'user-1';
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', loyalty_points: 0 });
            db.storefrontOrder.create.mockResolvedValue(mockCreatedOrder);

            const result = await service.placeOrder(slug, dto as any, userId);

            expect(result).toEqual(mockCreatedOrder);
        });

        it('redeems loyalty points when conditions are met', async () => {
            const tenantWithLoyalty = {
                ...mockTenant,
                loyalty_points_enabled: true,
                loyalty_earn_rate: '0.1',
                loyalty_redeem_rate: '1',
                loyalty_min_redeem: 0,
            };
            const dtoWithPoints = { ...dto, pointsToRedeem: 200 };
            const customer = { id: 'cust-1', loyalty_points: 500 };

            db.tenant.findFirst.mockResolvedValue(tenantWithLoyalty);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.customer.findFirst.mockResolvedValue(customer);
            db.storefrontOrder.create.mockResolvedValue(mockCreatedOrder);
            db.loyaltyTransaction.create.mockResolvedValue({});
            db.customer.update.mockResolvedValue({});

            await service.placeOrder(slug, dtoWithPoints as any, 'user-1');

            expect(db.loyaltyTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ type: 'REDEEM' }) }),
            );
        });

        it('throws BadRequestException when below minimum loyalty redemption', async () => {
            const tenantWithLoyalty = {
                ...mockTenant,
                loyalty_points_enabled: true,
                loyalty_earn_rate: null,
                loyalty_redeem_rate: '1',
                loyalty_min_redeem: 500,
            };
            const dtoWithPoints = { ...dto, pointsToRedeem: 100 }; // below min 500
            const customer = { id: 'cust-1', loyalty_points: 600 };

            db.tenant.findFirst.mockResolvedValue(tenantWithLoyalty);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.customer.findFirst.mockResolvedValue(customer);

            const promise = service.placeOrder(slug, dtoWithPoints as any, 'user-1');
            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Minimum redemption is 500 points');
        });

        it('earns loyalty points on paid amount', async () => {
            const tenantWithLoyalty = {
                ...mockTenant,
                loyalty_points_enabled: true,
                loyalty_earn_rate: '0.1',
                loyalty_redeem_rate: null,
                loyalty_min_redeem: null,
            };
            const customer = { id: 'cust-1', loyalty_points: 0 };

            db.tenant.findFirst.mockResolvedValue(tenantWithLoyalty);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.customer.findFirst.mockResolvedValue(customer);
            db.storefrontOrder.create.mockResolvedValue(mockCreatedOrder);
            db.loyaltyTransaction.create.mockResolvedValue({});
            db.customer.update.mockResolvedValue({});

            await service.placeOrder(slug, dto as any, 'user-1');

            // 1000 * 0.1 = 100 points earned
            expect(db.loyaltyTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ type: 'EARN', points: 100 }) }),
            );
        });

        it('caps discount when points value exceeds total amount', async () => {
            const tenantWithLoyalty = {
                ...mockTenant,
                loyalty_points_enabled: true,
                loyalty_earn_rate: null,
                loyalty_redeem_rate: '10', // 10 taka per point
                loyalty_min_redeem: 0,
            };
            const dtoWithPoints = { ...dto, pointsToRedeem: 500 }; // 500 * 10 = 5000 > 1000 total
            const customer = { id: 'cust-1', loyalty_points: 500 };

            db.tenant.findFirst.mockResolvedValue(tenantWithLoyalty);
            db.product.findMany.mockResolvedValue(mockProducts);
            db.customer.findFirst.mockResolvedValue(customer);
            db.storefrontOrder.create.mockResolvedValue(mockCreatedOrder);
            db.loyaltyTransaction.create.mockResolvedValue({});
            db.customer.update.mockResolvedValue({});

            await service.placeOrder(slug, dtoWithPoints as any, 'user-1');

            // discount capped at 1000, so total becomes 0
            expect(db.storefrontOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ totalAmount: 0 }) }),
            );
        });

        it('handles multiple items correctly', async () => {
            const multiDto = {
                ...dto,
                items: [
                    { productId: 'prod-1', quantity: 2 },
                    { productId: 'prod-2', quantity: 1 },
                ],
            };
            const multiProducts = [
                { id: 'prod-1', name: 'Phone', price: 500, stocks: [{ quantity: 10 }] },
                { id: 'prod-2', name: 'Case', price: 50, stocks: [{ quantity: 5 }] },
            ];

            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.product.findMany.mockResolvedValue(multiProducts);
            db.storefrontOrder.create.mockResolvedValue({ ...mockCreatedOrder, totalAmount: 1050 });

            const result = await service.placeOrder(slug, multiDto as any);
            expect(db.storefrontOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ totalAmount: 1050 }) }),
            );
            expect(result.totalAmount).toBe(1050);
        });
    });

    // ── getOrders ─────────────────────────────────────────────────────────────

    describe('getOrders', () => {
        it('returns paginated orders', async () => {
            const orders = [{ id: 'order-1', items: [] }];
            db.storefrontOrder.findMany.mockResolvedValue(orders);
            db.storefrontOrder.count.mockResolvedValue(1);

            const result = await service.getOrders('tenant-1', 1, 10);

            expect(result.items).toEqual(orders);
            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(10);
            expect(result.pages).toBe(1);
        });

        it('calculates correct skip for page 2', async () => {
            db.storefrontOrder.findMany.mockResolvedValue([]);
            db.storefrontOrder.count.mockResolvedValue(0);

            await service.getOrders('tenant-1', 2, 5);

            expect(db.storefrontOrder.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 5, take: 5 }),
            );
        });

        it('returns empty items when no orders', async () => {
            db.storefrontOrder.findMany.mockResolvedValue([]);
            db.storefrontOrder.count.mockResolvedValue(0);

            const result = await service.getOrders('tenant-1', 1, 20);
            expect(result.items).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    // ── updateOrderStatus ─────────────────────────────────────────────────────

    describe('updateOrderStatus', () => {
        it('throws BadRequestException for invalid status', async () => {
            const promise = service.updateOrderStatus('tenant-1', 'order-1', 'SHIPPED');
            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('Invalid status');
        });

        it('throws NotFoundException when order not found', async () => {
            db.storefrontOrder.findFirst.mockResolvedValue(null);

            const promise = service.updateOrderStatus('tenant-1', 'order-1', 'CONFIRMED');
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Order not found');
        });

        it('updates order status to CONFIRMED', async () => {
            db.storefrontOrder.findFirst.mockResolvedValue({ id: 'order-1', status: 'PENDING' });
            db.storefrontOrder.update.mockResolvedValue({ id: 'order-1', status: 'CONFIRMED' });

            const result = await service.updateOrderStatus('tenant-1', 'order-1', 'CONFIRMED');
            expect(result.status).toBe('CONFIRMED');
        });

        it('updates order status to CANCELLED', async () => {
            db.storefrontOrder.findFirst.mockResolvedValue({ id: 'order-1', status: 'PENDING' });
            db.storefrontOrder.update.mockResolvedValue({ id: 'order-1', status: 'CANCELLED' });

            const result = await service.updateOrderStatus('tenant-1', 'order-1', 'CANCELLED');
            expect(result.status).toBe('CANCELLED');
        });

        it('updates order status to PENDING', async () => {
            db.storefrontOrder.findFirst.mockResolvedValue({ id: 'order-1', status: 'CONFIRMED' });
            db.storefrontOrder.update.mockResolvedValue({ id: 'order-1', status: 'PENDING' });

            const result = await service.updateOrderStatus('tenant-1', 'order-1', 'PENDING');
            expect(result.status).toBe('PENDING');
        });
    });

    // ── customerSignup ────────────────────────────────────────────────────────

    describe('customerSignup', () => {
        const slug = 'my-store';
        const signupDto = {
            name: 'Alice',
            email: 'alice@example.com',
            password: 'password123',
            phone: '01700000001',
        };

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.customerSignup(slug, signupDto as any);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('creates new user and customer when neither exists', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(null);
            (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
            db.user.create.mockResolvedValue({ id: 'user-1', email: signupDto.email, name: signupDto.name, token_version: 1 });
            db.customer.findFirst
                .mockResolvedValueOnce(null)  // existingByEmail
                .mockResolvedValueOnce(null); // phoneExists
            db.customer.create.mockResolvedValue({
                id: 'cust-1',
                name: signupDto.name,
                email: signupDto.email,
                phone: signupDto.phone,
            });

            const result = await service.customerSignup(slug, signupDto as any);

            expect((result as any).access_token).toBe('test-token');
            expect((result as any).customer.email).toBe(signupDto.email);
            expect(db.user.create).toHaveBeenCalled();
            expect(db.customer.create).toHaveBeenCalled();
        });

        it('links existing user to new customer record when password matches', async () => {
            const existingUser = { id: 'user-1', email: signupDto.email, passwordHash: 'hashed', token_version: 1 };
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(existingUser);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst
                .mockResolvedValueOnce(null)   // existing linked check
                .mockResolvedValueOnce(null)   // existingByEmail
                .mockResolvedValueOnce(null);  // phoneExists
            db.customer.create.mockResolvedValue({
                id: 'cust-1',
                name: signupDto.name,
                email: signupDto.email,
                phone: signupDto.phone,
            });

            const result = await service.customerSignup(slug, signupDto as any);
            expect((result as any).access_token).toBe('test-token');
        });

        it('throws ConflictException when user exists with wrong password', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed', token_version: 1 });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const promise = service.customerSignup(slug, signupDto as any);
            await expect(promise).rejects.toThrow(ConflictException);
            await expect(promise).rejects.toThrow('already exists');
        });

        it('throws ConflictException when already a customer of this tenant', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed', token_version: 1 });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst.mockResolvedValueOnce({ id: 'cust-1' }); // existing linked

            const promise = service.customerSignup(slug, signupDto as any);
            await expect(promise).rejects.toThrow(ConflictException);
            await expect(promise).rejects.toThrow('Already registered');
        });

        it('throws ConflictException when phone already registered', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(null);
            (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
            db.user.create.mockResolvedValue({ id: 'user-1', email: signupDto.email, name: signupDto.name, token_version: 1 });
            db.customer.findFirst
                .mockResolvedValueOnce(null)  // existingByEmail
                .mockResolvedValueOnce({ id: 'other-cust' }); // phoneExists

            const promise = service.customerSignup(slug, signupDto as any);
            await expect(promise).rejects.toThrow(ConflictException);
            await expect(promise).rejects.toThrow('Phone number already registered');
        });

        it('links existing unlinked customer record by email', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(null);
            (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
            db.user.create.mockResolvedValue({ id: 'user-1', email: signupDto.email, name: signupDto.name, token_version: 1 });
            db.customer.findFirst.mockResolvedValueOnce({ id: 'existing-cust-by-email' }); // existingByEmail found
            db.customer.update.mockResolvedValue({
                id: 'existing-cust-by-email',
                name: signupDto.name,
                email: signupDto.email,
                phone: signupDto.phone,
            });

            const result = await service.customerSignup(slug, signupDto as any);
            expect(db.customer.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'existing-cust-by-email' }, data: { user_id: 'user-1' } }),
            );
            expect((result as any).access_token).toBe('test-token');
        });
    });

    // ── customerLogin ─────────────────────────────────────────────────────────

    describe('customerLogin', () => {
        const slug = 'my-store';
        const loginDto = {
            email: 'alice@example.com',
            password: 'password123',
        };

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.customerLogin(slug, loginDto as any);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('throws UnauthorizedException when user not found', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(null);

            const promise = service.customerLogin(slug, loginDto as any);
            await expect(promise).rejects.toThrow(UnauthorizedException);
            await expect(promise).rejects.toThrow('Invalid credentials');
        });

        it('throws UnauthorizedException when user has no password hash', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: null });

            const promise = service.customerLogin(slug, loginDto as any);
            await expect(promise).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when password is wrong', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const promise = service.customerLogin(slug, loginDto as any);
            await expect(promise).rejects.toThrow(UnauthorizedException);
            await expect(promise).rejects.toThrow('Invalid credentials');
        });

        it('throws UnauthorizedException when customer record not found for this store', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst.mockResolvedValue(null);

            const promise = service.customerLogin(slug, loginDto as any);
            await expect(promise).rejects.toThrow(UnauthorizedException);
            await expect(promise).rejects.toThrow('No customer account found');
        });

        it('returns access_token and customer on valid login', async () => {
            const user = {
                id: 'user-1',
                email: loginDto.email,
                passwordHash: 'hashed',
                token_version: 1,
                storefront_token_version: 3,
            };
            const customer = { id: 'cust-1', name: 'Alice', email: loginDto.email, phone: '01700000001' };

            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(user);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst.mockResolvedValue(customer);

            const result = await service.customerLogin(slug, loginDto as any);

            expect((result as any).access_token).toBe('test-token');
            expect((result as any).customer.id).toBe('cust-1');
            expect(jwtService.sign).toHaveBeenCalledWith(
                expect.objectContaining({ sub: 'user-1', email: loginDto.email }),
            );
        });

        it('signs a storefront-scoped token bound to the tenant, versioned by stv', async () => {
            const user = {
                id: 'user-1',
                email: loginDto.email,
                passwordHash: 'hashed',
                token_version: 9,
                storefront_token_version: 3,
            };

            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue(user);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Alice' });

            await service.customerLogin(slug, loginDto as any);

            expect(jwtService.sign).toHaveBeenCalledWith({
                sub: 'user-1',
                email: loginDto.email,
                stv: 3,
                scope: 'storefront',
                tid: 'tenant-1',
            });
            // The app's own token_version must not leak into a storefront token.
            expect(jwtService.sign).not.toHaveBeenCalledWith(expect.objectContaining({ tv: expect.anything() }));
        });

        it('demands the second factor instead of a session when the account has TOTP enabled', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({
                id: 'user-1',
                email: loginDto.email,
                passwordHash: 'hashed',
                totp_secret: 'SECRET',
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Alice' });
            totpService.isEnabled.mockReturnValue(true);

            const result = await service.customerLogin(slug, loginDto as any);

            expect(result).toEqual({ requires_2fa: true, user_id: 'user-1' });
            expect(jwtService.sign).not.toHaveBeenCalled();
        });
    });

    // ── completeCustomerTwoFactorLogin ────────────────────────────────────────

    describe('completeCustomerTwoFactorLogin', () => {
        const slug = 'my-store';

        it('issues the session once the TOTP code verifies', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({
                id: 'user-1',
                email: 'alice@example.com',
                storefront_token_version: 0,
            });
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Alice' });

            const result = await service.completeCustomerTwoFactorLogin(slug, 'user-1', '123456');

            expect(totpService.verifyTotpForLogin).toHaveBeenCalledWith('user-1', '123456');
            expect(result.access_token).toBe('test-token');
        });

        it('does not issue a session when the code is rejected', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'alice@example.com' });
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Alice' });
            totpService.verifyTotpForLogin.mockRejectedValue(new UnauthorizedException('Invalid code'));

            await expect(service.completeCustomerTwoFactorLogin(slug, 'user-1', '000000')).rejects.toThrow(
                UnauthorizedException,
            );
            expect(jwtService.sign).not.toHaveBeenCalled();
        });

        it('rejects a user who is not a customer of this store', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'alice@example.com' });
            db.customer.findFirst.mockResolvedValue(null);

            await expect(service.completeCustomerTwoFactorLogin(slug, 'user-1', '123456')).rejects.toThrow(
                UnauthorizedException,
            );
            expect(totpService.verifyTotpForLogin).not.toHaveBeenCalled();
        });
    });

    // ── customerLogout ────────────────────────────────────────────────────────

    describe('customerLogout', () => {
        it('bumps storefront_token_version only, leaving the app session alive', async () => {
            db.user.update.mockResolvedValue({ id: 'user-1' });

            const result = await service.customerLogout('user-1');

            expect(db.user.update).toHaveBeenCalledWith({
                where: { id: 'user-1' },
                data: { storefront_token_version: { increment: 1 } },
            });
            expect(result).toEqual({ success: true });
        });
    });

    // ── getCustomerProfile ────────────────────────────────────────────────────

    describe('getCustomerProfile', () => {
        const slug = 'my-store';
        const userId = 'user-1';

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.getCustomerProfile(slug, userId);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('throws NotFoundException when customer not found', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue(null);

            const promise = service.getCustomerProfile(slug, userId);
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Customer profile not found');
        });

        it('returns customer profile fields', async () => {
            const customer = {
                id: 'cust-1',
                name: 'Alice',
                email: 'alice@example.com',
                phone: '01700000001',
                loyalty_points: 100,
                total_spent: 2000,
            };

            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue(customer);

            const result = await service.getCustomerProfile(slug, userId);

            expect(result).toEqual({
                id: 'cust-1',
                name: 'Alice',
                email: 'alice@example.com',
                phone: '01700000001',
                loyalty_points: 100,
                total_spent: 2000,
            });
        });

        it('rejects a session minted for a different store', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);

            const promise = service.getCustomerProfile(slug, userId, 'tenant-other');
            await expect(promise).rejects.toThrow(UnauthorizedException);
            expect(db.customer.findFirst).not.toHaveBeenCalled();
        });

        it('accepts a legacy session with no tenant claim', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Alice', loyalty_points: 0, total_spent: 0 });

            await expect(service.getCustomerProfile(slug, userId, null)).resolves.toMatchObject({ id: 'cust-1' });
        });
    });

    // ── getCustomerOrders ─────────────────────────────────────────────────────

    describe('getCustomerOrders', () => {
        const slug = 'my-store';
        const userId = 'user-1';

        it('throws NotFoundException when tenant not found', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            const promise = service.getCustomerOrders(slug, userId, 1, 10);
            await expect(promise).rejects.toThrow(NotFoundException);
        });

        it('throws NotFoundException when customer not found', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue(null);

            const promise = service.getCustomerOrders(slug, userId, 1, 10);
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Customer profile not found');
        });

        it('returns paginated customer orders', async () => {
            const orders = [{ id: 'order-1', items: [] }];
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1', loyalty_points: 0 });
            db.storefrontOrder.findMany.mockResolvedValue(orders);
            db.storefrontOrder.count.mockResolvedValue(1);

            const result = await service.getCustomerOrders(slug, userId, 1, 10);

            expect(result.items).toEqual(orders);
            expect(result.total).toBe(1);
            expect(result.pages).toBe(1);
        });

        it('rejects a session minted for a different store', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);

            const promise = service.getCustomerOrders(slug, userId, 1, 10, 'tenant-other');
            await expect(promise).rejects.toThrow(UnauthorizedException);
            expect(db.storefrontOrder.findMany).not.toHaveBeenCalled();
        });

        it('passes correct filters for customer orders', async () => {
            db.tenant.findFirst.mockResolvedValue(mockTenant);
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
            db.storefrontOrder.findMany.mockResolvedValue([]);
            db.storefrontOrder.count.mockResolvedValue(0);

            await service.getCustomerOrders(slug, userId, 2, 5);

            expect(db.storefrontOrder.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenantId: mockTenant.id, customerUserId: userId },
                    skip: 5,
                    take: 5,
                }),
            );
        });
    });
});
