import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { RefereePortalController } from './referee-portal.controller';
import { ReferralTrackingController } from './referral-tracking.controller';
import { ReferralsService } from './referrals.service';
import { RefereeGuard } from './referee.guard';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetModule } from '../password-reset/password-reset.module';
import { EmailModule } from '../email/email.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
    imports: [DatabaseModule, PasswordResetModule, EmailModule, PlatformSettingsModule, AccountingModule],
    controllers: [ReferralsController, RefereePortalController, ReferralTrackingController],
    providers: [ReferralsService, RefereeGuard],
    exports: [ReferralsService],
})
export class ReferralsModule {}
