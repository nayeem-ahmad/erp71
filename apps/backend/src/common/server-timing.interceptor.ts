import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { RequestTiming } from './server-timing';

/**
 * Marks the end of the request's `auth` phase. Interceptors run only once every
 * guard has passed, so whichever runs first is the boundary; this one is
 * global, and `markAuthDone` ignores every call after the first.
 */
@Injectable()
export class ServerTimingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() === 'http') {
            const req = context.switchToHttp().getRequest<{ serverTiming?: RequestTiming }>();
            req.serverTiming?.markAuthDone();
        }
        return next.handle();
    }
}
