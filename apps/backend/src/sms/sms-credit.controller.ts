import { Body, Controller, Get, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { SmsCreditService } from './sms-credit.service';
import { NoAudit } from '../audit/no-audit.decorator';
import { ConfirmSmsCreditsPurchaseDto, PurchaseSmsCreditsDto } from './sms-credit.dto';

@Controller('sms-credits')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SmsCreditController {
    constructor(private readonly smsCreditService: SmsCreditService) {}

    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext) {
        return this.smsCreditService.getSummary(tenant);
    }

    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post('purchase')
    createPurchase(
        @Tenant() tenant: TenantContext,
        @Body() dto: PurchaseSmsCreditsDto,
    ) {
        return this.smsCreditService.createPurchase(tenant, dto);
    }

    @Post('confirm')
    @NoAudit()
    confirmPurchase(
        @Tenant() tenant: TenantContext,
        @Body() dto: ConfirmSmsCreditsPurchaseDto,
    ) {
        return this.smsCreditService.confirmPurchase(tenant, dto);
    }
}
