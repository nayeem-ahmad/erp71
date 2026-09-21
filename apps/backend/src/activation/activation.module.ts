import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ActivationController, AdminActivationController } from './activation.controller';
import { ActivationService } from './activation.service';

// DatabaseModule, EmailModule, AuditModule and PlatformSettingsModule are all
// @Global, so only BillingModule needs importing here.
@Module({
    imports: [BillingModule],
    controllers: [ActivationController, AdminActivationController],
    providers: [ActivationService, PlatformAdminGuard],
    exports: [ActivationService],
})
export class ActivationModule {}
