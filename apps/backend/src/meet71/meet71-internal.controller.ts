import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseService } from '../database/database.service';
import { Meet71Actor, Meet71MembershipService } from './meet71-membership.service';
import { Meet71ServiceGuard } from './meet71-service.guard';
import { Meet71SsoService } from './meet71-sso.service';
import {
    AddMeet71AllowlistDto,
    CreateMeet71RoomDto,
    ExchangeMeet71SsoDto,
    GoogleUpsertDto,
    PatchMeet71MemberDto,
    PatchMeet71RoomDto,
} from './meet71.dto';

@Controller('internal/meet71')
@SkipThrottle()
@UseGuards(Meet71ServiceGuard)
export class Meet71InternalController {
    constructor(
        private membership: Meet71MembershipService,
        private sso: Meet71SsoService,
        private db: DatabaseService,
    ) {}

    @Post('sso/exchange')
    @HttpCode(HttpStatus.OK)
    exchange(@Body() dto: ExchangeMeet71SsoDto) {
        return this.sso.exchange({
            code: dto.code,
            codeVerifier: dto.code_verifier,
            returnUrl: dto.return_url,
        });
    }

    @Post('sso/google-upsert')
    @HttpCode(HttpStatus.OK)
    googleUpsert(@Body() dto: GoogleUpsertDto) {
        return this.membership.upsertOnSignIn(dto.email, dto.displayName ?? null);
    }

    @Get('membership')
    membershipFor(@Query('email') email: string) {
        if (!email) {
            throw new BadRequestException({ code: 'MEET71_EMAIL_REQUIRED', message: 'email is required' });
        }
        return this.membership.evaluate(email);
    }

    @Post('rooms')
    @HttpCode(HttpStatus.OK)
    async createRoom(@Body() dto: CreateMeet71RoomDto) {
        const row = await this.db.meet71Room.create({
            data: {
                code: dto.code,
                created_by_email: dto.createdByEmail.trim().toLowerCase(),
            },
        });
        return { code: row.code, createdByEmail: row.created_by_email, createdAt: row.created_at };
    }

    @Get('rooms/:code')
    async getRoom(@Param('code') code: string) {
        const row = await this.db.meet71Room.findUnique({ where: { code } });
        if (!row) throw new NotFoundException();
        return { code: row.code, createdByEmail: row.created_by_email };
    }

    @Patch('rooms/:code')
    patchRoom(
        @Param('code') code: string,
        @Body() dto: PatchMeet71RoomDto,
        @Headers('x-meet71-actor-email') actorEmail?: string,
    ) {
        return this.membership.patchRoom(code, dto.createdByEmail, actorFromHeader(actorEmail));
    }

    @Get('members')
    listMembers() {
        return this.membership.listAdmin();
    }

    @Put('allowlist')
    addAllowlist(
        @Body() dto: AddMeet71AllowlistDto,
        @Headers('x-meet71-actor-email') actorEmail?: string,
    ) {
        return this.membership.addAllowlist(dto.pattern, actorFromHeader(actorEmail));
    }

    @Delete('allowlist/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    removeAllowlist(@Param('id') id: string, @Headers('x-meet71-actor-email') actorEmail?: string) {
        return this.membership.removeAllowlist(id, actorFromHeader(actorEmail));
    }

    @Patch('members/:email')
    patchMember(
        @Param('email') email: string,
        @Body() dto: PatchMeet71MemberDto,
        @Headers('x-meet71-actor-email') actorEmail?: string,
    ) {
        return this.membership.patchMember(email, dto, actorFromHeader(actorEmail));
    }

    @Delete('members/:email')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteMember(@Param('email') email: string, @Headers('x-meet71-actor-email') actorEmail?: string) {
        return this.membership.deleteMember(email, actorFromHeader(actorEmail));
    }

    @Delete('denials/:email')
    @HttpCode(HttpStatus.NO_CONTENT)
    removeDenial(@Param('email') email: string, @Headers('x-meet71-actor-email') actorEmail?: string) {
        return this.membership.removeDenial(email, actorFromHeader(actorEmail));
    }
}

function actorFromHeader(actorEmail?: string): Meet71Actor {
    return { email: actorEmail || null };
}
