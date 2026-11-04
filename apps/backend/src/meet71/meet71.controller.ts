import {
    Body,
    Controller,
    ForbiddenException,
    Get,
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
import { Meet71ClientService } from './meet71-client.service';
import { Meet71MembershipService } from './meet71-membership.service';
import { assertMeet71ReturnUrl } from './meet71-return-url';
import { Meet71SsoService } from './meet71-sso.service';
import { MintMeet71SsoCodeDto, StartMeet71CallDto } from './meet71.dto';

type Meet71AuthedRequest = {
    user: { userId: string; email: string };
};

@Controller('meet71')
@UseGuards(JwtAuthGuard)
export class Meet71Controller {
    constructor(
        private membership: Meet71MembershipService,
        private sso: Meet71SsoService,
        private db: DatabaseService,
        private meet71: Meet71ClientService,
    ) {}

    @Post('sso/code')
    @HttpCode(HttpStatus.OK)
    @AllowWhenSuspended()
    @ThrottleAccount({ ttl: 60_000, limit: 20 })
    async mint(@Request() req: Meet71AuthedRequest, @Body() dto: MintMeet71SsoCodeDto) {
        const returnUrl = assertMeet71ReturnUrl(dto.return_url);
        const email = req.user.email;
        await this.assertAllowed(email);

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

    @Get('directory')
    @AllowWhenSuspended()
    async directory(@Request() req: Meet71AuthedRequest) {
        await this.assertAllowed(req.user.email);
        const { members } = await this.membership.listAdmin();
        const self = req.user.email.trim().toLowerCase();
        return members
            .filter((member) => member.email !== self)
            .map((member) => ({
                email: member.email,
                displayName: member.displayName,
            }));
    }

    @Get('presence')
    @AllowWhenSuspended()
    async presence(@Request() req: Meet71AuthedRequest) {
        await this.assertAllowed(req.user.email);
        return this.meet71.getPresence(req.user.email);
    }

    @Post('calls')
    @HttpCode(HttpStatus.OK)
    @AllowWhenSuspended()
    @ThrottleAccount({ ttl: 60_000, limit: 30 })
    async startCall(@Request() req: Meet71AuthedRequest, @Body() dto: StartMeet71CallDto) {
        await this.assertAllowed(req.user.email);

        const to = dto.to.trim().toLowerCase();
        const callee = await this.membership.evaluate(to);
        if (!callee.allowed) {
            throw new ForbiddenException({
                code: 'MEET71_NOT_ALLOWED',
                message: 'That account is not on the Meet71 list.',
            });
        }

        const user = await this.db.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true, email: true },
        });

        return this.meet71.startCall({
            to,
            mode: dto.mode ?? 'voice',
            fromName: user?.name ?? user?.email ?? req.user.email,
            fromEmail: req.user.email,
        });
    }

    private async assertAllowed(email: string): Promise<void> {
        const membership = await this.membership.evaluate(email);
        if (!membership.allowed) {
            throw new ForbiddenException({
                code: 'MEET71_NOT_ALLOWED',
                message: 'This account is not on the Meet71 list.',
            });
        }
    }
}
