import { CrmBirthdaysService } from './crm-birthdays.service';

describe('CrmBirthdaysService', () => {
    let service: CrmBirthdaysService;
    let db: { $queryRaw: jest.Mock };

    beforeEach(() => {
        jest.useFakeTimers();
        // 2026-11-15 12:00 in Dhaka.
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));

        db = { $queryRaw: jest.fn().mockResolvedValue([]) };
        service = new CrmBirthdaysService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('defaults to the next 30 days', async () => {
        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.filters.from).toBe('2026-11-15');
        expect(res.filters.to).toBe('2026-12-14');
        expect(res.days).toBe(30);
    });

    it('narrows the scan by month, because the stored year is never the one asked for', async () => {
        await service.report('tenant-1', {}, 'Asia/Dhaka');

        // The year on `birthday` is a birth year, so it can never appear in the
        // filter — that is why this goes through raw SQL rather than Prisma.
        // Only the month is pushed down; the exact day is resolved in JS, where
        // the window, the year rollover and 29 February are all in view.
        const sql = (db.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
        expect(sql).toContain('EXTRACT(MONTH');
        expect(sql).toContain('deleted_at IS NULL');
    });

    it('dates each birthday to the next time it comes round, in the tenant zone', async () => {
        db.$queryRaw.mockResolvedValue([
            // 20 November, will be 34
            { id: 'c1', name: 'Karim', phone: '0171', birthday: new Date('1992-11-20T00:00:00Z'), age: 34 },
            // 15 November — today
            { id: 'c2', name: 'Rahima', phone: null, birthday: new Date('1990-11-15T00:00:00Z'), age: 36 },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(2);
        const karim = res.rows.find((r) => r.customer_id === 'c1')!;
        expect(karim.next_birthday).toBe('2026-11-20');
        expect(karim.days_until).toBe(5);
        expect(karim.turning).toBe(34);
        expect(karim.today).toBe(false);

        const rahima = res.rows.find((r) => r.customer_id === 'c2')!;
        expect(rahima.days_until).toBe(0);
        expect(rahima.today).toBe(true);
    });

    it('sorts by how soon the birthday is', async () => {
        db.$queryRaw.mockResolvedValue([
            { id: 'c1', name: 'Late', phone: null, birthday: new Date('1990-12-10T00:00:00Z'), age: 36 },
            { id: 'c2', name: 'Soon', phone: null, birthday: new Date('1990-11-16T00:00:00Z'), age: 36 },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows.map((r) => r.name)).toEqual(['Soon', 'Late']);
    });

    it('rolls a December window over the new year', async () => {
        jest.setSystemTime(new Date('2026-12-28T06:00:00Z'));
        db.$queryRaw.mockResolvedValue([
            // 5 January — next year
            { id: 'c1', name: 'January', phone: null, birthday: new Date('1990-01-05T00:00:00Z'), age: 37 },
            // 30 December — in this year
            { id: 'c2', name: 'December', phone: null, birthday: new Date('1990-12-30T00:00:00Z'), age: 36 },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows.map((r) => r.name)).toEqual(['December', 'January']);
        expect(res.rows.find((r) => r.name === 'January')?.next_birthday).toBe('2027-01-05');
        expect(res.rows.find((r) => r.name === 'January')?.days_until).toBe(8);
    });

    it('counts somebody born on 29 February on 28 February in a common year', async () => {
        jest.setSystemTime(new Date('2027-02-27T06:00:00Z'));
        db.$queryRaw.mockResolvedValue([
            { id: 'c1', name: 'Leap', phone: null, birthday: new Date('1992-02-29T00:00:00Z'), age: 35 },
        ]);

        const res = await service.report('tenant-1', { days: 5 }, 'Asia/Dhaka');

        // 2027 has no 29 February; the day is clamped rather than skipped.
        expect(res.rows.map((r) => r.next_birthday)).toEqual(['2027-02-28']);
    });

    it('reports an empty list as an empty list', async () => {
        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(0);
        expect(res.total).toBe(0);
    });
});
