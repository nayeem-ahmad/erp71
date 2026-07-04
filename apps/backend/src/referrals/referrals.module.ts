import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { RefereePortalController } from './referee-portal.controller';
import { ReferralsService } from './referrals.service';
import { RefereeGuard } from './referee.guard';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetModule } from '../password-reset/password-reset.module';

@Module({
    imports: [DatabaseModule, PasswordResetModule],
    controllers: [ReferralsController, RefereePortalController],
    providers: [ReferralsService, RefereeGuard],
    exports: [ReferralsService],
})
export class ReferralsModule {}
