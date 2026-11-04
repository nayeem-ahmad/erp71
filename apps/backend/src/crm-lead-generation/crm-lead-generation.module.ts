import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CrmLeadsModule } from '../crm-leads/crm-leads.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { CrmLeadGenerationController } from './crm-lead-generation.controller';
import { CrmLeadGenerationService } from './crm-lead-generation.service';

@Module({
    imports: [AiModule, CrmLeadsModule],
    controllers: [CrmLeadGenerationController],
    providers: [CrmLeadGenerationService, SubscriptionAccessGuard],
})
export class CrmLeadGenerationModule {}
