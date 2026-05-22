import {
    Injectable,
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../cache/redis.service';

/**
 * Daily request-rate limits per subscription plan.
 * null = unlimited.
 */
const PLAN_LIMITS: Record<string, number | null> = {
    FREE: 100,
    BASIC: 1000,
    STANDARD: 5000,
    PREMIUM: null,
};

const SECONDS_PER_DAY = 86_400;

@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
    private readonly logger = new Logger(ApiKeyRateLimitGuard.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly redis: RedisService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        // This guard is only meaningful when the request was authenticated via API key.
        // req.user is populated by ApiKeyStrategy or CombinedAuthGuard.
        const tenantId: string | undefined = request.user?.tenantId ?? request.tenantId;

        if (!tenantId) {
            // No tenant context — let the auth guard handle the rejection
            return true;
        }

        try {
            return await this.checkRateLimit(tenantId);
        } catch (err) {
            // Graceful degradation — if anything goes wrong, allow the request
            this.logger.warn(`Rate-limit check failed for tenant ${tenantId}: ${err}`);
            return true;
        }
    }

    private async checkRateLimit(tenantId: string): Promise<boolean> {
        // Look up the tenant's active subscription plan
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            select: {
                status: true,
                plan: { select: { code: true } },
            },
        });

        const planCode = subscription?.plan?.code ?? 'FREE';
        const limit = PLAN_LIMITS[planCode] ?? PLAN_LIMITS['FREE'];

        // PREMIUM (or any unknown plan with null limit) is unrestricted
        if (limit === null) {
            return true;
        }

        // Daily counter key: rate:apikey:{tenantId}:{YYYY-MM-DD}
        const today = new Date().toISOString().slice(0, 10); // "2024-01-15"
        const counterKey = `rate:apikey:${tenantId}:${today}`;

        const newCount = await this.redis.increment(counterKey);

        if (newCount === null) {
            // Redis unavailable — allow the request (graceful degradation)
            return true;
        }

        if (newCount === 1) {
            // First request of the day — set the key to expire at midnight + a small buffer
            // to avoid stale keys accumulating. We use SECONDS_PER_DAY as a safe TTL.
            await this.redis.expire(counterKey, SECONDS_PER_DAY);
        }

        if (newCount > limit) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: `Daily API rate limit of ${limit} requests exceeded for plan ${planCode}. Limit resets at midnight UTC.`,
                    error: 'Too Many Requests',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        return true;
    }
}
