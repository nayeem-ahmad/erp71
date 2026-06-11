import { Module } from '@nestjs/common';
import { CrmInteractionsController } from './crm-interactions.controller';
import { CrmInteractionsService } from './crm-interactions.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmInteractionsController],
    providers: [CrmInteractionsService],
    exports: [CrmInteractionsService],
})
export class CrmInteractionsModule {}
