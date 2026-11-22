import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChequesService, calendarDay } from './cheques.service';
import { ChequesScheduler, chequeReminderText } from './cheques.scheduler';

const actor = { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', timezone: 'Asia/Dhaka' };

function setup() {
    const db = {
        cheque: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn(),
            groupBy: jest.fn().mockResolvedValue([]),
            create: jest.fn((args) => Promise.resolve({ id: 'c1', ...args.data })),
            update: jest.fn((args) => Promise.resolve({ id: args.where.id, amount: new Prisma.Decimal(10), cheque_date: calendarDay('2026-12-01'), ...args.data })),
            delete: jest.fn().mockResolvedValue({}),
        },
        notification: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { db, service: new ChequesService(db as never) };
}

describe('ChequesService', () => {
    it('keeps the cheque date as a calendar day and returns the amount as a number', async () => {
        const { db, service } = setup();
        const row = await service.create(actor, {
            direction: 'ISSUED',
            bankName: 'Sonali Bank',
            chequeNumber: '0012345',
            partyName: 'Rahim Traders',
            amount: 125000.5,
            chequeDate: '2026-12-01',
        });
        const data = db.cheque.create.mock.calls[0][0].data;
        expect(data.cheque_date.toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(data).toMatchObject({ tenant_id: 'tenant-1', store_id: 'store-1', status: 'PENDING', account_payee: true, created_by: 'user-1' });
        expect(row).toMatchObject({ amount: 125000.5, cheque_date: '2026-12-01' });
    });

    it('lists only this workspace, and "open" means pending or deposited', async () => {
        const { db, service } = setup();
        await service.findAll(actor, { status: 'open', search: 'rahim' });
        const where = db.cheque.findMany.mock.calls[0][0].where;
        expect(where.tenant_id).toBe('tenant-1');
        expect(where.status).toEqual({ in: ['PENDING', 'DEPOSITED'] });
        expect(where.OR).toHaveLength(3);
    });

    it('stamps the moment the status changes, and only then', async () => {
        const { db, service } = setup();
        db.cheque.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING' });
        await service.update(actor, 'c1', { status: 'CLEARED' });
        expect(db.cheque.update.mock.calls[0][0].data.status_changed_at).toBeInstanceOf(Date);

        await service.update(actor, 'c1', { memo: 'rent' });
        expect(db.cheque.update.mock.calls[1][0].data).not.toHaveProperty('status_changed_at');
    });

    it('answers another workspace’s cheque as not found', async () => {
        const { db, service } = setup();
        db.cheque.findFirst.mockResolvedValue(null);
        await expect(service.remove(actor, 'other')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.cheque.delete).not.toHaveBeenCalled();
    });
});

describe('ChequesScheduler', () => {
    it('reminds the creator and the owner once per tier, in Bangladesh days', async () => {
        const { db } = setup();
        const notifications = { create: jest.fn().mockResolvedValue({}) };
        const jobTracker = { track: jest.fn((_name, fn) => fn()) };
        db.cheque.findMany.mockResolvedValue([
            {
                id: 'c1', tenant_id: 'tenant-1', direction: 'ISSUED', party_name: 'Rahim', cheque_number: '77',
                bank_name: 'DBBL', amount: new Prisma.Decimal(5000), cheque_date: calendarDay('2026-11-24'),
                created_by: 'user-1', tenant: { owner_id: 'owner-1' },
            },
        ]);
        const scheduler = new ChequesScheduler(db as never, notifications as never, jobTracker as never);

        // 20:00 UTC on the 21st is already the 22nd in Dhaka.
        const result = await scheduler.run(new Date('2026-11-21T20:00:00Z'));

        const dates = db.cheque.findMany.mock.calls[0][0].where.cheque_date.in.map((d: Date) => d.toISOString().slice(0, 10));
        expect(dates).toEqual(['2026-11-24', '2026-11-22']);
        expect(notifications.create).toHaveBeenCalledTimes(2);
        expect(notifications.create.mock.calls.map((c) => c[1]).sort()).toEqual(['owner-1', 'user-1']);
        expect(result).toMatchObject({ sent: 2, failed: 0 });

        db.notification.findFirst.mockResolvedValue({ id: 'already' });
        notifications.create.mockClear();
        await scheduler.run(new Date('2026-11-21T20:00:00Z'));
        expect(notifications.create).not.toHaveBeenCalled();
    });

    it('words an issued and a received cheque differently', () => {
        const base = { party_name: 'Karim', cheque_number: '9', bank_name: 'BRAC Bank', amount: 150000 };
        expect(chequeReminderText({ ...base, direction: 'ISSUED' }, 2).title).toBe('Cheque to Karim falls due in 2 days');
        expect(chequeReminderText({ ...base, direction: 'RECEIVED' }, 0).title).toBe('Cheque from Karim can be deposited today');
        expect(chequeReminderText({ ...base, direction: 'ISSUED' }, 0).body).toContain('Tk 1,50,000');
    });
});
