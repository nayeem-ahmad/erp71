import { Module } from '@nestjs/common';
import { CrmLeadTaxonomyController } from './crm-lead-taxonomy.controller';
import { CrmLeadTaxonomyService } from './crm-lead-taxonomy.service';

@Module({
    controllers: [CrmLeadTaxonomyController],
    providers: [CrmLeadTaxonomyService],
    exports: [CrmLeadTaxonomyService],
})
export class CrmLeadTaxonomyModule {}
