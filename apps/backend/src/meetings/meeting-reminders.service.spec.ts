import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { MeetingRemindersService } from './meeting-reminders.service';
import { MeetingsService } from './meetings.service';

describe('MeetingRemindersService', () => {
    let service: MeetingRemindersService;
    const db = {
        meetingActionItem: {
            findMany: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
    };
    const meetings = { sendActionMail: jest.fn().mockResolvedValue(undefined) };
    const email = {
        getFrontendUrl: jest.fn().mockResolvedValue('https://app.erp71.com'),
        sendOperational: jest.fn().mockResolvedValue(undefined),
    };

    const item = (overrides: Record<string, unknown> = {}) => ({
        id: 'a-1',
        description: 'Place PO',
        due_date: new Date('2026-11-05T00:00:00.000Z'),
        status: 'OPEN',
        assigned_notified_at: new Date('2026-11-01'),
        due_soon_notified_at: null,
        last_overdue_notified_at: null,
        assignee_user_id: 'user-staff',
        assignee_name: 'Sadia',
        assignee_email: 'sadia@shop.com',
        others: [],
        discussion: { title: 'Eid stock planning' },
        meeting: {
            id: 'm-1',
            tenant_id: 'tenant-1',
            title: 'Eid stock',
            meeting_number: 'MIN-2026-0001',
            starts_at: new Date('2026-11-01T09:00:00.000Z'),
            share_token: 'tok',
            organizer_id: 'user-owner',
            organizer: { name: 'Nayeem', email: 'owner@shop.com' },
        },
        ...overrides,
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MeetingRemindersService,
                { provide: DatabaseService, useValue: db },
                { provide: MeetingsService, useValue: meetings },
                { provide: EmailService, useValue: email },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => unknown) => fn() } },
            ],
        }).compile();
        service = module.get(MeetingRemindersService);
    });

    it('sends a due-soon reminder the day before and stamps due_soon_notified_at', async () => {
        db.meetingActionItem.findMany.mockResolvedValue([item()]);
        const result = await service.run(new Date('2026-11-04T03:00:00.000Z')); // 09:00 Dhaka
        expect(result.dueSoon).toBe(1);
        expect(meetings.sendActionMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'due_soon' }));
        expect(db.meetingActionItem.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ due_soon_notified_at: expect.any(Date) }),
        }));
    });

    it('does not re-send due-soon when already stamped', async () => {
        db.meetingActionItem.findMany.mockResolvedValue([item({ due_soon_notified_at: new Date('2026-11-04') })]);
        const result = await service.run(new Date('2026-11-04T03:00:00.000Z'));
        expect(result.dueSoon).toBe(0);
        expect(meetings.sendActionMail).not.toHaveBeenCalled();
    });

    it('sends overdue the day after the deadline, then waits a week', async () => {
        db.meetingActionItem.findMany.mockResolvedValue([item()]);
        const first = await service.run(new Date('2026-11-06T03:00:00.000Z'));
        expect(first.overdue).toBe(1);

        meetings.sendActionMail.mockClear();
        db.meetingActionItem.findMany.mockResolvedValue([item({ last_overdue_notified_at: new Date('2026-11-06T03:00:00.000Z') })]);
        const nextDay = await service.run(new Date('2026-11-07T03:00:00.000Z'));
        expect(nextDay.overdue).toBe(0);

        db.meetingActionItem.findMany.mockResolvedValue([item({ last_overdue_notified_at: new Date('2026-11-06T03:00:00.000Z') })]);
        const weekLater = await service.run(new Date('2026-11-13T03:00:00.000Z'));
        expect(weekLater.overdue).toBe(1);
    });

    it('skips cancelled meetings because the query only loads FINALIZED rows', async () => {
        db.meetingActionItem.findMany.mockResolvedValue([]);
        await service.run(new Date('2026-11-06T03:00:00.000Z'));
        expect(db.meetingActionItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                meeting: { status: 'FINALIZED' },
            }),
        }));
    });

    it('sends one organizer digest on Monday', async () => {
        db.meetingActionItem.findMany.mockResolvedValue([item(), item({ id: 'a-2', description: 'Confirm courier' })]);
        // 2026-11-09 is a Monday. 03:00 UTC = 09:00 Dhaka.
        const result = await service.run(new Date('2026-11-09T03:00:00.000Z'));
        expect(result.digests).toBe(1);
        expect(email.sendOperational).toHaveBeenCalledTimes(1);
        expect(email.sendOperational.mock.calls[0][0]).toBe('owner@shop.com');
        expect(email.sendOperational.mock.calls[0][1]).toContain('Overdue meeting actions');
    });
});
