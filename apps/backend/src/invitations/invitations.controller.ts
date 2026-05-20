import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsEmail, IsEnum, IsString } from 'class-validator';
import { UserRole } from '@retail-saas/shared-types';

class InviteDto {
    @IsEmail()
    email: string;

    @IsEnum(UserRole)
    role: UserRole;

    @IsString()
    tenantId: string;
}

class AcceptInvitationDto {
    @IsString()
    token: string;
}

@Controller('invitations')
export class InvitationsController {
    constructor(private service: InvitationsService) {}

    @UseGuards(JwtAuthGuard)
    @Post('send')
    async invite(@Request() req, @Body() dto: InviteDto) {
        await this.service.invite(dto.tenantId, req.user.userId, dto.email, dto.role);
        return { message: 'Invitation sent.' };
    }

    @UseGuards(JwtAuthGuard)
    @Post('accept')
    async accept(@Request() req, @Body() dto: AcceptInvitationDto) {
        await this.service.accept(dto.token, req.user.userId);
        return { message: 'Invitation accepted.' };
    }
}
