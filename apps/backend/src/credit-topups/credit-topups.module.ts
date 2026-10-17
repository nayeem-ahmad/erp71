import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SupportModule } from '../support/support.module';
import { AdminCreditTopupsController, SmsCreditController } from './credit-topups.controller';
import { CreditTopupService } from './credit-topup.service';

// DatabaseModule, EmailModule, AuditModule, PlatformSettingsModule and SmsModule
// are all @Global; SupportModule is imported for SupportEventsService, which
// makes a new top-up ticket appear live in the shop's support screen.
@Module({
    imports: [SupportModule],
    controllers: [SmsCreditController, AdminCreditTopupsController],
    providers: [CreditTopupService, PlatformAdminGuard],
    exports: [CreditTopupService],
})
export class CreditTopupsModule {}
