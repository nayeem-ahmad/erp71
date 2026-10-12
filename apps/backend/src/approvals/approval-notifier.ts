import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { APPROVAL_LABEL, APPROVAL_PERMISSION, APPROVAL_WEB_LINK, type ApprovalKind } from './approval-kinds';
import { ApproverDirectory } from './approver-directory';

export type ApprovalRequested = {
    tenantId: string;
    kind: ApprovalKind;
    id: string;
    /** "Rahim Uddin · ৳1,200 travel" — what the approver reads first. */
    summary: string;
    /** The branch the entry belongs to, for branch-held permissions. */
    storeId?: string | null;
    /** Not told about their own request. */
    requestedBy?: string | null;
};

/**
 * Tells everyone who can decide a new entry that it is waiting: a bell row on
 * the web and a push on their phones, through NotificationsService.
 *
 * Its own module, depending on nothing but notifications, so the modules that
 * create entries can call it without importing the inbox, which imports them.
 * Never throws — telling people is a courtesy on top of the entry, which is
 * already saved.
 */
@Injectable()
export class ApprovalNotifier {
    private readonly logger = new Logger(ApprovalNotifier.name);

    constructor(
        private readonly directory: ApproverDirectory,
        private readonly notifications: NotificationsService,
    ) {}

    async requested(event: ApprovalRequested): Promise<void> {
        try {
            const approvers = await this.directory.userIds(
                event.tenantId,
                APPROVAL_PERMISSION[event.kind],
                event.storeId,
            );
            const recipients = approvers.filter((userId) => userId !== event.requestedBy);
            await Promise.all(
                recipients.map((userId) =>
                    this.notifications.create(
                        event.tenantId,
                        userId,
                        'APPROVAL_REQUEST',
                        `${APPROVAL_LABEL[event.kind]} waiting for you`,
                        event.summary,
                        APPROVAL_WEB_LINK[event.kind],
                    ),
                ),
            );
        } catch (error) {
            this.logger.warn(`Could not tell approvers about ${event.kind} ${event.id}: ${error}`);
        }
    }
}
