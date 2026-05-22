import { Controller, Post, Get, Body, UseGuards, UseInterceptors, Request, Query, ForbiddenException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { IsEmail, IsEnum, IsString } from 'class-validator';
import { UserRole } from '@retail-saas/shared-types';

class InviteDto {
    @IsEmail()
    email: string;

    @IsEnum(UserRole)
    role: UserRole;
}

class AcceptInvitationDto {
    @IsString()
    token: string;
}

@Controller('invitations')
export class InvitationsController {
    constructor(private service: InvitationsService) {}

    // Public — lets the frontend show tenant name / invitee email before prompting login
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Get('info')
    async getInfo(@Query('token') token: string) {
        return this.service.getInfo(token);
    }

    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    @Post('send')
    async invite(@Request() req, @Body() dto: InviteDto) {
        const tenantId: string | undefined = req.tenantId;
        if (!tenantId) throw new ForbiddenException('Tenant context required. Send x-tenant-id header.');
        await this.service.invite(tenantId, req.user.userId, req.userRole, dto.email, dto.role);
        return { message: 'Invitation sent.' };
    }

    // Requires the recipient to be logged in (existing account) or to have signed up first.
    // Frontend flow: click email link → sign up/login → accept.
    @UseGuards(JwtAuthGuard)
    @Post('accept')
    async accept(@Request() req, @Body() dto: AcceptInvitationDto) {
        await this.service.accept(dto.token, req.user.userId);
        return { message: 'Invitation accepted.' };
    }
}
