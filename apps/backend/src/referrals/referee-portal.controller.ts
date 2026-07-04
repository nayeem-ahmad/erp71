import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RefereeGuard } from './referee.guard';
import { ReferralsService } from './referrals.service';

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
}