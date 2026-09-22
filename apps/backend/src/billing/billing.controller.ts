import {
    All,
    Body,
    Controller,
    Get,
    Headers,
    Query,
    Post,
    Res,
    Request,
    UseGuards,
    UseInterceptors,
    ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { BillingService } from './billing.service';
import { NoAudit } from '../audit/no-audit.decorator';
import {
    BillingCallbackDto,
    ConfirmCheckoutDto,
    CreateCheckoutSessionDto,
    ManualBillingWebhookDto,
    RefundBillingDto,
} from './billing.dto';

/**
 * Gateway callbacks carry more fields than BillingCallbackDto declares, so the
 * strict global pipe (forbidNonWhitelisted) would 400 a real payment
 * notification. These routes keep validation and stripping but drop the
 * rejection — losing a payment confirmation costs more than an extra field.
 */
const callbackPipe = new ValidationPipe({ whitelist: true, transform: true });

@Controller('billing')
export class BillingController {
    constructor(private readonly billingService: BillingService) {}

    @Get('summary')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    getSummary(@Tenant() tenant: TenantContext) {
        return this.billingService.getSummary(tenant);
    }

    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Post('checkout-session')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    createCheckoutSession(
        @Tenant() tenant: TenantContext,
        @Body() dto: CreateCheckoutSessionDto,
    ) {
        return this.billingService.createCheckoutSession(tenant, dto);
    }

    @Post('confirm')
    @NoAudit()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    confirmCheckout(
        @Tenant() tenant: TenantContext,
        @Body() dto: ConfirmCheckoutDto,
    ) {
        return this.billingService.confirmCheckout(tenant, dto);
    }

    @Post('cancel-at-period-end')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    cancelAtPeriodEnd(@Tenant() tenant: TenantContext) {
        return this.billingService.cancelAtPeriodEnd(tenant);
    }

    @Post('refund')
    @NoAudit()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    processRefund(
        @Tenant() tenant: TenantContext,
        @Body() dto: RefundBillingDto,
    ) {
        return this.billingService.processRefund(tenant, dto);
    }

    @Post('webhooks/manual')
    handleManualWebhook(
        @Headers('x-billing-webhook-secret') signature: string | undefined,
        @Body() dto: ManualBillingWebhookDto,
    ) {
        return this.billingService.handleManualWebhook(signature, dto);
    }

    @All('callbacks/ssl-wireless/success')
    async handleSslWirelessSuccess(
        @Body(callbackPipe) body: BillingCallbackDto,
        @Query(callbackPipe) query: BillingCallbackDto,
        @Res() res: any,
    ) {
        const redirectUrl = await this.billingService.handleSslWirelessCallback({ ...query, ...body }, 'success');
        return res.redirect(redirectUrl);
    }

    @All('callbacks/ssl-wireless/fail')
    async handleSslWirelessFail(
        @Body(callbackPipe) body: BillingCallbackDto,
        @Query(callbackPipe) query: BillingCallbackDto,
        @Res() res: any,
    ) {
        const redirectUrl = await this.billingService.handleSslWirelessCallback({ ...query, ...body }, 'fail');
        return res.redirect(redirectUrl);
    }

    @All('callbacks/ssl-wireless/cancel')
    async handleSslWirelessCancel(
        @Body(callbackPipe) body: BillingCallbackDto,
        @Query(callbackPipe) query: BillingCallbackDto,
        @Res() res: any,
    ) {
        const redirectUrl = await this.billingService.handleSslWirelessCallback({ ...query, ...body }, 'cancel');
        return res.redirect(redirectUrl);
    }

    @All('webhooks/ssl-wireless')
    handleSslWirelessWebhook(
        @Body(callbackPipe) body: BillingCallbackDto,
        @Query(callbackPipe) query: BillingCallbackDto,
    ) {
        return this.billingService.handleSslWirelessCallback({ ...query, ...body }, 'ipn');
    }
}