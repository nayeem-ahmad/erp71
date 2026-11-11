import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { issueDocumentNumber } from '../database/document-number.utils';
import { MeetingsService } from './meetings.service';

jest.mock('../database/document-number.utils', () => ({
    ...jest.requireActual('../database/document-number.utils'),
    issueDocumentNumber: jest.fn(async () => 'MIN-2026-0001'),
}));

const OWNER = { tenantId: 'tenant-1', userId: 'user-owner', userRole: 'OWNER', storeId: 'store-1', timezone: 'Asia/Dhaka' };
const STAFF = { tenantId: 'tenant-1', userId: 'user-staff', userRole: 'CASHIER', storeId: 'store-1', timezone: 'Asia/Dhaka' };

function emptyTx() {
    return {
        meeting: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        meetingAttendee: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn() },
        meetingDiscussion: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
            update: jest.fn(),
        },
        meetingActionItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
            update: jest.fn(),
        },
        meetingActionPerson: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1' }) },
        tenantUser: { findUnique: jest.fn() },
        shortLink: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
}

describe('MeetingsService', () => {
    let service: MeetingsService;
    let db: any;
    let tx: any;
    const shortLinks = { createForEntity: jest.fn().mockResolvedValue({ code: 'abc12' }) };
    const email = {
        sendOperational: jest.fn().mockResolvedValue(undefined),
        getFrontendUrl: jest.fn().mockResolvedValue('https://app.erp71.com'),
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) };

    beforeEach(async () => {
        jest.clearAllMocks();
        tx = emptyTx();
        db = {
            $transaction: jest.fn().mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx)),
            meeting: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
            },
            meetingActionItem: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                count: jest.fn(),
                update: jest.fn(),
            },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            shortLink: { updateMany: jest.fn() },
        };
        Object.assign(tx.meeting, {
            findFirst: db.meeting.findFirst,
            update: db.meeting.update,
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MeetingsService,
                { provide: DatabaseService, useValue: db },
                { provide: ShortLinksService, useValue: shortLinks },
                { provide: EmailService, useValue: email },
                { provide: NotificationsService, useValue: notifications },
            ],
        }).compile();

        service = module.get(MeetingsService);
        (issueDocumentNumber as jest.Mock).mockResolvedValue('MIN-2026-0001');
    });

    const draft = (overrides: Record<string, unknown> = {}) => ({
        id: 'm-1',
        tenant_id: 'tenant-1',
        meeting_number: 'MIN-2026-0001',
        title: 'Eid stock',
        type: 'OTHER',
        status: 'DRAFT',
        organizer_id: OWNER.userId,
        created_by: OWNER.userId,
        share_token: null,
        starts_at: new Date('2026-11-01T09:00:00.000Z'),
        attendees: [],
        discussions: [],
        organizer: { id: OWNER.userId, name: 'Nayeem', email: 'owner@shop.com' },
        creator: { id: OWNER.userId, name: 'Nayeem', email: 'owner@shop.com' },
        finalizer: null,
        ...overrides,
    });

    describe('visibility', () => {
        it('lets an owner see every meeting without a grant lookup', async () => {
            await expect(service.seesEveryMeeting(OWNER)).resolves.toBe(true);
            expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
        });

        it('hides meetings from a staff member who is not involved', async () => {
            db.meeting.findFirst.mockResolvedValue(null);
            await expect(service.findOne(STAFF, 'm-1')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.meeting.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: expect.arrayContaining([
                            { organizer_id: STAFF.userId },
                            { created_by: STAFF.userId },
                        ]),
                    }),
                }),
            );
        });

        it('lets VIEW_ALL_MEETINGS see every meeting', async () => {
            db.userStorePermission.findFirst.mockResolvedValue({ id: 'grant-1' });
            db.meeting.findMany.mockResolvedValue([]);
            await service.findAll(STAFF);
            expect(db.meeting.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1' }),
                }),
            );
            const where = db.meeting.findMany.mock.calls[0][0].where;
            expect(where.OR).toBeUndefined();
        });

        it('keeps visibility when searching so a title match cannot leak another meeting', async () => {
            db.meeting.findMany.mockResolvedValue([]);
            await service.findAll(STAFF, { search: 'eid' });
            const where = db.meeting.findMany.mock.calls[0][0].where;
            expect(where.OR).toBeUndefined();
            expect(where.AND).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    OR: expect.arrayContaining([
                        { organizer_id: STAFF.userId },
                        { created_by: STAFF.userId },
                    ]),
                }),
                expect.objectContaining({
                    OR: expect.arrayContaining([
                        expect.objectContaining({ title: expect.objectContaining({ contains: 'eid' }) }),
                    ]),
                }),
            ]));
        });
    });

    describe('create', () => {
        it('issues a MIN number and stores a draft without notifying anyone', async () => {
            const created = draft();
            tx.meeting.create.mockResolvedValue(created);
            tx.meeting.findFirst.mockResolvedValue(created);

            const result = await service.create(OWNER, {
                title: 'Eid stock',
                startsAt: '2026-11-01T09:00:00.000Z',
            });

            expect(issueDocumentNumber).toHaveBeenCalledWith(tx, expect.objectContaining({
                tenantId: 'tenant-1',
                docType: 'MEETING',
                storeId: 'store-1',
            }));
            expect(result.status).toBe('DRAFT');
            expect(email.sendOperational).not.toHaveBeenCalled();
            expect(notifications.create).not.toHaveBeenCalled();
        });

        it('copies a team member name onto an action row', async () => {
            tx.tenantUser.findUnique.mockResolvedValue({
                user: { id: 'user-staff', name: 'Sadia', email: 'sadia@shop.com' },
            });
            tx.meeting.create.mockResolvedValue(draft());
            tx.meetingDiscussion.create.mockResolvedValue({ id: 'd-1' });
            tx.meetingActionItem.create.mockResolvedValue({ id: 'a-1' });
            tx.meeting.findFirst.mockResolvedValue(draft());

            await service.create(OWNER, {
                title: 'Eid stock',
                startsAt: '2026-11-01T09:00:00.000Z',
                discussions: [{
                    title: 'Stock planning',
                    actionItems: [{
                        description: 'Place PO',
                        assigneeUserId: 'user-staff',
                        dueDate: '2026-11-05',
                    }],
                }],
            });

            expect(tx.meetingActionItem.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    meeting_id: 'm-1',
                    assignee_user_id: 'user-staff',
                    assignee_name: 'Sadia',
                    assignee_email: 'sadia@shop.com',
                }),
            }));
            expect(tx.meetingActionItem.create.mock.calls[0][0].data.others).toBeUndefined();
        });

        it('writes additional people as their own rows', async () => {
            tx.tenantUser.findUnique.mockResolvedValue({
                user: { id: 'user-staff', name: 'Sadia', email: 'sadia@shop.com' },
            });
            tx.meeting.create.mockResolvedValue(draft());
            tx.meetingDiscussion.create.mockResolvedValue({ id: 'd-1' });
            tx.meetingActionItem.create.mockResolvedValue({ id: 'a-1' });
            tx.meeting.findFirst.mockResolvedValue(draft());

            await service.create(OWNER, {
                title: 'Eid stock',
                startsAt: '2026-11-01T09:00:00.000Z',
                discussions: [{
                    title: 'Stock planning',
                    actionItems: [{
                        description: 'Place PO',
                        assigneeUserId: 'user-staff',
                        dueDate: '2026-11-05',
                        others: [{ name: 'Karim', email: 'karim@supplier.com' }],
                    }],
                }],
            });

            expect(tx.meetingActionPerson.createMany).toHaveBeenCalledWith(expect.objectContaining({
                data: [expect.objectContaining({
                    action_item_id: 'a-1',
                    name: 'Karim',
                    email: 'karim@supplier.com',
                })],
            }));
        });
    });

    describe('finalize', () => {
        it('locks the draft and notifies unnotified open actions', async () => {
            const openAction = {
                id: 'a-1',
                description: 'Place PO',
                due_date: new Date('2026-11-05'),
                status: 'OPEN',
                assigned_notified_at: null,
                assignee_user_id: 'user-staff',
                assignee_name: 'Sadia',
                assignee_email: 'sadia@shop.com',
                others: [],
            };
            db.meeting.findFirst.mockResolvedValue(draft());
            db.meeting.update.mockResolvedValue(draft({
                status: 'FINALIZED',
                discussions: [{ title: 'Stock planning', actionItems: [openAction] }],
            }));
            db.meetingActionItem.update.mockResolvedValue({});

            await service.finalize(OWNER, 'm-1');

            expect(db.meeting.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'FINALIZED', finalized_by: OWNER.userId }),
            }));
            expect(email.sendOperational).toHaveBeenCalledWith(
                'sadia@shop.com',
                expect.stringContaining('New action point'),
                expect.stringContaining('Place PO'),
                expect.objectContaining({ tenantId: 'tenant-1' }),
            );
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'user-staff',
                'meeting_action_assignment',
                expect.any(String),
                'Place PO',
                '/meetings/actions',
                expect.objectContaining({ dedupeKey: 'meeting-action:assignment:a-1:user-staff' }),
            );
        });

        it('does not finalize a cancelled meeting', async () => {
            db.meeting.findFirst.mockResolvedValue(draft({ status: 'CANCELLED' }));
            await expect(service.finalize(OWNER, 'm-1')).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('share', () => {
        it('mints a token and a short link on a finalized meeting', async () => {
            db.meeting.findFirst.mockResolvedValue(draft({ status: 'FINALIZED', share_token: null }));
            db.meeting.update.mockResolvedValue({});

            const result = await service.share(OWNER, 'm-1');

            expect(result.token).toEqual(expect.any(String));
            expect(result.path).toBe('/s/abc12');
            expect(shortLinks.createForEntity).toHaveBeenCalledWith(expect.objectContaining({
                entityType: 'MEETING',
                entityId: 'm-1',
                targetUrl: expect.stringMatching(/^\/m\//),
            }));
        });

        it('refuses to share a draft', async () => {
            db.meeting.findFirst.mockResolvedValue(draft());
            await expect(service.share(OWNER, 'm-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('revokes the token and live short links together', async () => {
            db.meeting.findFirst.mockResolvedValue(draft({ status: 'FINALIZED', share_token: 'tok' }));
            tx.meeting.updateMany.mockResolvedValue({ count: 1 });

            await service.revokeShare(OWNER, 'm-1');

            expect(tx.meeting.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: { share_token: null, share_token_at: null },
            }));
            expect(tx.shortLink.updateMany).toHaveBeenCalled();
        });
    });

    describe('findByShareToken', () => {
        it('returns the public minutes', async () => {
            db.meeting.findFirst.mockResolvedValue({ meeting_number: 'MIN-2026-0001', title: 'Eid stock' });
            const result = await service.findByShareToken('tok');
            expect(result.meeting_number).toBe('MIN-2026-0001');
        });

        it('hides a missing token', async () => {
            db.meeting.findFirst.mockResolvedValue(null);
            await expect(service.findByShareToken('nope')).rejects.toThrow('This link is no longer available');
        });
    });

    describe('updateAction', () => {
        it('lets the assignee mark their own point done after finalize', async () => {
            db.meetingActionItem.findFirst.mockResolvedValue({
                id: 'a-1',
                tenant_id: 'tenant-1',
                meeting_id: 'm-1',
                assignee_user_id: STAFF.userId,
                status: 'OPEN',
                meeting: { organizer_id: OWNER.userId, status: 'FINALIZED' },
                others: [],
            });
            db.meeting.findFirst.mockResolvedValue({ id: 'm-1' });
            db.meetingActionItem.update.mockResolvedValue({ id: 'a-1', status: 'DONE' });

            const result = await service.updateAction(STAFF, 'a-1', { status: 'DONE' });
            expect(result.status).toBe('DONE');
            expect(db.meetingActionItem.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'DONE', completed_by: STAFF.userId }),
            }));
        });

        it('refuses a stranger', async () => {
            db.meetingActionItem.findFirst.mockResolvedValue({
                id: 'a-1',
                tenant_id: 'tenant-1',
                meeting_id: 'm-1',
                assignee_user_id: 'someone-else',
                status: 'OPEN',
                meeting: { organizer_id: OWNER.userId, status: 'FINALIZED' },
                others: [],
            });
            db.meeting.findFirst.mockResolvedValue({ id: 'm-1' });
            await expect(service.updateAction(STAFF, 'a-1', { status: 'DONE' })).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('overdueCount', () => {
        it('counts the viewer\'s open overdue points', async () => {
            db.meetingActionItem.count.mockResolvedValue(3);
            await expect(service.overdueCount(STAFF)).resolves.toEqual({ count: 3 });
            expect(db.meetingActionItem.count).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    assignee_user_id: STAFF.userId,
                    meeting: { status: 'FINALIZED' },
                }),
            }));
        });
    });
});
