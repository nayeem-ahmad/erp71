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
import { StorefrontService } from './storefront.service';
import { PlaceOrderDto, UpdateOrderStatusDto, CustomerSignupDto, CustomerLoginDto } from './storefront.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('storefront')
export class StorefrontController {
    constructor(private readonly storefrontService: StorefrontService) {}

    /**
     * Protected: tenant views their storefront orders.
     * Must be declared BEFORE :slug routes to avoid shadowing.
     */
    @Get('orders')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async getOrders(
        @Tenant() tenant: TenantContext,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.storefrontService.getOrders(
            tenant.tenantId,
            parseInt(page, 10),
            Math.min(parseInt(limit, 10), 100),
        );
    }

    /** Protected: tenant updates an order status */
    @Patch('orders/:id/status')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async updateOrderStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateOrderStatusDto,
    ) {
        return this.storefrontService.updateOrderStatus(tenant.tenantId, id, dto.status);
    }

    /** Public: browse a storefront by slug */
    @Get(':slug')
    async getStorefront(@Param('slug') slug: string) {
        return this.storefrontService.getStorefront(slug);
    }

    /** Public (optional auth): place an order — attaches customerUserId if signed in */
    @Post(':slug/orders')
    @UseGuards(OptionalJwtAuthGuard)
    async placeOrder(
        @Param('slug') slug: string,
        @Body() dto: PlaceOrderDto,
        @Req() req: any,
    ) {
        return this.storefrontService.placeOrder(slug, dto, req.user?.userId);
    }

    /** Public: customer sign up for a storefront */
    @Post(':slug/auth/signup')
    async customerSignup(@Param('slug') slug: string, @Body() dto: CustomerSignupDto) {
        return this.storefrontService.customerSignup(slug, dto);
    }

    /** Public: customer sign in to a storefront */
    @Post(':slug/auth/login')
    async customerLogin(@Param('slug') slug: string, @Body() dto: CustomerLoginDto) {
        return this.storefrontService.customerLogin(slug, dto);
    }

    /** Protected: get signed-in customer's profile */
    @Get(':slug/customer/me')
    @UseGuards(JwtAuthGuard)
    async getCustomerProfile(@Param('slug') slug: string, @Req() req: any) {
        return this.storefrontService.getCustomerProfile(slug, req.user.userId);
    }

    /** Protected: get signed-in customer's order history */
    @Get(':slug/customer/orders')
    @UseGuards(JwtAuthGuard)
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
        );
    }
}
