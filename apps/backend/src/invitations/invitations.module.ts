import { Module } from '@nestjs/common';
import { PasswordPolicyModule } from '../password-policy/password-policy.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
    imports: [PasswordPolicyModule, SubscriptionPlansModule],
    providers: [InvitationsService],
    controllers: [InvitationsController],
    exports: [InvitationsService],
})
export class InvitationsModule {}
