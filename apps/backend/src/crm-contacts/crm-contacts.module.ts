import { Module } from '@nestjs/common';
import { CrmContactsController } from './crm-contacts.controller';
import { CrmContactsService } from './crm-contacts.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    // AiModule carries the business-card scanner's plumbing — API key resolution,
    // the tenant credit ceiling, and usage logging — so the scan route goes
    // through it rather than re-implementing any of that here.
    imports: [AiModule],
    controllers: [CrmContactsController],
    providers: [CrmContactsService, SubscriptionAccessGuard],
    exports: [CrmContactsService],
})
export class CrmContactsModule {}
