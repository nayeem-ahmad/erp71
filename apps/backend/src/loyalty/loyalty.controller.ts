import {
    Controller,
    Get,
    Patch,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { UpdateLoyaltySettingsDto, EarnPointsDto, RedeemPointsDto, AdjustPointsDto } from './loyalty.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { LOYALTY_ADJUST, SALES_READ, SALE_WRITE } from '../auth/permission-sets';
@Controller('loyalty')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class LoyaltyController {
    constructor(private readonly loyaltyService: LoyaltyService) {}

    @RequireAnyStorePermission(...SALES_READ)
    @Get('settings')
    async getSettings(@Tenant() tenant: TenantContext) {
        return this.loyaltyService.getSettings(tenant.tenantId);
    }

    @RequireAnyStorePermission(...LOYALTY_ADJUST)
    @Patch('settings')
    async updateSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateLoyaltySettingsDto,
    ) {
        return this.loyaltyService.updateSettings(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get('customers')
    async listCustomers(
        @Tenant() tenant: TenantContext,
        @Query('search') search?: string,
    ) {
        return this.loyaltyService.listCustomersWithPoints(tenant.tenantId, search);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get('customers/:customerId/points')
    async getCustomerPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
    ) {
        return this.loyaltyService.getCustomerPoints(tenant.tenantId, customerId);
    }

    @RequireAnyStorePermission(...SALE_WRITE)
    @Post('customers/:customerId/earn')
    async earnPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: EarnPointsDto,
    ) {
        return this.loyaltyService.earnPoints(tenant.tenantId, customerId, dto);
    }

    @RequireAnyStorePermission(...SALE_WRITE)
    @Post('customers/:customerId/redeem')
    async redeemPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: RedeemPointsDto,
    ) {
        return this.loyaltyService.redeemPoints(tenant.tenantId, customerId, dto);
    }

    @RequireAnyStorePermission(...LOYALTY_ADJUST)
    @Post('customers/:customerId/adjust')
    async adjustPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: AdjustPointsDto,
    ) {
        return this.loyaltyService.adjustPoints(tenant.tenantId, customerId, dto);
    }
}
