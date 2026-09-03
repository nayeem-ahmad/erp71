import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ReferralsService } from './referrals.service';
import {
    CreateRefereeDto,
    ListCommissionsQueryDto,
    ListPayoutRequestsQueryDto,
    ListRefereesQueryDto,
    RecordPaymentDto,
    RejectPayoutRequestDto,
    UpdateRefereeDto,
} from './referrals.dto';

@Controller('admin/referrals')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class ReferralsController {
    constructor(private readonly referrals: ReferralsService) {}

    // ── Referees ──────────────────────────────────────────────────────────────

    @Get('referees')
    listReferees(@Query() query: ListRefereesQueryDto) {
        return this.referrals.listReferees(query);
    }

    @Post('referees')
    createReferee(@Body() dto: CreateRefereeDto, @Request() req: any) {
        return this.referrals.createReferee(dto, req.user.userId);
    }

    @Get('referees/:id')
    getReferee(@Param('id') id: string) {
        return this.referrals.getReferee(id);
    }

    @Patch('referees/:id')
    updateReferee(@Param('id') id: string, @Body() dto: UpdateRefereeDto) {
        return this.referrals.updateReferee(id, dto);
    }

    @Delete('referees/:id')
    deleteReferee(@Param('id') id: string) {
        return this.referrals.deleteReferee(id);
    }

    @Get('referees/:id/ledger')
    getLedger(@Param('id') id: string) {
        return this.referrals.getLedger(id);
    }

    @Get('referees/:id/payments')
    listPayments(@Param('id') id: string) {
        return this.referrals.listPayments(id);
    }

    @Post('referees/:id/payments')
    recordPayment(
        @Param('id') id: string,
        @Body() dto: RecordPaymentDto,
        @Request() req: any,
    ) {
        return this.referrals.recordPayment(id, dto, req.user.userId);
    }

    @Post('referees/:id/send-invite')
    sendInvite(@Param('id') id: string) {
        return this.referrals.sendRefereeLoginInvite(id);
    }

    // ── Payout requests ───────────────────────────────────────────────────────

    @Get('payout-requests')
    listPayoutRequests(@Query() query: ListPayoutRequestsQueryDto) {
        return this.referrals.listAllPayoutRequests(query);
    }

    @Post('payout-requests/:id/approve')
    approvePayoutRequest(@Param('id') id: string, @Request() req: any) {
        return this.referrals.approvePayoutRequest(id, req.user.userId);
    }

    @Post('payout-requests/:id/reject')
    rejectPayoutRequest(
        @Param('id') id: string,
        @Body() dto: RejectPayoutRequestDto,
        @Request() req: any,
    ) {
        return this.referrals.rejectPayoutRequest(id, dto.reason, req.user.userId);
    }

    // ── Commissions ───────────────────────────────────────────────────────────

    @Get('commissions')
    listCommissions(@Query() query: ListCommissionsQueryDto) {
        return this.referrals.listCommissions(query);
    }
}
