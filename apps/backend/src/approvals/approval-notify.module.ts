import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalNotifier } from './approval-notifier';
import { ApproverDirectory } from './approver-directory';

/** See ApprovalNotifier: kept apart from ApprovalsModule to avoid a cycle. */
@Module({
    imports: [NotificationsModule],
    providers: [ApprovalNotifier, ApproverDirectory],
    exports: [ApprovalNotifier, ApproverDirectory],
})
export class ApprovalNotifyModule {}
