import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@retail-saas/shared-types';
import { RedisService } from '../../cache/redis.service';

/**
 * Checks the optional Upstash Redis cache. When credentials are absent the
 * check reports `disabled` and never affects the overall rollup — Redis fails
 * open in this codebase, so its absence is not an outage.
 */
@Injectable()
export class RedisCheck {
    constructor(private readonly redis: RedisService) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'redis',
            label: 'Upstash Redis',
            critical: false,
        };

        if (!this.redis.isEnabled()) {
            return { ...base, state: 'disabled', message: 'Caching not configured' };
        }

        const start = Date.now();
        const ok = await this.redis.ping();
        const latency_ms = Date.now() - start;

        return ok
            ? { ...base, state: 'ok', latency_ms }
            : { ...base, state: 'down', latency_ms, message: 'Redis ping failed' };
    }
}
