import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StorefrontService } from './storefront.service';
import {
    PlaceOrderDto,
    UpdateOrderStatusDto,
    CustomerSignupDto,
    CustomerLoginDto,
    CustomerTwoFactorLoginDto,
    CustomerGoogleSignInDto,
    CustomerMobileSignInDto,
    CustomerForgotPasswordDto,
    UpdateCustomerProfileDto,
} from './storefront.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { StorefrontCustomerGuard } from '../auth/storefront-customer.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { STOREFRONT_STAFF } from '../auth/permission-sets';
import { BranchScopeService } from '../database/branch-scope.service';

@Controller('storefront')
export class StorefrontController {
    constructor(
        private readonly storefrontService: StorefrontService,
        private readonly branchScope: BranchScopeService,
    ) {}

    /**
     * Protected: tenant views their storefront orders.
     * Must be declared BEFORE :slug routes to avoid shadowing.
     */
    @RequireAnyStorePermission(...STOREFRONT_STAFF)
    @Get('orders')
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    async getOrders(
        @Tenant() tenant: TenantContext,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('storeId') storeId?: string,
    ) {
        // Web orders belong to the online branch; the panel follows the page's
        // branch filter, under the same access rule as every branch-aware list.
        const branch = await this.branchScope.resolveStoreId(tenant, storeId, { permissions: STOREFRONT_STAFF });
        return this.storefrontService.getOrders(
            tenant.tenantId,
            parseInt(page, 10),
            Math.min(parseInt(limit, 10), 100),
            branch,
        );
    }

    /** Protected: tenant updates an order status */
    @RequireAnyStorePermission(...STOREFRONT_STAFF)
    @Patch('orders/:id/status')
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    async updateOrderStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateOrderStatusDto,
    ) {
        // Only someone who may use the order's (online) branch changes it.
        await this.branchScope.resolveStoreId(
            tenant,
            await this.storefrontService.orderStoreId(tenant.tenantId, id),
            { permissions: STOREFRONT_STAFF },
        );
        return this.storefrontService.updateOrderStatus(tenant.tenantId, id, dto.status);
    }

    /** Public (optional auth): browse a storefront by slug */
    @Get(':slug')
    @UseGuards(OptionalJwtAuthGuard)
    async getStorefront(@Param('slug') slug: string, @Req() req: any) {
        return this.storefrontService.getStorefront(slug, req.user?.userId);
    }

    /**
     * Public: the shop's identity alone, for a page's `<head>`.
     *
     * Declared before `:slug/products/:productId` and after `:slug` purely for
     * readability — neither can shadow a two-segment literal path.
     */
    @Get(':slug/meta')
    getStorefrontMeta(@Param('slug') slug: string) {
        return this.storefrontService.getStorefrontMeta(slug);
    }

    /** Public: one product, for a shareable product page. */
    @Get(':slug/products/:productId')
    getPublicProduct(@Param('slug') slug: string, @Param('productId') productId: string) {
        return this.storefrontService.getPublicProduct(slug, productId);
    }

    /**
     * Public (optional auth): place an order — attaches customerUserId if signed in.
     *
     * Throttled harder than the platform default because each order emails the
     * address it was given, billed to the shop: without a limit this is a way
     * to point a shop's email credits at someone else's inbox.
     */
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post(':slug/orders')
    @UseGuards(OptionalJwtAuthGuard)
    async placeOrder(
        @Param('slug') slug: string,
        @Body() dto: PlaceOrderDto,
        @Req() req: any,
    ) {
        return this.storefrontService.placeOrder(slug, dto, req.user?.userId);
    }

    /**
     * Public: customer sign up for a storefront.
     *
     * This and the password and 2FA sign-ins below are public and run bcrypt
     * on every call, and had only the platform default to slow guessing: 20 a
     * minute per address. When that default moved to the signed-in user (and
     * 120 a minute), they were pinned at the 20 they had.
     */
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post(':slug/auth/signup')
    async customerSignup(@Param('slug') slug: string, @Body() dto: CustomerSignupDto) {
        return this.storefrontService.customerSignup(slug, dto);
    }

    /**
     * Public: customer sign in to a storefront.
     * Returns `{ requires_2fa, user_id }` instead of a session when the account
     * has TOTP enabled — see `:slug/auth/2fa/verify`.
     */
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post(':slug/auth/login')
    async customerLogin(@Param('slug') slug: string, @Body() dto: CustomerLoginDto) {
        return this.storefrontService.customerLogin(slug, dto);
    }

    /**
     * Public: sign in — or sign up — with Google.
     *
     * One route for both, because a Google account this shop has never seen is
     * given a customer record rather than turned away. Answers `requires_2fa`
     * like the password path when the account carries a second factor.
     *
     * The client id the browser needs comes from `GET /auth/google/config`,
     * which is public and shared with the ERP login page — a deployment
     * configures Google once, not once per surface.
     */
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post(':slug/auth/google')
    async customerGoogleSignIn(@Param('slug') slug: string, @Body() dto: CustomerGoogleSignInDto) {
        return this.storefrontService.customerGoogleSignIn(slug, dto);
    }

    /**
     * Public: sign in — or sign up — with a mobile number, once the browser has
     * verified it by SMS through Firebase.
     *
     * Answers `{ requires_signup, mobile }` when the number belongs to nobody
     * yet: an account needs an email address, which the caller then collects and
     * posts back with the same token. Firebase's public web config comes from
     * `GET /auth/firebase/config`.
     */
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post(':slug/auth/mobile')
    async customerMobileSignIn(@Param('slug') slug: string, @Body() dto: CustomerMobileSignInDto) {
        return this.storefrontService.customerMobileSignIn(slug, dto);
    }

    /**
     * Public: email a reset link that lands back on this shop. Answers the
     * same whether or not the address has an account here.
     */
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Post(':slug/auth/forgot-password')
    async customerForgotPassword(@Param('slug') slug: string, @Body() dto: CustomerForgotPasswordDto) {
        return this.storefrontService.customerForgotPassword(slug, dto.email);
    }

    /** Public: second leg of a 2FA storefront sign-in */
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post(':slug/auth/2fa/verify')
    async customerTwoFactorVerify(@Param('slug') slug: string, @Body() dto: CustomerTwoFactorLoginDto) {
        return this.storefrontService.completeCustomerTwoFactorLogin(slug, dto.userId, dto.code);
    }

    /** Protected: revoke this shopper's storefront sessions */
    @Post(':slug/auth/logout')
    @UseGuards(StorefrontCustomerGuard)
    async customerLogout(@Req() req: any) {
        return this.storefrontService.customerLogout(req.user.userId);
    }

    /** Protected: get signed-in customer's profile */
    @Get(':slug/customer/me')
    @UseGuards(StorefrontCustomerGuard)
    async getCustomerProfile(@Param('slug') slug: string, @Req() req: any) {
        return this.storefrontService.getCustomerProfile(slug, req.user.userId, req.user.storefrontTenantId);
    }

    /** Protected: the signed-in customer edits their name, phone and address at this shop */
    @Patch(':slug/customer/me')
    @UseGuards(StorefrontCustomerGuard)
    async updateCustomerProfile(
        @Param('slug') slug: string,
        @Req() req: any,
        @Body() dto: UpdateCustomerProfileDto,
    ) {
        return this.storefrontService.updateCustomerProfile(slug, req.user.userId, dto, req.user.storefrontTenantId);
    }

    /** Protected: get signed-in customer's order history */
    @Get(':slug/customer/orders')
    @UseGuards(StorefrontCustomerGuard)
    async getCustomerOrders(
        @Param('slug') slug: string,
        @Req() req: any,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.storefrontService.getCustomerOrders(
            slug,
            req.user.userId,
            parseInt(page, 10),
            Math.min(parseInt(limit, 10), 100),
            req.user.storefrontTenantId,
        );
    }
}
