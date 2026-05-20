import { Controller, Delete, Get, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountService } from './account.service';

@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
    constructor(private accountService: AccountService) {}

    @Delete('data-deletion-request')
    @HttpCode(HttpStatus.ACCEPTED)
    async requestDeletion(@Request() req) {
        await this.accountService.requestDataDeletion(req.user.userId);
        return { message: 'Data deletion request received. We will process it within 30 days.' };
    }

    @Get('data-export')
    async exportData(@Request() req) {
        return this.accountService.exportUserData(req.user.userId);
    }
}
