import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { Meet71InviteService } from './meet71-invite.service';
import { Meet71Actor, Meet71MembershipService } from './meet71-membership.service';
import { AddMeet71AllowlistDto, InviteMeet71Dto, PatchMeet71MemberDto, PatchMeet71RoomDto } from './meet71.dto';

@Controller('admin/meet71')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class Meet71AdminController {
    constructor(
        private membership: Meet71MembershipService,
        private invites: Meet71InviteService,
    ) {}

    @Get()
    list() {
        return this.membership.listAdmin();
    }

    @Post('allowlist')
    addAllowlist(@Body() dto: AddMeet71AllowlistDto, @Request() req: { user?: Meet71Actor }) {
        return this.membership.addAllowlist(dto.pattern, actorFromUser(req.user));
    }

    @Delete('allowlist/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    removeAllowlist(@Param('id') id: string, @Request() req: { user?: Meet71Actor }) {
        return this.membership.removeAllowlist(id, actorFromUser(req.user));
    }

    @Patch('members/:email')
    patchMember(
        @Param('email') email: string,
        @Body() dto: PatchMeet71MemberDto,
        @Request() req: { user?: Meet71Actor },
    ) {
        return this.membership.patchMember(email, dto, actorFromUser(req.user));
    }

    @Delete('members/:email')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteMember(@Param('email') email: string, @Request() req: { user?: Meet71Actor }) {
        return this.membership.deleteMember(email, actorFromUser(req.user));
    }

    @Delete('denials/:email')
    @HttpCode(HttpStatus.NO_CONTENT)
    removeDenial(@Param('email') email: string, @Request() req: { user?: Meet71Actor }) {
        return this.membership.removeDenial(email, actorFromUser(req.user));
    }

    @Patch('rooms/:code')
    patchRoom(
        @Param('code') code: string,
        @Body() dto: PatchMeet71RoomDto,
        @Request() req: { user?: Meet71Actor },
    ) {
        return this.membership.patchRoom(code, dto.createdByEmail, actorFromUser(req.user));
    }

    @Post('invites')
    invite(@Body() dto: InviteMeet71Dto, @Request() req: { user?: Meet71Actor }) {
        return this.invites.invite({
            email: dto.email,
            actorEmail: req.user?.email ?? '',
            resend: dto.resend,
            unlimited: true,
        });
    }
}

function actorFromUser(user: Meet71Actor | undefined): Meet71Actor {
    return { userId: user?.userId, email: user?.email };
}
