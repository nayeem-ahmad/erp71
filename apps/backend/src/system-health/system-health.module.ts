import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { DatabaseCheck } from './checks/database.check';
import { RedisCheck } from './checks/redis.check';
import { ExternalCheck } from './checks/external.check';
import { CronCheck } from './checks/cron.check';
import { PaymentsCheck } from './checks/payments.check';
import { SmsCreditCheck } from './checks/sms-credit.check';
import { HealthAlertService } from './alerts/health-alert.service';

/**
 * System health monitoring: deep dependency checks, cron-job observability,
 * and threshold alerting for platform admins. DatabaseService, RedisService,
 * EmailService, SmsService, and JobTrackerService come from @Global() modules.
 */
@Module({
    controllers: [SystemHealthController],
    providers: [
        SystemHealthService,
        DatabaseCheck,
        RedisCheck,
        ExternalCheck,
        CronCheck,
        PaymentsCheck,
        SmsCreditCheck,
        HealthAlertService,
        PlatformAdminGuard,
    ],
})
export class SystemHealthModule {}
