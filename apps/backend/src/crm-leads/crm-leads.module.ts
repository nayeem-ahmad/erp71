import { Module } from '@nestjs/common';
import { CrmLeadsController } from './crm-leads.controller';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersModule } from '../customers/customers.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { AssetsModule } from '../assets/assets.module';
import { CrmPhotosModule } from '../crm-photos/crm-photos.module';
import { LeadStatusResolver } from './lead-status.resolver';

@Module({
    imports: [
        CustomersModule,
        CustomFieldsModule,
        CrmLeadTaxonomyModule,
        AssetsModule,
        CrmPhotosModule,
    ],
    controllers: [CrmLeadsController],
    providers: [CrmLeadsService, LeadStatusResolver, SubscriptionAccessGuard],
    exports: [CrmLeadsService, LeadStatusResolver],
})
export class CrmLeadsModule {}