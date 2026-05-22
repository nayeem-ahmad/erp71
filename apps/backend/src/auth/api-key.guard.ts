import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ApiKeyGuard extends AuthGuard('api-key') {
    handleRequest<TUser = any>(err: any, user: TUser): TUser {
        // Return false/null without throwing so CombinedAuthGuard can fall through
        if (err || !user) {
            return false as any;
        }
        return user;
    }

    canActivate(context: ExecutionContext) {
        return super.canActivate(context);
    }
}
