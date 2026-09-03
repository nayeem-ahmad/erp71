import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RefereeGuard } from './referee.guard';
import { ReferralsService } from './referrals.service';
import { CreatePayoutRequestDto, UpdatePayoutProfileDto } from './referrals.dto';

@Controller('referrals')
@UseGuards(JwtAuthGuard, RefereeGuard)
export class RefereePortalController {
    constructor(private readonly referrals: ReferralsService) {}

    @Get('me')
    getProfile(@Request() req: any) {
        return {
            referee: req.referee,
        };
    }

    @Get('me/ledger')
    getLedger(@Request() req: any) {
        return this.referrals.getLedger(req.referee.id);
    }

    // ── Payouts ───────────────────────────────────────────────────────────────

    @Get('me/payout-profile')
    getPayoutProfile(@Request() req: any) {
        return this.referrals.getPayoutProfile(req.referee.id);
    }

    @Put('me/payout-profile')
    updatePayoutProfile(@Request() req: any, @Body() dto: UpdatePayoutProfileDto) {
        return this.referrals.updatePayoutProfile(req.referee.id, dto);
    }

    @Get('me/payout-requests')
    listPayoutRequests(@Request() req: any) {
        return this.referrals.listPayoutRequests(req.referee.id);
    }

    @Post('me/payout-requests')
    requestPayout(@Request() req: any, @Body() dto: CreatePayoutRequestDto) {
        return this.referrals.requestPayout(req.referee.id, dto);
    }

    @Post('me/payout-requests/:id/cancel')
    cancelPayoutRequest(@Request() req: any, @Param('id') id: string) {
        return this.referrals.cancelPayoutRequest(req.referee.id, id);
    }
}
