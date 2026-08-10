import { Module } from '@nestjs/common';
import { CrmCampaignsController } from './crm-campaigns.controller';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmCampaignsController],
    providers: [CrmCampaignsService, CampaignRecipientsService, CampaignDispatchService],
    exports: [CrmCampaignsService],
})
export class CrmCampaignsModule {}
