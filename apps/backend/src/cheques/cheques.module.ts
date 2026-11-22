import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChequesController } from './cheques.controller';
import { ChequesScheduler } from './cheques.scheduler';
import { ChequesService } from './cheques.service';

@Module({
    imports: [DatabaseModule, NotificationsModule],
    controllers: [ChequesController],
    providers: [ChequesService, ChequesScheduler],
})
export class ChequesModule {}
