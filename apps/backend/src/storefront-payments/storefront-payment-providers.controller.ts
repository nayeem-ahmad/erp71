import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PaymentProviderCatalogService } from './payment-provider-catalog.service';
import { CreatePaymentProviderDto, UpdatePaymentProviderDto } from './storefront-payments.dto';

/**
 * The catalog of payment providers the platform offers to shops. Admin-managed
 * because it is a platform decision which gateways exist, not a per-shop one —
 * a shop only supplies its own account details.
 */
@Controller('admin/storefront-payment-providers')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class StorefrontPaymentProvidersController {
    constructor(private readonly catalog: PaymentProviderCatalogService) {}

    @Get()
    list() {
        return this.catalog.listProviders();
    }

    @Post()
    create(@Body() dto: CreatePaymentProviderDto) {
        return this.catalog.createProvider(dto);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdatePaymentProviderDto) {
        return this.catalog.updateProvider(id, dto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.catalog.deleteProvider(id);
    }

    /** Re-creates the built-in SSLCommerz row if it was deleted. */
    @Post('restore-defaults')
    restoreDefaults(@Request() _req: any) {
        return this.catalog.bootstrapDefaults();
    }
}
