import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { PlaceOrderDto, CustomerSignupDto, CustomerLoginDto } from './storefront.dto';
import { paginate } from '../common/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { AUTH_SCOPE_STOREFRONT } from '../auth/token-scope';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StorefrontService {
    constructor(
        private readonly db: DatabaseService,
        private readonly jwtService: JwtService,
        private readonly priceListsService: PriceListsService,
        private readonly totp: TotpService,
        private readonly audit: AuditService,
    ) {}

    async getStorefront(slug: string, userId?: string) {
        const tenant = await this.findEnabledTenant(slug);
        const priceList = await this.resolvePriceListForUser(tenant.id, userId);

        // Fetch featured categories only
        const featuredCategories = await this.db.productGroup.findMany({
            where: {
                tenant_id: tenant.id,
                is_featured: true,
            },
            select: {
                id: true,
                name: true,
                image_url: true,
                products: {
                    where: {
                        deleted_at: null,
                        stocks: {
                            some: {
                                quantity: { gt: 0 },
                            },
                        },
                    },
                    select: { id: true },
                },
            },
        });

        const categories = featuredCategories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            image_url: cat.image_url,
            count: cat.products.length,
        }));

        // Fetch featured products (trending)
        const trendingProducts = await this.db.product.findMany({
            where: {
                tenant_id: tenant.id,
                is_featured: true,
                deleted_at: null,
                stocks: {
                    some: {
                        quantity: { gt: 0 },
                    },
                },
            },
            select: {
                id: true,
                name: true,
                price: true,
                compare_at_price: true,
                image_url: true,
                group: {
                    select: { name: true },
                },
                stocks: {
                    select: { quantity: true },
                },
            },
            take: 8,
        });

        const trendingResolved = await this.priceListsService.getResolvedPricesForProducts(
            tenant.id,
            trendingProducts.map((p) => p.id),
            priceList?.id,
        );

        const trending_products = trendingProducts.map((p) => {
            const resolved = trendingResolved.get(p.id);
            return {
                id: p.id,
                name: p.name,
                selling_price: resolved?.sellingPrice ?? Number(p.price),
                compare_at_price: resolved?.compareAtPrice ?? p.compare_at_price,
                image_url: p.image_url,
                group_name: p.group?.name || 'Uncategorized',
                stock_quantity: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
            };
        });

        // Fetch all products for Shop page
        const allProducts = await this.db.product.findMany({
            where: {
                tenant_id: tenant.id,
                deleted_at: null,
                stocks: {
                    some: {
                        quantity: { gt: 0 },
                    },
                },
            },
            select: {
                id: true,
                name: true,
                price: true,
                compare_at_price: true,
                image_url: true,
                group: {
                    select: { name: true },
                },
                stocks: {
                    select: { quantity: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        const allResolved = await this.priceListsService.getResolvedPricesForProducts(
            tenant.id,
            allProducts.map((p) => p.id),
            priceList?.id,
        );

        const all_products = allProducts.map((p) => {
            const resolved = allResolved.get(p.id);
            return {
                id: p.id,
                name: p.name,
                selling_price: resolved?.sellingPrice ?? Number(p.price),
                compare_at_price: resolved?.compareAtPrice ?? p.compare_at_price,
                image_url: p.image_url,
                group_name: p.group?.name || 'Uncategorized',
                stock_quantity: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
            };
        });

        return {
            tenant: {
                name: tenant.name,
                storefront_banner: tenant.storefront_banner,
                storefront_hero_image: tenant.storefront_hero_image,
                storefront_hero_headline: tenant.storefront_hero_headline,
                loyalty_enabled: tenant.loyalty_points_enabled,
                loyalty_earn_rate: tenant.loyalty_earn_rate ? Number(tenant.loyalty_earn_rate) : null,
                loyalty_redeem_rate: tenant.loyalty_redeem_rate ? Number(tenant.loyalty_redeem_rate) : null,
                loyalty_min_redeem: tenant.loyalty_min_redeem ?? null,
            },
            categories,
            trending_products,
            all_products,
        };
    }

    /**
     * Public single-product read, for a shareable product page. Selected
     * field-by-field, never a spread of the Prisma row: `Product` also carries
     * `reorder_level`, `safety_stock` and `lead_time_days`, which are internal
     * planning data and none of a shopper's business.
     *
     * The price goes through the same resolver `getStorefront` uses, against the
     * same anonymous-visitor price list. Reading `product.price` directly meant a
     * tenant running any price list had a shareable URL quoting a different
     * number than their own shop page for the same item.
     *
     * `in_stock` is a boolean, never the quantity: the shop page lists only
     * in-stock products, so a shared link can outlive availability, and a shopper
     * deserves to know before they order. How many units are left is inventory
     * data, not shopfront data.
     */
    async getPublicProduct(slug: string, productId: string) {
        const tenant = await this.findEnabledTenant(slug);

        const product = await this.db.product.findFirst({
            where: { id: productId, tenant_id: tenant.id, deleted_at: null },
            select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                compare_at_price: true,
                description: true,
                image_url: true,
                images_gallery: true,
                unit_type: true,
                stocks: { select: { quantity: true } },
            },
        });
        if (!product) throw new NotFoundException('Product not found');

        // No userId: this endpoint is unauthenticated, so the visitor gets the
        // storefront's default price list — the same one an anonymous shopper
        // sees on the shop page.
        const priceList = await this.resolvePriceListForUser(tenant.id);
        const resolved = await this.priceListsService.getResolvedPricesForProducts(
            tenant.id,
            [product.id],
            priceList?.id,
        );
        const resolvedPrice = resolved.get(product.id);

        const fallbackCompareAt =
            product.compare_at_price != null ? Number(product.compare_at_price) : null;

        return {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: resolvedPrice?.sellingPrice ?? Number(product.price),
            compare_at_price: resolvedPrice?.compareAtPrice ?? fallbackCompareAt,
            description: product.description,
            image_url: product.image_url,
            images_gallery: product.images_gallery,
            unit_type: product.unit_type,
            in_stock: (product.stocks ?? []).some((s) => s.quantity > 0),
        };
    }

    async placeOrder(slug: string, dto: PlaceOrderDto, userId?: string) {
        const tenant = await this.findEnabledTenant(slug);

        const productIds = dto.items.map((i) => i.productId);

        const products = await this.db.product.findMany({
            where: {
                id: { in: productIds },
                tenant_id: tenant.id,
                deleted_at: null,
            },
            select: {
                id: true,
                price: true,
                name: true,
                stocks: {
                    select: { quantity: true },
                },
            },
        });

        if (products.length !== productIds.length) {
            throw new BadRequestException('One or more products not found for this store');
        }

        const productMap = new Map(products.map((p) => [p.id, p]));

        // Validate stock for all items
        for (const item of dto.items) {
            const product = productMap.get(item.productId);
            if (!product) {
                throw new BadRequestException(`Product not found: ${item.productId}`);
            }
            const totalStock = product.stocks.reduce((sum, s) => sum + s.quantity, 0);
            if (totalStock < item.quantity) {
                throw new BadRequestException(
                    `Insufficient stock for product "${product.name}" (available: ${totalStock})`,
                );
            }
        }

        // Resolve customer record and price list
        let customer: { id: string; loyalty_points: number; customer_group_id: string | null } | null = null;
        let pointsToRedeem = 0;
        let pointsDiscount = 0;

        if (userId) {
            customer = await this.db.customer.findFirst({
                where: { user_id: userId, tenant_id: tenant.id, deleted_at: null },
                select: { id: true, loyalty_points: true, customer_group_id: true },
            });
        }

        const priceList = await this.priceListsService.resolvePriceListForCustomer(
            tenant.id,
            customer?.customer_group_id,
        );
        const resolvedPrices = await this.priceListsService.getResolvedPricesForProducts(
            tenant.id,
            productIds,
            priceList?.id,
        );

        let totalAmount = 0;
        for (const item of dto.items) {
            const product = productMap.get(item.productId);
            if (!product) {
                throw new BadRequestException(`Product not found: ${item.productId}`);
            }
            const unitPrice = resolvedPrices.get(item.productId)?.sellingPrice ?? Number(product.price);
            totalAmount += unitPrice * item.quantity;
        }

        if (
            customer &&
            dto.pointsToRedeem &&
            dto.pointsToRedeem > 0 &&
            tenant.loyalty_points_enabled &&
            tenant.loyalty_redeem_rate
        ) {
            const minRedeem = tenant.loyalty_min_redeem ?? 0;
            const requested = Math.min(dto.pointsToRedeem, customer.loyalty_points);
            if (requested < minRedeem) {
                throw new BadRequestException(
                    `Minimum redemption is ${minRedeem} points`,
                );
            }
            const redeemRate = Number(tenant.loyalty_redeem_rate);
            const rawDiscount = requested * redeemRate;
            // Cap discount at order total; back-calculate points if capped
            pointsDiscount = Math.min(rawDiscount, totalAmount);
            pointsToRedeem = pointsDiscount < rawDiscount
                ? Math.ceil(pointsDiscount / redeemRate)
                : requested;
            totalAmount = Math.max(0, totalAmount - pointsDiscount);
        }

        const order = await this.db.$transaction(async (tx) => {
            const created = await tx.storefrontOrder.create({
                data: {
                    tenantId: tenant.id,
                    customerName: dto.customerName,
                    customerEmail: dto.customerEmail,
                    customerPhone: dto.customerPhone ?? null,
                    notes: dto.notes ?? null,
                    totalAmount,
                    status: 'PENDING',
                    customerUserId: userId ?? null,
                    items: {
                        create: dto.items.map((item) => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            priceAtOrder:
                                resolvedPrices.get(item.productId)?.sellingPrice
                                ?? Number(productMap.get(item.productId)?.price ?? 0),
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            product: {
                                select: { id: true, name: true },
                            },
                        },
                    },
                },
            });

            if (customer) {
                // Redeem points if requested
                if (pointsToRedeem > 0) {
                    await tx.loyaltyTransaction.create({
                        data: {
                            tenantId: tenant.id,
                            customerId: customer.id,
                            type: 'REDEEM',
                            points: -pointsToRedeem,
                            description: `Redeemed for storefront order ${created.id}`,
                        },
                    });
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { loyalty_points: { decrement: pointsToRedeem } },
                    });
                }

                // Auto-earn points on the paid amount
                if (tenant.loyalty_points_enabled && tenant.loyalty_earn_rate) {
                    const earnRate = Number(tenant.loyalty_earn_rate);
                    const pointsEarned = Math.floor(totalAmount * earnRate);
                    if (pointsEarned > 0) {
                        await tx.loyaltyTransaction.create({
                            data: {
                                tenantId: tenant.id,
                                customerId: customer.id,
                                type: 'EARN',
                                points: pointsEarned,
                                description: `Earned from storefront order ${created.id}`,
                            },
                        });
                        await tx.customer.update({
                            where: { id: customer.id },
                            data: { loyalty_points: { increment: pointsEarned } },
                        });
                    }
                }
            }

            return created;
        });

        return order;
    }

    async getOrders(tenantId: string, page: number, limit: number) {
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.db.storefrontOrder.findMany({
                where: { tenantId },
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, name: true } },
                        },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.storefrontOrder.count({ where: { tenantId } }),
        ]);

        return paginate(items, total, page, limit);
    }

    async updateOrderStatus(tenantId: string, orderId: string, status: string) {
        const validStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }

        const order = await this.db.storefrontOrder.findFirst({
            where: { id: orderId, tenantId },
        });

        if (!order) {
            throw new NotFoundException('Order not found');
        }

        return this.db.storefrontOrder.update({
            where: { id: orderId },
            data: { status },
        });
    }

    // ── Customer Auth ────────────────────────────────────────────────────────

    async customerSignup(slug: string, dto: CustomerSignupDto) {
        const tenant = await this.findEnabledTenant(slug);

        let user = await this.db.user.findUnique({ where: { email: dto.email } });

        if (user) {
            // If user already exists but gave a password, verify it matches.
            // A Google-only account has no hash to compare against, so it can
            // never be claimed here — they sign in instead.
            const valid = user.passwordHash ? await bcrypt.compare(dto.password, user.passwordHash) : false;
            if (!valid) {
                throw new ConflictException('An account with this email already exists. Please sign in instead.');
            }

            // Check if already a customer of this tenant
            const existingLinked = await this.db.customer.findFirst({
                where: { user_id: user.id, tenant_id: tenant.id, deleted_at: null },
            });
            if (existingLinked) {
                throw new ConflictException('Already registered as a customer for this store. Please sign in.');
            }
        } else {
            const passwordHash = await bcrypt.hash(dto.password, 10);
            user = await this.db.user.create({
                data: { email: dto.email, name: dto.name, passwordHash },
            });
        }

        // Try to find an existing unlinked customer record with this email (created by shop owner)
        const existingByEmail = await this.db.customer.findFirst({
            where: { tenant_id: tenant.id, email: dto.email, deleted_at: null, user_id: null },
        });

        let customer;
        if (existingByEmail) {
            customer = await this.db.customer.update({
                where: { id: existingByEmail.id },
                data: { user_id: user.id },
            });
        } else {
            const phoneExists = await this.db.customer.findFirst({
                where: { tenant_id: tenant.id, phone: dto.phone, deleted_at: null },
            });
            if (phoneExists) {
                throw new ConflictException('Phone number already registered for this store');
            }

            const customerCode = `WEB${Date.now().toString(36).toUpperCase().slice(-6)}`;
            customer = await this.db.customer.create({
                data: {
                    tenant_id: tenant.id,
                    customer_code: customerCode,
                    name: dto.name,
                    phone: dto.phone,
                    email: dto.email,
                    user_id: user.id,
                },
            });
        }

        this.audit
            .log('STOREFRONT_CUSTOMER_SIGNUP', 'Customer', { userId: user.id, tenantId: tenant.id }, customer.id, {
                email: dto.email,
                slug,
            })
            .catch(() => {});

        // Signing up against an existing account only proves the password. If that
        // account carries a second factor, it applies here too — the customer row
        // is already linked, so verifying the code completes the sign-in.
        if (this.totp.isEnabled(user.totp_secret)) {
            return { requires_2fa: true, user_id: user.id };
        }

        return this.issueCustomerAuthResponse(user, customer, tenant.id);
    }

    async customerLogin(slug: string, dto: CustomerLoginDto) {
        const tenant = await this.findEnabledTenant(slug);

        const user = await this.db.user.findUnique({ where: { email: dto.email } });
        if (!user || !user.passwordHash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            this.audit
                .log('STOREFRONT_LOGIN_FAILED', 'User', { tenantId: tenant.id }, user.id, { email: dto.email, slug })
                .catch(() => {});
            throw new UnauthorizedException('Invalid credentials');
        }

        const customer = await this.db.customer.findFirst({
            where: { user_id: user.id, tenant_id: tenant.id, deleted_at: null },
        });
        if (!customer) {
            throw new UnauthorizedException('No customer account found for this store. Please sign up first.');
        }

        // Owner/staff accounts can also be customers. If they protect their login
        // with TOTP, the storefront must ask for it too — otherwise the shop's own
        // login page becomes a password-only path around their second factor.
        if (this.totp.isEnabled(user.totp_secret)) {
            return { requires_2fa: true, user_id: user.id };
        }

        this.audit
            .log('STOREFRONT_CUSTOMER_LOGIN', 'Customer', { userId: user.id, tenantId: tenant.id }, customer.id, { slug })
            .catch(() => {});

        return this.issueCustomerAuthResponse(user, customer, tenant.id);
    }

    /** Second leg of a 2FA storefront login: exchange a TOTP code for the session. */
    async completeCustomerTwoFactorLogin(slug: string, userId: string, code: string) {
        const tenant = await this.findEnabledTenant(slug);

        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const customer = await this.db.customer.findFirst({
            where: { user_id: user.id, tenant_id: tenant.id, deleted_at: null },
        });
        if (!customer) {
            throw new UnauthorizedException('No customer account found for this store. Please sign up first.');
        }

        await this.totp.verifyTotpForLogin(userId, code);

        this.audit
            .log('STOREFRONT_CUSTOMER_LOGIN', 'Customer', { userId: user.id, tenantId: tenant.id }, customer.id, {
                slug,
                two_factor: true,
            })
            .catch(() => {});

        return this.issueCustomerAuthResponse(user, customer, tenant.id);
    }

    /**
     * Revoke every storefront session for this shopper. Bumps only
     * `storefront_token_version`, so the same person's ERP workspace session
     * (if they have one) survives.
     */
    async customerLogout(userId: string) {
        await this.db.user.update({
            where: { id: userId },
            data: { storefront_token_version: { increment: 1 } },
        });
        // Scope the row to the shop(s) this person buys from, so it lands in the
        // same audit view as the matching STOREFRONT_CUSTOMER_LOGIN.
        const customers = await this.db.customer.findMany({
            where: { user_id: userId, deleted_at: null },
            select: { id: true, tenant_id: true },
        });
        if (!customers.length) {
            this.audit.log('STOREFRONT_CUSTOMER_LOGOUT', 'Customer', { userId }, userId).catch(() => {});
        } else {
            for (const customer of customers) {
                this.audit
                    .log(
                        'STOREFRONT_CUSTOMER_LOGOUT',
                        'Customer',
                        { userId, tenantId: customer.tenant_id },
                        customer.id,
                    )
                    .catch(() => {});
            }
        }
        return { success: true };
    }

    async getCustomerProfile(slug: string, userId: string, tokenTenantId?: string | null) {
        const tenant = await this.findEnabledTenant(slug);
        this.assertTokenMatchesTenant(tenant.id, tokenTenantId);
        const customer = await this.db.customer.findFirst({
            where: { user_id: userId, tenant_id: tenant.id, deleted_at: null },
        });
        if (!customer) throw new NotFoundException('Customer profile not found');

        return {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            loyalty_points: customer.loyalty_points,
            total_spent: customer.total_spent,
        };
    }

    async getCustomerOrders(
        slug: string,
        userId: string,
        page: number,
        limit: number,
        tokenTenantId?: string | null,
    ) {
        const tenant = await this.findEnabledTenant(slug);
        this.assertTokenMatchesTenant(tenant.id, tokenTenantId);

        const customer = await this.db.customer.findFirst({
            where: { user_id: userId, tenant_id: tenant.id, deleted_at: null },
        });
        if (!customer) throw new NotFoundException('Customer profile not found');

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.db.storefrontOrder.findMany({
                where: { tenantId: tenant.id, customerUserId: userId },
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, name: true } },
                        },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.storefrontOrder.count({ where: { tenantId: tenant.id, customerUserId: userId } }),
        ]);

        return paginate(items, total, page, limit);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async resolvePriceListForUser(tenantId: string, userId?: string) {
        if (!userId) {
            return this.priceListsService.resolvePriceListForCustomer(tenantId, null);
        }

        const customer = await this.db.customer.findFirst({
            where: { user_id: userId, tenant_id: tenantId, deleted_at: null },
            select: { customer_group_id: true },
        });

        return this.priceListsService.resolvePriceListForCustomer(tenantId, customer?.customer_group_id);
    }

    private async findEnabledTenant(slug: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { storefront_slug: slug, storefront_enabled: true, deleted_at: null },
            select: {
                id: true,
                name: true,
                storefront_banner: true,
                storefront_hero_image: true,
                storefront_hero_headline: true,
                loyalty_points_enabled: true,
                loyalty_earn_rate: true,
                loyalty_redeem_rate: true,
                loyalty_min_redeem: true,
            },
        });
        if (!tenant) throw new NotFoundException('Storefront not found or not available');
        return tenant;
    }

    /**
     * Storefront tokens are bound to the shop they were minted for. Legacy tokens
     * predating the `tid` claim carry no tenant, so they are let through and fall
     * back to the per-tenant customer lookup that already guarded these reads.
     */
    private assertTokenMatchesTenant(tenantId: string, tokenTenantId?: string | null) {
        if (tokenTenantId && tokenTenantId !== tenantId) {
            throw new UnauthorizedException('Sign in to this store to continue');
        }
    }

    private issueCustomerAuthResponse(user: any, customer: any, tenantId: string) {
        const payload = {
            sub: user.id,
            email: user.email,
            // `stv`, not `tv` — storefront sessions revoke independently of the app's.
            stv: user.storefront_token_version ?? 0,
            scope: AUTH_SCOPE_STOREFRONT,
            tid: tenantId,
        };
        return {
            access_token: this.jwtService.sign(payload),
            customer: {
                id: customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
            },
        };
    }
}
