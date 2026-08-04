import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReferralsService } from './referrals.service';
import { TrackClickDto } from './referrals.dto';

/**
 * Public, unauthenticated click tracking.
 *
 * Separate controller rather than a route on RefereePortalController, because
 * that one guards every route with JwtAuthGuard + RefereeGuard and the whole
 * point of this endpoint is that the caller is an anonymous visitor.
 *
 * Throttled well above ordinary traffic but far below what would make click
 * inflation cheap. It always returns 204 — an unknown or inactive code is not
 * distinguishable from a recorded one, so this cannot be used to enumerate
 * which referral codes exist.
 */
@Controller('referrals')
export class ReferralTrackingController {
    constructor(private readonly referrals: ReferralsService) {}

    @Post('clicks/:code')
    @Throttle({ default: { ttl: 60_000, limit: 30 } })
    async trackClick(@Param('code') code: string, @Body() dto: TrackClickDto): Promise<void> {
        await this.referrals.recordClick(code, dto);
    }
}
