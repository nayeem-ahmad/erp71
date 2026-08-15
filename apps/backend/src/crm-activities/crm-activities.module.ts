import { Module } from '@nestjs/common';
import { CrmActivitiesController } from './crm-activities.controller';
import { CrmActivitiesService } from './crm-activities.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';

@Module({
    imports: [DatabaseModule, NotificationsModule, CrmLeadTaxonomyModule],
    controllers: [CrmActivitiesController],
    providers: [CrmActivitiesService, StorePermissionGuard],
    exports: [CrmActivitiesService],
})
export class CrmActivitiesModule {}
