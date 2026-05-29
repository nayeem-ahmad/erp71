import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { isPlatformAdminEmail } from './platform-admin.util';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.email) {
            throw new UnauthorizedException('Authentication is required');
        }

        // DB flag takes priority; email whitelist is a fallback for bootstrapping
        const isAdmin = user.isPlatformAdmin === true || isPlatformAdminEmail(user.email);
        if (!isAdmin) {
            throw new ForbiddenException('Platform admin access is required');
        }

        request.isPlatformAdmin = true;
        return true;
    }
}