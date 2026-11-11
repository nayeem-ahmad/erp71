import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailService } from '../email/email.service';
import { DatabaseService } from '../database/database.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { MeetingsService, addCalendarDays, calendarDateInZone, weekdayInZone } from './meetings.service';
import { escapeHtml } from './meeting-mail';

const OPEN = ['OPEN', 'IN_PROGRESS'] as const;
const ACTION_INCLUDE = {
    meeting: {
        select: {
            id: true,
            tenant_id: true,
            title: true,
            meeting_number: true,
            starts_at: true,
            share_token: true,
            organizer_id: true,
            organizer: { select: { name: true, email: true } },
        },
    },
    discussion: { select: { title: true } },
    others: { select: { user_id: true, name: true, email: true } },
} as const;

@Injectable()
export class MeetingRemindersService {
    private readonly logger = new Logger(MeetingRemindersService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly meetings: MeetingsService,
        private readonly email: EmailService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    @Cron('0 9 * * *', { timeZone: 'Asia/Dhaka' })
    async sendDailyReminders() {
        await this.jobTracker.track(JOB_NAMES.MEETING_ACTION_REMINDERS, () => this.run());
    }

    async run(now: Date = new Date()) {
        const today = calendarDateInZone(now, 'Asia/Dhaka');
        const tomorrow = addCalendarDays(today, 1);
        const frontendUrl = await this.email.getFrontendUrl();

        const openItems = await this.db.meetingActionItem.findMany({
            where: {
                status: { in: [...OPEN] },
                meeting: { status: 'FINALIZED' },
            },
            include: ACTION_INCLUDE,
        });

        let dueSoon = 0;
        let overdue = 0;

        for (const item of openItems) {
            const due = dateOnly(item.due_date);
            const payload = {
                tenantId: item.meeting.tenant_id,
                meetingTitle: item.meeting.title,
                meetingNumber: item.meeting.meeting_number,
                meetingDate: item.meeting.starts_at,
                discussionTitle: item.discussion.title,
                action: {
                    id: item.id,
                    description: item.description,
                    due_date: item.due_date,
                    assignee_user_id: item.assignee_user_id,
                    assignee_name: item.assignee_name,
                    assignee_email: item.assignee_email,
                    others: item.others,
                },
                organizerName: item.meeting.organizer.name || item.meeting.organizer.email,
                shareToken: item.meeting.share_token,
                frontendUrl,
            };

            if (due === tomorrow && !item.due_soon_notified_at) {
                await this.meetings.sendActionMail({ ...payload, kind: 'due_soon' });
                await this.db.meetingActionItem.update({
                    where: { id: item.id },
                    data: { due_soon_notified_at: now },
                });
                dueSoon += 1;
            }

            if (due < today && this.shouldSendOverdue(item.last_overdue_notified_at, now)) {
                await this.meetings.sendActionMail({ ...payload, kind: 'overdue' });
                await this.db.meetingActionItem.update({
                    where: { id: item.id },
                    data: { last_overdue_notified_at: now },
                });
                overdue += 1;
            }
        }

        let digests = 0;
        if (weekdayInZone(now, 'Asia/Dhaka') === 'Mon') {
            digests = await this.sendOrganizerDigests(openItems, today, frontendUrl);
        }

        this.logger.log(`Meeting reminders: ${dueSoon} due-soon, ${overdue} overdue, ${digests} organizer digests`);
        return { dueSoon, overdue, digests };
    }

    private shouldSendOverdue(last: Date | null, now: Date): boolean {
        if (!last) return true;
        const elapsed = now.getTime() - last.getTime();
        return elapsed >= 7 * 24 * 60 * 60 * 1000;
    }

    private async sendOrganizerDigests(
        items: Array<{
            due_date: Date;
            description: string;
            assignee_name: string;
            meeting: {
                tenant_id: string;
                title: string;
                meeting_number: string;
                organizer_id: string;
                organizer: { name: string | null; email: string };
            };
            discussion: { title: string };
        }>,
        today: string,
        frontendUrl: string,
    ): Promise<number> {
        const overdue = items.filter((item) => dateOnly(item.due_date) < today);
        const byOrganizer = new Map<string, typeof overdue>();
        for (const item of overdue) {
            const key = `${item.meeting.tenant_id}:${item.meeting.organizer_id}`;
            const list = byOrganizer.get(key) ?? [];
            list.push(item);
            byOrganizer.set(key, list);
        }

        let sent = 0;
        for (const group of byOrganizer.values()) {
            const first = group[0];
            const to = first.meeting.organizer.email;
            if (!to) continue;
            const rows = group
                .map(
                    (item) =>
                        `<li><strong>${escapeHtml(item.meeting.title)}</strong> — ${escapeHtml(item.discussion.title)}: ${escapeHtml(item.description)} (${escapeHtml(item.assignee_name)}, due ${dateOnly(item.due_date)})</li>`,
                )
                .join('');
            await this.email.sendOperational(
                to,
                `Overdue meeting actions (${group.length})`,
                `<div style="font-family:system-ui,sans-serif;color:#111827;line-height:1.5">
                  <p>These action points from meetings you organized are still open past their deadline.</p>
                  <ul>${rows}</ul>
                  <p><a href="${escapeHtml(frontendUrl)}/meetings/actions/all">Review action points</a></p>
                </div>`,
                { tenantId: first.meeting.tenant_id },
            );
            sent += 1;
        }
        return sent;
    }
}

function dateOnly(value: Date | string): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
}
