import { Module } from '@nestjs/common';
import { CrmCampaignsController } from './crm-campaigns.controller';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmCampaignsController],
    providers: [CrmCampaignsService, CampaignRecipientsService],
    exports: [CrmCampaignsService],
})
export class CrmCampaignsModule {}
