import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

/**
 * Guards the Prometheus scrape endpoint with a static bearer token
 * (`METRICS_TOKEN`), kept separate from user/JWT auth so a scraper can poll it.
 * When `METRICS_TOKEN` is unset the endpoint behaves as if it doesn't exist.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const expected = process.env.METRICS_TOKEN;
        if (!expected) {
            // Don't advertise a disabled endpoint.
            throw new NotFoundException();
        }

        const req = context.switchToHttp().getRequest();
        const header: string | undefined = req.headers?.authorization;
        const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        const provided = bearer ?? req.query?.token;

        if (provided !== expected) {
            throw new UnauthorizedException('Invalid metrics token');
        }
        return true;
    }
}
