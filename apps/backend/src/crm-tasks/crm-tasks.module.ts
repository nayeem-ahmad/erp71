import { Module } from '@nestjs/common';
import { CrmTasksController } from './crm-tasks.controller';
import { CrmTasksService } from './crm-tasks.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmTasksController],
    providers: [CrmTasksService],
    exports: [CrmTasksService],
})
export class CrmTasksModule {}
