import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
    constructor(private db: DatabaseService) {}

    @Get()
    async check() {
        const start = Date.now();
        let dbOk = false;
        try {
            await this.db.$queryRaw`SELECT 1`;
            dbOk = true;
        } catch {
            // db unreachable
        }

        const status = dbOk ? 'ok' : 'degraded';
        return {
            status,
            db: dbOk ? 'ok' : 'unreachable',
            // Git SHA baked into the image at build time — identifies exactly what is deployed.
            commit: process.env.GIT_SHA ?? 'unknown',
            uptime: Math.floor(process.uptime()),
            latency_ms: Date.now() - start,
            timestamp: new Date().toISOString(),
        };
    }
}
