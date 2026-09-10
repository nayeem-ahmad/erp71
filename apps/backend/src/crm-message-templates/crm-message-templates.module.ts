import { Module } from '@nestjs/common';
import { CrmMessageTemplatesController } from './crm-message-templates.controller';
import { CrmMessageTemplatesService } from './crm-message-templates.service';

@Module({
    controllers: [CrmMessageTemplatesController],
    providers: [CrmMessageTemplatesService],
    exports: [CrmMessageTemplatesService],
})
export class CrmMessageTemplatesModule {}
