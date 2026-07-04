import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';

@Injectable()
export class RefereeGuard implements CanActivate {
    constructor(private readonly referrals: ReferralsService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;
        const email = request.user?.email;

        if (!userId || !email) {
            throw new UnauthorizedException('Authentication is required');
        }

        const referee = await this.referrals.resolveActiveRefereeForUser(userId, email);

        if (!referee) {
            throw new ForbiddenException('Referee portal access is required');
        }

        request.referee = {
            ...referee,
            signup_discount: Number(referee.signup_discount),
            commission_rate: Number(referee.commission_rate),
        };
        return true;
    }
}