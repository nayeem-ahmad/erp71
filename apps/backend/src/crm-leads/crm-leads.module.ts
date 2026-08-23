import { Module } from '@nestjs/common';
import { CrmLeadsController } from './crm-leads.controller';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersModule } from '../customers/customers.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { AssetsModule } from '../assets/assets.module';
import { CrmPhotosModule } from '../crm-photos/crm-photos.module';

@Module({
    imports: [
        CustomersModule,
        CustomFieldsModule,
        CrmLeadTaxonomyModule,
        AssetsModule,
        CrmPhotosModule,
    ],
    controllers: [CrmLeadsController],
    providers: [CrmLeadsService, SubscriptionAccessGuard],
    exports: [CrmLeadsService],
})
export class CrmLeadsModule {}