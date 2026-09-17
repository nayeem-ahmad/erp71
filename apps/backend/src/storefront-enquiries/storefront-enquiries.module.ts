import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { StorefrontEnquiriesService } from './storefront-enquiries.service';
import { StorefrontEnquiriesController } from './storefront-enquiries.controller';

@Module({
    imports: [DatabaseModule, CrmLeadTaxonomyModule],
    controllers: [StorefrontEnquiriesController],
    providers: [StorefrontEnquiriesService],
})
export class StorefrontEnquiriesModule {}
