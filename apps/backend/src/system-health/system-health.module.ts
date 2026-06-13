import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { DatabaseCheck } from './checks/database.check';
import { RedisCheck } from './checks/redis.check';
import { ExternalCheck } from './checks/external.check';
import { CronCheck } from './checks/cron.check';

/**
 * System health monitoring: deep dependency checks and cron-job observability
 * for platform admins. DatabaseService, RedisService, and JobTrackerService
 * come from their @Global() modules.
 */
@Module({
    controllers: [SystemHealthController],
    providers: [
        SystemHealthService,
        DatabaseCheck,
        RedisCheck,
        ExternalCheck,
        CronCheck,
        PlatformAdminGuard,
    ],
})
export class SystemHealthModule {}
