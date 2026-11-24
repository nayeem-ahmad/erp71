import { Body, Controller, Get, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { StorefrontPaymentService } from './storefront-payment.service';
import { InitiateStorefrontPaymentDto } from './storefront-payments.dto';

type CallbackOutcome = 'success' | 'fail' | 'cancel';

function parseOutcome(value: unknown): CallbackOutcome {
    return value === 'fail' || value === 'cancel' ? value : 'success';
}

/**
 * Public payment endpoints for a storefront. The tenant is resolved from the
 * slug, so one shop's callback can never touch another shop's order.
 */
@Controller('storefront')
export class StorefrontPaymentController {
    private readonly logger = new Logger(StorefrontPaymentController.name);

    constructor(private readonly payments: StorefrontPaymentService) {}

    /** Hands the shopper to their chosen gateway. */
    @Throttle({ default: { ttl: 60_000, limit: 15 } })
    @Post(':slug/orders/:orderId/pay')
    initiate(
        @Param('slug') slug: string,
        @Param('orderId') orderId: string,
        @Body() dto: InitiateStorefrontPaymentDto,
    ) {
        return this.payments.initiate(slug, orderId, dto.providerCode, dto.customerEmail);
    }

    /**
     * The gateway brings the shopper back here. Whatever the outcome, the
     * browser is sent on to the storefront's return page — a callback is a
     * shopper-facing redirect, never a JSON screen.
     */
    @Throttle({ default: { ttl: 60_000, limit: 120 } })
    @Post(':slug/payments/:providerCode/callback')
    async callbackPost(
        @Param('slug') slug: string,
        @Param('providerCode') providerCode: string,
        @Query('outcome') outcome: string | undefined,
        @Body() body: Record<string, unknown>,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        await this.settle(
            res,
            slug,
            providerCode,
            parseOutcome(outcome ?? body.outcome),
            body,
            req.query as Record<string, unknown>,
        );
    }

    /** Some gateways return with a GET instead of a form POST. */
    @Throttle({ default: { ttl: 60_000, limit: 120 } })
    @Get(':slug/payments/:providerCode/callback')
    async callbackGet(
        @Param('slug') slug: string,
        @Param('providerCode') providerCode: string,
        @Query('outcome') outcome: string | undefined,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        await this.settle(res, slug, providerCode, parseOutcome(outcome), req.query as Record<string, unknown>, req.query as Record<string, unknown>);
    }

    /** What the return page reads to show the shopper the result. */
    @Get(':slug/payments/:paymentId')
    status(@Param('slug') slug: string, @Param('paymentId') paymentId: string) {
        return this.payments.getPaymentStatus(slug, paymentId);
    }

    private async settle(
        res: Response,
        slug: string,
        providerCode: string,
        outcome: CallbackOutcome,
        body: Record<string, unknown>,
        query: Record<string, unknown>,
    ) {
        // Gateways split their fields between the body and the query; give the
        // adapter both, with the body's value winning where they overlap.
        const callback = { ...query, ...body };
        try {
            const result = await this.payments.handleCallback(slug, providerCode, outcome, callback);
            res.redirect(302, result.redirectUrl);
        } catch (error) {
            this.logger.error(`Storefront ${slug} payment callback failed: ${(error as Error)?.message ?? error}`);
            const origin = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
            res.redirect(
                302,
                `${origin}/store/${encodeURIComponent(slug)}/payment/return?status=failed`,
            );
        }
    }
}
