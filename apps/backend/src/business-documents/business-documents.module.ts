import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BusinessDocumentsController } from './business-documents.controller';
import { BusinessDocumentsScheduler } from './business-documents.scheduler';
import { BusinessDocumentsService } from './business-documents.service';

@Module({
    imports: [DatabaseModule, AssetsModule, NotificationsModule],
    controllers: [BusinessDocumentsController],
    providers: [BusinessDocumentsService, BusinessDocumentsScheduler],
})
export class BusinessDocumentsModule {}
