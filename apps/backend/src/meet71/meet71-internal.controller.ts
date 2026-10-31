import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseService } from '../database/database.service';
import { Meet71MembershipService } from './meet71-membership.service';
import { Meet71ServiceGuard } from './meet71-service.guard';
import { Meet71SsoService } from './meet71-sso.service';
import {
    CreateMeet71RoomDto,
    ExchangeMeet71SsoDto,
    GoogleUpsertDto,
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
    async patchRoom(@Param('code') code: string, @Body() dto: PatchMeet71RoomDto) {
        const existing = await this.db.meet71Room.findUnique({ where: { code } });
        if (!existing) throw new NotFoundException();
        const row = await this.db.meet71Room.update({
            where: { code },
            data: { created_by_email: dto.createdByEmail.trim().toLowerCase() },
        });
        return { code: row.code, createdByEmail: row.created_by_email, createdAt: row.created_at };
    }
}
