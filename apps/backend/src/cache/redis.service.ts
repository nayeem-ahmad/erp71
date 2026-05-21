import { Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';

@Injectable()
export class RedisService {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis | null = null;

    constructor() {
        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (url && token) {
            this.client = new Redis({ url, token });
            this.logger.log('Upstash Redis cache enabled');
        } else {
            this.logger.warn('UPSTASH_REDIS_REST_URL / TOKEN not set — caching disabled');
        }
    }

    async get<T>(key: string): Promise<T | null> {
        if (!this.client) return null;
        try {
            return await this.client.get<T>(key);
        } catch (err) {
            this.logger.warn(`Cache get failed for key "${key}": ${err}`);
            return null;
        }
    }

    async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
        if (!this.client) return;
        try {
            await this.client.set(key, value, { ex: ttlSeconds });
        } catch (err) {
            this.logger.warn(`Cache set failed for key "${key}": ${err}`);
        }
    }

    async invalidatePattern(prefix: string): Promise<void> {
        if (!this.client) return;
        try {
            const keys = await this.client.keys(`${prefix}*`);
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
        } catch (err) {
            this.logger.warn(`Cache invalidate failed for prefix "${prefix}": ${err}`);
        }
    }
}
