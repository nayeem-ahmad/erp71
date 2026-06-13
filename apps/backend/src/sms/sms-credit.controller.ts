import { Body, Controller, Get, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { SmsCreditService } from './sms-credit.service';
import { ConfirmSmsCreditsPurchaseDto, PurchaseSmsCreditsDto } from './sms-credit.dto';

@Controller('sms-credits')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SmsCreditController {
    constructor(private readonly smsCreditService: SmsCreditService) {}

    @Get('summary')
    getSummary(@Request() req: any, @Tenant() tenant: TenantContext) {
        return this.smsCreditService.getSummary(req.user.userId, tenant.tenantId);
    }

    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post('purchase')
    createPurchase(
        @Request() req: any,
        @Tenant() tenant: TenantContext,
        @Body() dto: PurchaseSmsCreditsDto,
    ) {
        return this.smsCreditService.createPurchase(req.user.userId, tenant.tenantId, dto);
    }

    @Post('confirm')
    confirmPurchase(
        @Request() req: any,
        @Tenant() tenant: TenantContext,
        @Body() dto: ConfirmSmsCreditsPurchaseDto,
    ) {
        return this.smsCreditService.confirmPurchase(req.user.userId, tenant.tenantId, dto);
    }
}
