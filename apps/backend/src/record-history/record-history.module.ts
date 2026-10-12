import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminRecordHistoryController } from './admin-record-history.controller';
import { RecordHistoryInterceptor } from './record-history.interceptor';
import { RecordHistoryService } from './record-history.service';

/**
 * Global so any controller can carry `@TrackHistory` without importing this
 * module: the decorator attaches `RecordHistoryInterceptor`, which Nest builds
 * in the controller's own module and resolves `RecordHistoryService` from here.
 */
@Global()
@Module({
    controllers: [AdminRecordHistoryController],
    providers: [RecordHistoryService, RecordHistoryInterceptor, PlatformAdminGuard],
    exports: [RecordHistoryService, RecordHistoryInterceptor],
})
export class RecordHistoryModule {}
