import {
    Body,
    Controller,
    ForbiddenException,
    HttpCode,
    HttpStatus,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AllowWhenSuspended } from '../auth/billing-suspension.decorator';
import { ThrottleAccount } from '../common/account-throttle.util';
import { DatabaseService } from '../database/database.service';
import { Meet71MembershipService } from './meet71-membership.service';
import { assertMeet71ReturnUrl } from './meet71-return-url';
import { Meet71SsoService } from './meet71-sso.service';
import { MintMeet71SsoCodeDto } from './meet71.dto';

@Controller('meet71')
@UseGuards(JwtAuthGuard)
export class Meet71Controller {
    constructor(
        private membership: Meet71MembershipService,
        private sso: Meet71SsoService,
        private db: DatabaseService,
    ) {}

    @Post('sso/code')
    @HttpCode(HttpStatus.OK)
    @AllowWhenSuspended()
    @ThrottleAccount({ ttl: 60_000, limit: 20 })
    async mint(
        @Request() req: { user: { userId: string; email: string } },
        @Body() dto: MintMeet71SsoCodeDto,
    ) {
        const returnUrl = assertMeet71ReturnUrl(dto.return_url);
        const email = req.user.email;
        const membership = await this.membership.evaluate(email);
        if (!membership.allowed) {
            throw new ForbiddenException({
                code: 'MEET71_NOT_ALLOWED',
                message: 'This account is not on the Meet71 list.',
            });
        }

        const user = await this.db.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true, email: true },
        });

        return this.sso.mint({
            userId: req.user.userId,
            email,
            displayName: user?.name ?? user?.email ?? email,
            returnUrl,
            codeChallenge: dto.code_challenge,
            codeChallengeMethod: 'S256',
        });
    }
}
