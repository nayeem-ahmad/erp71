import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { AdminPageTimingsController, PageTimingsController } from './page-timings.controller';
import { PageTimingsService } from './page-timings.service';

/** Real-user page load timings: collected from every signed-in browser, read on System Health. */
@Module({
    controllers: [PageTimingsController, AdminPageTimingsController],
    providers: [PageTimingsService, PlatformAdminGuard],
})
export class PageTimingsModule {}
