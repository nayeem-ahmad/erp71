import { Module } from '@nestjs/common';
import { CrmCampaignsController } from './crm-campaigns.controller';
import { CrmCampaignsService } from './crm-campaigns.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmCampaignsController],
    providers: [CrmCampaignsService],
    exports: [CrmCampaignsService],
})
export class CrmCampaignsModule {}
