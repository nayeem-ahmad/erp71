import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalNotifyModule } from '../approvals/approval-notify.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { AlertScannerService } from './alert-scanner.service';
import { AlertSettingsService } from './alert-settings.service';
import { AlertsController } from './alerts.controller';

@Module({
    imports: [AiModule, NotificationsModule, ApprovalNotifyModule, PreferencesModule],
    controllers: [AlertsController],
    providers: [AlertScannerService, AlertSettingsService, StorePermissionGuard],
})
export class AlertsModule {}
