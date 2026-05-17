import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
    use(req: Request, _res: Response, next: NextFunction) {
        if (SAFE_METHODS.has(req.method)) {
            return next();
        }

        const origin = req.headers['origin'] as string | undefined;
        const referer = req.headers['referer'] as string | undefined;

        // Webhooks and server-to-server calls legitimately omit Origin — allow if no cookie present.
        // Cookie-carrying requests from a browser will always include Origin.
        const hasCookie = Object.keys(req.cookies ?? {}).length > 0;
        if (!origin && !hasCookie) {
            return next();
        }

        const source = origin ?? (referer ? new URL(referer).origin : undefined);
        if (!source) {
            throw new ForbiddenException('CSRF check failed: missing Origin');
        }

        const allowed = this.allowedOrigins();
        if (!allowed.includes(source)) {
            throw new ForbiddenException('CSRF check failed: untrusted Origin');
        }

        next();
    }

    private allowedOrigins(): string[] {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        const backendUrl = process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:4000';
        return [frontendUrl, backendUrl];
    }
}
