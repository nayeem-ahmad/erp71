import { createHash, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Shared-secret gate for Meet71 → ERP71 internal calls (`X-Meet71-Service-Key`).
 *
 * Both the header and `MEET71_ERP71_SECRET` (and optional previous) are hashed
 * with sha256 before `timingSafeEqual`, so a length mismatch cannot throw — Node
 * throws on unequal Buffer lengths, which would be a 500 and a length oracle.
 * Dual-accept `MEET71_ERP71_SECRET_PREVIOUS` for one rotate.
 */
@Injectable()
export class Meet71ServiceGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const provided = headerValue(req?.headers, 'x-meet71-service-key');
        const current = process.env.MEET71_ERP71_SECRET ?? '';
        const previous = process.env.MEET71_ERP71_SECRET_PREVIOUS ?? '';

        const matchesCurrent = hashedEqual(provided, current);
        const matchesPrevious = hashedEqual(provided, previous);

        if ((current.length > 0 && matchesCurrent) || (previous.length > 0 && matchesPrevious)) {
            return true;
        }
        throw new UnauthorizedException();
    }
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
    const raw = headers?.[name];
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
    return '';
}

function hashedEqual(left: string, right: string): boolean {
    const a = createHash('sha256').update(left).digest();
    const b = createHash('sha256').update(right).digest();
    return timingSafeEqual(a, b);
}
