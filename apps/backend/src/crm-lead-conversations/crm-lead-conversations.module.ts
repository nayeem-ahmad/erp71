import { Module } from '@nestjs/common';
import { CrmLeadConversationsController } from './crm-lead-conversations.controller';
import { CrmLeadConversationsService } from './crm-lead-conversations.service';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    controllers: [CrmLeadConversationsController],
    providers: [CrmLeadConversationsService, SubscriptionAccessGuard],
    exports: [CrmLeadConversationsService],
})
export class CrmLeadConversationsModule {}