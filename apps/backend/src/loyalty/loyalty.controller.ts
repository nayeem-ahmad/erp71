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

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class LoyaltyController {
    constructor(private readonly loyaltyService: LoyaltyService) {}

    @Get('settings')
    async getSettings(@Tenant() tenant: TenantContext) {
        return this.loyaltyService.getSettings(tenant.tenantId);
    }

    @Patch('settings')
    async updateSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateLoyaltySettingsDto,
    ) {
        return this.loyaltyService.updateSettings(tenant.tenantId, dto);
    }

    @Get('customers')
    async listCustomers(
        @Tenant() tenant: TenantContext,
        @Query('search') search?: string,
    ) {
        return this.loyaltyService.listCustomersWithPoints(tenant.tenantId, search);
    }

    @Get('customers/:customerId/points')
    async getCustomerPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
    ) {
        return this.loyaltyService.getCustomerPoints(tenant.tenantId, customerId);
    }

    @Post('customers/:customerId/earn')
    async earnPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: EarnPointsDto,
    ) {
        return this.loyaltyService.earnPoints(tenant.tenantId, customerId, dto);
    }

    @Post('customers/:customerId/redeem')
    async redeemPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: RedeemPointsDto,
    ) {
        return this.loyaltyService.redeemPoints(tenant.tenantId, customerId, dto);
    }

    @Post('customers/:customerId/adjust')
    async adjustPoints(
        @Tenant() tenant: TenantContext,
        @Param('customerId') customerId: string,
        @Body() dto: AdjustPointsDto,
    ) {
        return this.loyaltyService.adjustPoints(tenant.tenantId, customerId, dto);
    }
}
