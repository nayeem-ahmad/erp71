import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class RefereeGuard implements CanActivate {
    constructor(private readonly db: DatabaseService) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;

        if (!userId) {
            throw new UnauthorizedException('Authentication is required');
        }

        const referee = await this.db.referee.findFirst({
            where: { user_id: userId, is_active: true },
            select: {
                id: true,
                name: true,
                email: true,
                referral_code: true,
                signup_discount: true,
                commission_rate: true,
                is_active: true,
            },
        });

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