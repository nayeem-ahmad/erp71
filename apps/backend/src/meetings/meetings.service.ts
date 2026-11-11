import { randomBytes } from 'crypto';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { MeetingActionPriority, MeetingActionStatus, Prisma, ShortLinkEntity } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber, numberTakenIn } from '../database/document-number.utils';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { zonedDayRange } from '../common/tenant-time.util';
import { actionReminderHtml, minutesEmailHtml, type MailMinutes } from './meeting-mail';
import {
    CreateMeetingDto,
    EmailMinutesDto,
    ListMeetingActionsQueryDto,
    ListMeetingsQueryDto,
    MeetingActionItemDto,
    MeetingPersonDto,
    UpdateMeetingActionDto,
    UpdateMeetingDto,
} from './meetings.dto';

export interface MeetingViewer {
    tenantId: string;
    userId: string;
    userRole?: string;
    storeId?: string;
    timezone?: string;
}

type DbClient = Pick<
    DatabaseService,
    | 'meeting'
    | 'meetingAttendee'
    | 'meetingDiscussion'
    | 'meetingActionItem'
    | 'meetingActionPerson'
    | 'tenantUser'
    | 'store'
    | 'userStorePermission'
    | 'shortLink'
    | 'user'
>;

const OPEN_ACTION_STATUSES = ['OPEN', 'IN_PROGRESS'] as const;

const MEETING_INCLUDE = {
    organizer: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
    finalizer: { select: { id: true, name: true, email: true } },
    attendees: { orderBy: { name: 'asc' as const } },
    discussions: {
        orderBy: { position: 'asc' as const },
        include: {
            actionItems: {
                orderBy: { position: 'asc' as const },
                include: { others: { orderBy: { position: 'asc' as const } } },
            },
        },
    },
};

const LIST_INCLUDE = {
    organizer: { select: { id: true, name: true, email: true } },
    actionItems: { select: { status: true, due_date: true } },
};

@Injectable()
export class MeetingsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly shortLinks: ShortLinksService,
        private readonly email: EmailService,
        private readonly notifications: NotificationsService,
    ) {}

    async seesEveryMeeting(viewer: MeetingViewer): Promise<boolean> {
        if (viewer.userRole === 'OWNER') return true;
        if (!viewer.userId) return false;
        return this.hasGrant(viewer, StorePermission.VIEW_ALL_MEETINGS);
    }

    async canManageMeetings(viewer: MeetingViewer): Promise<boolean> {
        if (viewer.userRole === 'OWNER') return true;
        if (!viewer.userId) return false;
        return this.hasGrant(viewer, StorePermission.MANAGE_MEETINGS);
    }

    async canManageAllMeetings(viewer: MeetingViewer): Promise<boolean> {
        if (viewer.userRole === 'OWNER') return true;
        return (await this.seesEveryMeeting(viewer)) && (await this.canManageMeetings(viewer));
    }

    private async hasGrant(viewer: MeetingViewer, permission: StorePermission): Promise<boolean> {
        const grant = await this.db.userStorePermission.findFirst({
            where: {
                user_id: viewer.userId,
                tenant_id: viewer.tenantId,
                permission: permission as never,
                ...(viewer.storeId ? { store_id: viewer.storeId } : {}),
            },
            select: { id: true },
        });
        return Boolean(grant);
    }

    async visibilityWhere(viewer: MeetingViewer): Promise<Record<string, unknown>> {
        if (await this.seesEveryMeeting(viewer)) return {};
        return {
            OR: [
                { organizer_id: viewer.userId },
                { created_by: viewer.userId },
                { attendees: { some: { user_id: viewer.userId } } },
                {
                    actionItems: {
                        some: {
                            OR: [
                                { assignee_user_id: viewer.userId },
                                { others: { some: { user_id: viewer.userId } } },
                            ],
                        },
                    },
                },
            ],
        };
    }

    async findAll(viewer: MeetingViewer, query: ListMeetingsQueryDto = {}) {
        const visibility = await this.visibilityWhere(viewer);
        const startsAt = zonedDayRange(query.from, query.to, viewer.timezone);
        const search = query.search?.trim();
        const rows = await this.db.meeting.findMany({
            where: {
                tenant_id: viewer.tenantId,
                AND: [
                    visibility,
                    ...(query.type ? [{ type: query.type }] : []),
                    ...(query.status ? [{ status: query.status }] : []),
                    ...(startsAt ? [{ starts_at: startsAt }] : []),
                    ...(search
                        ? [{
                            OR: [
                                { title: { contains: search, mode: 'insensitive' } },
                                { meeting_number: { contains: search, mode: 'insensitive' } },
                            ],
                        }]
                        : []),
                ],
            },
            include: LIST_INCLUDE,
            orderBy: { starts_at: 'desc' },
        });

        const today = calendarDateInZone(new Date(), viewer.timezone ?? 'Asia/Dhaka');
        return rows.map((row) => {
            const open = row.actionItems.filter((item) => OPEN_ACTION_STATUSES.includes(item.status as (typeof OPEN_ACTION_STATUSES)[number]));
            const overdue = open.filter((item) => dateOnly(item.due_date) < today);
            const { actionItems: _dropped, ...rest } = row;
            return { ...rest, open_action_count: open.length, overdue_action_count: overdue.length };
        });
    }

    async findOne(viewer: MeetingViewer, id: string) {
        const visibility = await this.visibilityWhere(viewer);
        const meeting = await this.db.meeting.findFirst({
            where: { id, tenant_id: viewer.tenantId, ...visibility },
            include: MEETING_INCLUDE,
        });
        if (!meeting) throw new NotFoundException('Meeting not found');
        return meeting;
    }

    async create(viewer: MeetingViewer, dto: CreateMeetingDto) {
        if (!(await this.canManageMeetings(viewer))) {
            throw new ForbiddenException('You cannot create meetings');
        }

        return this.db.$transaction(async (tx) => {
            const storeId = await this.resolveStoreId(tx, viewer, dto.storeId);
            const meetingNumber = await issueDocumentNumber(tx, {
                tenantId: viewer.tenantId,
                docType: 'MEETING',
                storeId,
                isTaken: numberTakenIn(tx.meeting, viewer.tenantId, 'meeting_number'),
            });

            const meeting = await tx.meeting.create({
                data: {
                    tenant_id: viewer.tenantId,
                    store_id: storeId,
                    meeting_number: meetingNumber,
                    title: dto.title.trim(),
                    type: dto.type ?? 'OTHER',
                    starts_at: new Date(dto.startsAt),
                    ends_at: dto.endsAt ? new Date(dto.endsAt) : null,
                    venue: dto.venue?.trim() || null,
                    summary: dto.summary?.trim() || null,
                    status: 'DRAFT',
                    organizer_id: viewer.userId,
                    created_by: viewer.userId,
                },
            });

            await this.replaceChildren(tx, viewer.tenantId, meeting.id, dto);
            const saved = await this.reload(tx, viewer.tenantId, meeting.id);
            if (!saved) throw new NotFoundException('Meeting not found');
            return saved;
        });
    }

    async update(viewer: MeetingViewer, id: string, dto: UpdateMeetingDto) {
        const existing = await this.requireMeeting(viewer, id);
        await this.assertCanWrite(viewer, existing);

        const wasFinalized = existing.status === 'FINALIZED';
        const saved = await this.db.$transaction(async (tx) => {
            await tx.meeting.update({
                where: { id },
                data: {
                    title: dto.title.trim(),
                    type: dto.type ?? existing.type,
                    starts_at: new Date(dto.startsAt),
                    ends_at: dto.endsAt ? new Date(dto.endsAt) : null,
                    venue: dto.venue?.trim() || null,
                    summary: dto.summary?.trim() || null,
                    ...(dto.storeId ? { store_id: await this.resolveStoreId(tx, viewer, dto.storeId) } : {}),
                },
            });
            await this.replaceChildren(tx, viewer.tenantId, id, dto);
            const savedMeeting = await this.reload(tx, viewer.tenantId, id);
            if (!savedMeeting) throw new NotFoundException('Meeting not found');
            return savedMeeting;
        });

        if (wasFinalized) {
            await this.notifyUnnotifiedActions(saved);
        }
        return saved;
    }

    async finalize(viewer: MeetingViewer, id: string) {
        const existing = await this.requireMeeting(viewer, id);
        await this.assertCanManageLifecycle(viewer, existing);
        if (existing.status === 'FINALIZED') throw new BadRequestException('This meeting is already finalized');
        if (existing.status === 'CANCELLED') throw new BadRequestException('A cancelled meeting cannot be finalized');

        const saved = await this.db.meeting.update({
            where: { id },
            data: {
                status: 'FINALIZED',
                finalized_at: new Date(),
                finalized_by: viewer.userId,
            },
            include: MEETING_INCLUDE,
        });
        await this.notifyUnnotifiedActions(saved);
        return saved;
    }

    async cancel(viewer: MeetingViewer, id: string) {
        const existing = await this.requireMeeting(viewer, id);
        await this.assertCanManageLifecycle(viewer, existing);
        if (existing.status === 'CANCELLED') throw new BadRequestException('This meeting is already cancelled');

        return this.db.meeting.update({
            where: { id },
            data: {
                status: 'CANCELLED',
                cancelled_at: new Date(),
                cancelled_by: viewer.userId,
            },
            include: MEETING_INCLUDE,
        });
    }

    async share(viewer: MeetingViewer, id: string) {
        const meeting = await this.requireMeeting(viewer, id);
        await this.assertCanManageLifecycle(viewer, meeting);
        if (meeting.status !== 'FINALIZED') {
            throw new BadRequestException('Finalize the meeting before sharing it');
        }

        let token = meeting.share_token;
        if (!token) {
            token = randomBytes(16).toString('base64url');
            await this.db.meeting.update({
                where: { id },
                data: { share_token: token, share_token_at: new Date() },
            });
        }

        const link = await this.shortLinks.createForEntity({
            tenantId: viewer.tenantId,
            userId: viewer.userId,
            entityType: ShortLinkEntity.MEETING,
            entityId: id,
            targetUrl: `/m/${token}`,
        });

        return { token, url: `/m/${token}`, code: link.code, path: `/s/${link.code}` };
    }

    async revokeShare(viewer: MeetingViewer, id: string) {
        const meeting = await this.requireMeeting(viewer, id);
        await this.assertCanManageLifecycle(viewer, meeting);

        return this.db.$transaction(async (tx) => {
            const result = await tx.meeting.updateMany({
                where: { id, tenant_id: viewer.tenantId },
                data: { share_token: null, share_token_at: null },
            });
            if (result.count === 0) throw new NotFoundException('Meeting not found');

            await tx.shortLink.updateMany({
                where: {
                    tenant_id: viewer.tenantId,
                    entity_type: ShortLinkEntity.MEETING,
                    entity_id: id,
                    revoked_at: null,
                },
                data: { revoked_at: new Date() },
            });

            return { success: true };
        });
    }

    async findByShareToken(token: string) {
        const meeting = await this.db.meeting.findFirst({
            where: { share_token: token, status: { in: ['FINALIZED', 'CANCELLED'] } },
            select: {
                meeting_number: true,
                title: true,
                type: true,
                starts_at: true,
                ends_at: true,
                venue: true,
                summary: true,
                status: true,
                finalized_at: true,
                organizer: { select: { name: true, email: true } },
                store: { select: { name: true } },
                tenant: {
                    select: {
                        name: true,
                        brand_business_name: true,
                        brand_logo_url: true,
                    },
                },
                attendees: {
                    orderBy: { name: 'asc' },
                    select: {
                        name: true,
                        email: true,
                        organization: true,
                        role: true,
                        attended: true,
                    },
                },
                discussions: {
                    orderBy: { position: 'asc' },
                    select: {
                        position: true,
                        title: true,
                        description: true,
                        decision: true,
                        actionItems: {
                            orderBy: { position: 'asc' },
                            select: {
                                position: true,
                                description: true,
                                assignee_name: true,
                                assignee_org: true,
                                due_date: true,
                                status: true,
                                priority: true,
                                others: {
                                    orderBy: { position: 'asc' },
                                    select: { name: true, organization: true },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!meeting) throw new NotFoundException('This link is no longer available');
        return meeting;
    }

    async emailMinutes(viewer: MeetingViewer, id: string, dto: EmailMinutesDto = {}) {
        const meeting = await this.requireMeeting(viewer, id);
        await this.assertCanManageLifecycle(viewer, meeting);
        if (meeting.status !== 'FINALIZED') {
            throw new BadRequestException('Finalize the meeting before emailing the minutes');
        }

        const full = await this.reload(this.db, viewer.tenantId, id);
        if (!full) throw new NotFoundException('Meeting not found');
        const selected = dto.attendeeIds?.length
            ? full.attendees.filter((attendee) => dto.attendeeIds!.includes(attendee.id))
            : full.attendees;
        const recipients = selected
            .map((attendee) => attendee.email?.trim())
            .filter((email): email is string => Boolean(email));
        if (recipients.length === 0) {
            throw new BadRequestException('None of the selected attendees have an email address');
        }

        const html = minutesEmailHtml(toMailMinutes(full), `Minutes of ${full.title}.`);
        const subject = `Minutes: ${full.title} (${full.meeting_number})`;
        await Promise.all(
            recipients.map((to) =>
                this.email.sendOperational(to, subject, html, { tenantId: viewer.tenantId, throwOnError: true }),
            ),
        );
        return { sent: recipients.length };
    }

    async listActions(viewer: MeetingViewer, query: ListMeetingActionsQueryDto = {}) {
        const seesAll = await this.seesEveryMeeting(viewer);
        if (query.scope === 'all' && !seesAll) {
            throw new ForbiddenException('You cannot list every action point');
        }

        const visibility = await this.visibilityWhere(viewer);
        const today = calendarDateInZone(new Date(), viewer.timezone ?? 'Asia/Dhaka');
        const mine = query.scope !== 'all';

        const items = await this.db.meetingActionItem.findMany({
            where: {
                tenant_id: viewer.tenantId,
                meeting: { tenant_id: viewer.tenantId, ...visibility },
                ...(query.status ? { status: query.status } : {}),
                ...(query.meeting ? { meeting_id: query.meeting } : {}),
                ...(query.assignee ? { assignee_user_id: query.assignee } : {}),
                ...(mine
                    ? {
                          OR: [
                              { assignee_user_id: viewer.userId },
                              { others: { some: { user_id: viewer.userId } } },
                          ],
                      }
                    : {}),
                ...(query.overdue
                    ? {
                          status: { in: [...OPEN_ACTION_STATUSES] },
                          due_date: { lt: new Date(`${today}T00:00:00.000Z`) },
                      }
                    : {}),
            },
            include: {
                meeting: {
                    select: {
                        id: true,
                        title: true,
                        meeting_number: true,
                        starts_at: true,
                        status: true,
                        organizer_id: true,
                    },
                },
                discussion: { select: { id: true, title: true, position: true } },
                others: { orderBy: { position: 'asc' } },
            },
            orderBy: [{ due_date: 'asc' }, { position: 'asc' }],
        });

        return items.map((item) => ({
            ...item,
            involved_as: item.assignee_user_id === viewer.userId ? 'responsible' : 'other',
            is_overdue: OPEN_ACTION_STATUSES.includes(item.status as (typeof OPEN_ACTION_STATUSES)[number])
                && dateOnly(item.due_date) < today,
        }));
    }

    async overdueCount(viewer: MeetingViewer) {
        const today = calendarDateInZone(new Date(), viewer.timezone ?? 'Asia/Dhaka');
        const count = await this.db.meetingActionItem.count({
            where: {
                tenant_id: viewer.tenantId,
                assignee_user_id: viewer.userId,
                status: { in: [...OPEN_ACTION_STATUSES] },
                due_date: { lt: new Date(`${today}T00:00:00.000Z`) },
                meeting: { status: 'FINALIZED' },
            },
        });
        return { count };
    }

    async updateAction(viewer: MeetingViewer, id: string, dto: UpdateMeetingActionDto) {
        const item = await this.db.meetingActionItem.findFirst({
            where: { id, tenant_id: viewer.tenantId },
            include: { meeting: true, others: true },
        });
        if (!item) throw new NotFoundException('Action point not found');

        const visibility = await this.visibilityWhere(viewer);
        const visible = await this.db.meeting.findFirst({
            where: { id: item.meeting_id, tenant_id: viewer.tenantId, ...visibility },
            select: { id: true },
        });
        if (!visible) throw new NotFoundException('Action point not found');

        const isAssignee = item.assignee_user_id === viewer.userId;
        const manager = await this.canManageAllMeetings(viewer)
            || (item.meeting.organizer_id === viewer.userId && (await this.canManageMeetings(viewer)));
        if (!isAssignee && !manager) {
            throw new ForbiddenException('You can only update action points assigned to you');
        }
        if (item.meeting.status === 'CANCELLED') {
            throw new BadRequestException('Action points on a cancelled meeting cannot be updated');
        }

        const nextStatus = dto.status ?? item.status;
        const completing = nextStatus === 'DONE' && item.status !== 'DONE';

        return this.db.meetingActionItem.update({
            where: { id },
            data: {
                ...(dto.status ? { status: dto.status } : {}),
                ...(dto.completionNote !== undefined ? { completion_note: dto.completionNote } : {}),
                ...(completing
                    ? { completed_at: new Date(), completed_by: viewer.userId }
                    : nextStatus !== 'DONE'
                        ? { completed_at: null, completed_by: null }
                        : {}),
            },
            include: {
                meeting: { select: { id: true, title: true, meeting_number: true } },
                discussion: { select: { id: true, title: true, position: true } },
                others: { orderBy: { position: 'asc' } },
            },
        });
    }

    async notifyUnnotifiedActions(meeting: {
        id: string;
        tenant_id: string;
        title: string;
        meeting_number: string;
        starts_at: Date;
        status: string;
        share_token: string | null;
        organizer: { name: string | null; email: string };
        discussions: Array<{
            title: string;
            actionItems: Array<{
                id: string;
                description: string;
                due_date: Date;
                status: string;
                assigned_notified_at: Date | null;
                assignee_user_id: string | null;
                assignee_name: string;
                assignee_email: string | null;
                others: Array<{ user_id: string | null; name: string; email: string | null }>;
            }>;
        }>;
    }) {
        if (meeting.status !== 'FINALIZED') return;

        const frontendUrl = await this.email.getFrontendUrl();
        const now = new Date();

        for (const discussion of meeting.discussions) {
            for (const action of discussion.actionItems) {
                if (action.assigned_notified_at) continue;
                if (!OPEN_ACTION_STATUSES.includes(action.status as (typeof OPEN_ACTION_STATUSES)[number])) continue;

                await this.sendActionMail({
                    tenantId: meeting.tenant_id,
                    kind: 'assignment',
                    meetingTitle: meeting.title,
                    meetingNumber: meeting.meeting_number,
                    meetingDate: meeting.starts_at,
                    discussionTitle: discussion.title,
                    action,
                    organizerName: meeting.organizer.name || meeting.organizer.email,
                    shareToken: meeting.share_token,
                    frontendUrl,
                });

                await this.db.meetingActionItem.update({
                    where: { id: action.id },
                    data: { assigned_notified_at: now },
                });
            }
        }
    }

    async sendActionMail(opts: {
        tenantId: string;
        kind: 'assignment' | 'due_soon' | 'overdue';
        meetingTitle: string;
        meetingNumber: string;
        meetingDate: Date;
        discussionTitle: string;
        action: {
            id: string;
            description: string;
            due_date: Date;
            assignee_user_id: string | null;
            assignee_name: string;
            assignee_email: string | null;
            others: Array<{ user_id: string | null; name: string; email: string | null }>;
        };
        organizerName: string;
        shareToken: string | null;
        frontendUrl: string;
    }) {
        const subjects = {
            assignment: `New action point from ${opts.meetingTitle}`,
            due_soon: `Action due tomorrow: ${opts.meetingTitle}`,
            overdue: `Overdue action: ${opts.meetingTitle}`,
        };
        const people = [
            {
                userId: opts.action.assignee_user_id,
                name: opts.action.assignee_name,
                email: opts.action.assignee_email,
            },
            ...opts.action.others.map((person) => ({
                userId: person.user_id,
                name: person.name,
                email: person.email,
            })),
        ];

        for (const person of people) {
            const link = person.userId
                ? `${opts.frontendUrl}/meetings/actions`
                : opts.shareToken
                    ? `${opts.frontendUrl}/m/${opts.shareToken}`
                    : null;
            const html = actionReminderHtml({
                meetingTitle: opts.meetingTitle,
                meetingNumber: opts.meetingNumber,
                meetingDate: opts.meetingDate,
                discussionTitle: opts.discussionTitle,
                actionText: opts.action.description,
                dueDate: opts.action.due_date,
                others: opts.action.others.map((other) => other.name),
                organizerName: opts.organizerName,
                link,
            });
            if (person.email) {
                await this.email.sendOperational(person.email, subjects[opts.kind], html, {
                    tenantId: opts.tenantId,
                });
            }
            if (person.userId) {
                await this.notifications.create(
                    opts.tenantId,
                    person.userId,
                    `meeting_action_${opts.kind}`,
                    subjects[opts.kind],
                    opts.action.description,
                    '/meetings/actions',
                    { dedupeKey: `meeting-action:${opts.kind}:${opts.action.id}:${person.userId}` },
                );
            }
        }
    }

    private async requireMeeting(viewer: MeetingViewer, id: string) {
        const visibility = await this.visibilityWhere(viewer);
        const meeting = await this.db.meeting.findFirst({
            where: { id, tenant_id: viewer.tenantId, ...visibility },
        });
        if (!meeting) throw new NotFoundException('Meeting not found');
        return meeting;
    }

    private async assertCanWrite(
        viewer: MeetingViewer,
        meeting: { status: string; organizer_id: string; created_by: string },
    ) {
        if (meeting.status === 'CANCELLED') {
            throw new BadRequestException('A cancelled meeting cannot be edited');
        }
        if (await this.canManageAllMeetings(viewer)) return;
        const manages = await this.canManageMeetings(viewer);
        const isOrganizer = meeting.organizer_id === viewer.userId;
        if (meeting.status === 'FINALIZED') {
            if (isOrganizer && manages) return;
            throw new ForbiddenException('Only the organizer can edit finalized minutes');
        }
        const owns = isOrganizer || meeting.created_by === viewer.userId;
        if (!owns || !manages) {
            throw new ForbiddenException('You cannot edit this meeting');
        }
    }

    private async assertCanManageLifecycle(
        viewer: MeetingViewer,
        meeting: { organizer_id: string },
    ) {
        if (await this.canManageAllMeetings(viewer)) return;
        if (meeting.organizer_id === viewer.userId && (await this.canManageMeetings(viewer))) return;
        throw new ForbiddenException('You cannot change this meeting');
    }

    private async resolveStoreId(
        tx: Pick<DatabaseService, 'store'>,
        viewer: MeetingViewer,
        preferred?: string | null,
    ): Promise<string> {
        const candidate = preferred || viewer.storeId;
        if (candidate) {
            const store = await tx.store.findFirst({
                where: { id: candidate, tenant_id: viewer.tenantId },
                select: { id: true },
            });
            if (store) return store.id;
            if (preferred) throw new BadRequestException('Store not found in this workspace');
        }
        const first = await tx.store.findFirst({
            where: { tenant_id: viewer.tenantId },
            orderBy: { created_at: 'asc' },
            select: { id: true },
        });
        if (!first) throw new BadRequestException('No store found for this workspace');
        return first.id;
    }

    private async replaceChildren(
        tx: DbClient,
        tenantId: string,
        meetingId: string,
        dto: Pick<CreateMeetingDto, 'attendees' | 'discussions'>,
    ) {
        await tx.meetingAttendee.deleteMany({ where: { meeting_id: meetingId, tenant_id: tenantId } });
        const attendees = dto.attendees ?? [];
        for (const attendee of attendees) {
            const person = await this.resolvePerson(tx, tenantId, attendee);
            await tx.meetingAttendee.create({
                data: {
                    tenant_id: tenantId,
                    meeting_id: meetingId,
                    user_id: person.user_id,
                    name: person.name,
                    email: person.email,
                    organization: person.organization,
                    role: attendee.role ?? 'MEMBER',
                    attended: attendee.attended ?? true,
                },
            });
        }

        const incomingDiscussions = dto.discussions ?? [];
        const existingDiscussions = await tx.meetingDiscussion.findMany({
            where: { meeting_id: meetingId, tenant_id: tenantId },
            include: { actionItems: true },
        });
        const keepDiscussionIds = incomingDiscussions.map((row) => row.id).filter(Boolean) as string[];
        await tx.meetingDiscussion.deleteMany({
            where: {
                meeting_id: meetingId,
                tenant_id: tenantId,
                ...(keepDiscussionIds.length ? { id: { notIn: keepDiscussionIds } } : {}),
            },
        });

        for (const [index, discussion] of incomingDiscussions.entries()) {
            const existing = discussion.id
                ? existingDiscussions.find((row) => row.id === discussion.id)
                : undefined;
            const saved = existing
                ? await tx.meetingDiscussion.update({
                      where: { id: existing.id },
                      data: {
                          position: index + 1,
                          title: discussion.title.trim(),
                          description: discussion.description?.trim() || null,
                          decision: discussion.decision?.trim() || null,
                      },
                  })
                : await tx.meetingDiscussion.create({
                      data: {
                          tenant_id: tenantId,
                          meeting_id: meetingId,
                          position: index + 1,
                          title: discussion.title.trim(),
                          description: discussion.description?.trim() || null,
                          decision: discussion.decision?.trim() || null,
                      },
                  });
            await this.replaceActions(tx, tenantId, meetingId, saved.id, discussion.actionItems ?? [], existing?.actionItems ?? []);
        }
    }

    private async replaceActions(
        tx: DbClient,
        tenantId: string,
        meetingId: string,
        discussionId: string,
        incoming: MeetingActionItemDto[],
        existing: Array<{
            id: string;
            status: string;
            completed_at: Date | null;
            completed_by: string | null;
            completion_note: string | null;
            assigned_notified_at: Date | null;
            due_soon_notified_at: Date | null;
            last_overdue_notified_at: Date | null;
            assignee_user_id: string | null;
            assignee_email: string | null;
        }>,
    ) {
        const keepIds = incoming.map((row) => row.id).filter(Boolean) as string[];
        await tx.meetingActionItem.deleteMany({
            where: {
                discussion_id: discussionId,
                tenant_id: tenantId,
                ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
            },
        });

        for (const [index, item] of incoming.entries()) {
            const person = await this.resolvePerson(tx, tenantId, {
                userId: item.assigneeUserId,
                name: item.assigneeName,
                email: item.assigneeEmail,
                organization: item.assigneeOrg,
            });
            if (!item.dueDate) throw new BadRequestException('Each action point needs a deadline');
            const prior = item.id ? existing.find((row) => row.id === item.id) : undefined;
            const assigneeChanged = prior
                && (prior.assignee_user_id !== person.user_id || prior.assignee_email !== person.email);
            const others = await Promise.all(
                (item.others ?? []).map(async (other, otherIndex) => {
                    const resolved = await this.resolvePerson(tx, tenantId, other);
                    return {
                        tenant_id: tenantId,
                        position: otherIndex + 2,
                        user_id: resolved.user_id,
                        name: resolved.name,
                        email: resolved.email,
                        organization: resolved.organization,
                    };
                }),
            );

            const data: Prisma.MeetingActionItemUncheckedCreateInput = {
                tenant_id: tenantId,
                meeting_id: meetingId,
                discussion_id: discussionId,
                position: index + 1,
                description: item.description.trim(),
                assignee_user_id: person.user_id,
                assignee_name: person.name,
                assignee_email: person.email,
                assignee_org: person.organization,
                due_date: new Date(`${item.dueDate.slice(0, 10)}T00:00:00.000Z`),
                priority: (item.priority ?? 'NORMAL') as MeetingActionPriority,
                status: (item.status ?? prior?.status ?? 'OPEN') as MeetingActionStatus,
                assigned_notified_at: assigneeChanged ? null : prior?.assigned_notified_at ?? null,
                due_soon_notified_at: prior?.due_soon_notified_at ?? null,
                last_overdue_notified_at: prior?.last_overdue_notified_at ?? null,
                completed_at: prior?.completed_at ?? null,
                completed_by: prior?.completed_by ?? null,
                completion_note: prior?.completion_note ?? null,
            };

            let actionItemId: string;
            if (prior) {
                await tx.meetingActionPerson.deleteMany({ where: { action_item_id: prior.id } });
                await tx.meetingActionItem.update({
                    where: { id: prior.id },
                    data,
                });
                actionItemId = prior.id;
            } else {
                const created = await tx.meetingActionItem.create({ data });
                actionItemId = created.id;
            }

            if (others.length) {
                await tx.meetingActionPerson.createMany({
                    data: others.map((other) => ({ ...other, action_item_id: actionItemId })),
                });
            }
        }
    }

    private async resolvePerson(
        tx: Pick<DatabaseService, 'tenantUser'>,
        tenantId: string,
        input: MeetingPersonDto,
    ): Promise<{ user_id: string | null; name: string; email: string | null; organization: string | null }> {
        if (input.userId) {
            const membership = await tx.tenantUser.findUnique({
                where: { tenant_id_user_id: { tenant_id: tenantId, user_id: input.userId } },
                include: { user: { select: { id: true, name: true, email: true } } },
            });
            if (!membership) throw new BadRequestException('Team member not found in this workspace');
            return {
                user_id: membership.user.id,
                name: membership.user.name?.trim() || membership.user.email,
                email: membership.user.email,
                organization: input.organization?.trim() || null,
            };
        }
        const name = input.name?.trim();
        if (!name) throw new BadRequestException('A name is required when the person is not a team member');
        const email = input.email?.trim() || null;
        if (!email) throw new BadRequestException('An email is required when the person is not a team member');
        return {
            user_id: null,
            name,
            email,
            organization: input.organization?.trim() || null,
        };
    }

    private reload(db: DbClient, tenantId: string, id: string) {
        return db.meeting.findFirst({
            where: { id, tenant_id: tenantId },
            include: MEETING_INCLUDE,
        });
    }
}

function dateOnly(value: Date | string): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
}

export function calendarDateInZone(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

export function addCalendarDays(isoDate: string, days: number): string {
    const date = new Date(`${isoDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function weekdayInZone(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
}

function toMailMinutes(meeting: {
    meeting_number: string;
    title: string;
    starts_at: Date;
    venue: string | null;
    organizer: { name: string | null; email: string };
    discussions: Array<{
        position: number;
        title: string;
        description: string | null;
        decision: string | null;
        actionItems: Array<{
            position: number;
            description: string;
            assignee_name: string;
            assignee_org: string | null;
            due_date: Date;
            status: string;
            priority: string;
            others: Array<{ name: string; organization: string | null }>;
        }>;
    }>;
}): MailMinutes {
    return {
        meeting_number: meeting.meeting_number,
        title: meeting.title,
        starts_at: meeting.starts_at,
        venue: meeting.venue,
        organizerName: meeting.organizer.name || meeting.organizer.email,
        discussions: meeting.discussions,
    };
}
