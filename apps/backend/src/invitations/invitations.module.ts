import { Module } from '@nestjs/common';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
    imports: [SubscriptionPlansModule],
    providers: [InvitationsService],
    controllers: [InvitationsController],
    exports: [InvitationsService],
})
export class InvitationsModule {}
