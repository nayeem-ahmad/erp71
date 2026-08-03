import { Module } from '@nestjs/common';
import { CrmLeadConversationsController } from './crm-lead-conversations.controller';
import { CrmLeadConversationsService } from './crm-lead-conversations.service';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    imports: [CrmLeadTaxonomyModule],
    controllers: [CrmLeadConversationsController],
    providers: [CrmLeadConversationsService, SubscriptionAccessGuard],
    exports: [CrmLeadConversationsService],
})
export class CrmLeadConversationsModule {}