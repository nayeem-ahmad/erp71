import { Module } from '@nestjs/common';
import { CrmLeadsController } from './crm-leads.controller';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    imports: [CustomersModule],
    controllers: [CrmLeadsController],
    providers: [CrmLeadsService, SubscriptionAccessGuard],
    exports: [CrmLeadsService],
})
export class CrmLeadsModule {}