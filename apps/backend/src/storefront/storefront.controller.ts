import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import { PlaceOrderDto, UpdateOrderStatusDto } from './storefront.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('storefront')
export class StorefrontController {
    constructor(private readonly storefrontService: StorefrontService) {}

    /**
     * Protected: tenant views their storefront orders.
     * Must be declared BEFORE :slug to avoid route shadowing.
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

    /** Public: customers place orders */
    @Post(':slug/orders')
    async placeOrder(@Param('slug') slug: string, @Body() dto: PlaceOrderDto) {
        return this.storefrontService.placeOrder(slug, dto);
    }
}
