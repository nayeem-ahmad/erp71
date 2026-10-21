import { DailySummaryEmailService } from './daily-summary-email.service';
import type { DailyReport } from './daily-report.types';

function quietReport(): DailyReport {
    return {
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-20',
        timezone: 'Asia/Dhaka',
        generatedAt: '2026-10-20T18:20:00.000Z',
        asOf: '2026-10-20T18:20:00.000Z',
        firstSaleAt: null,
        lastSaleAt: null,
        headlines: { netSales: 0, cashMovement: 0, newDues: 0, vsPreviousPct: null },
        sales: { bills: 0, gross: 0, returnsAmount: 0, returnsCount: 0, net: 0, avgBill: 0 },
        tenders: [],
        till: null,
        moneyOut: null,
        dues: null,
        topProducts: [],
        returns: { rows: [], moreCount: 0 },
        stock: null,
        checklist: [],
        whatsappText: '',
    };
}

type SendRow = {
    tenant_id: string;
    report_date: string;
    sent_to: string[];
    locked_until: Date | null;
    completed_at: Date | null;
};

describe('DailySummaryEmailService', () => {
    const sends = new Map<string, SendRow>();
    const keyOf = (tenantId: string, reportDate: string) => `${tenantId}|${reportDate}`;

    const db = {
        tenant: { findMany: jest.fn() },
        store: { findMany: jest.fn() },
        tenantUser: { findMany: jest.fn() },
        dailySummaryEmailSend: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn(),
        },
    };
    const reports = { getReport: jest.fn() };
    const email = { getFrontendUrl: jest.fn(), sendDailyBusinessSummary: jest.fn() };
    const jobs = { track: jest.fn() };

    const service = new DailySummaryEmailService(db as any, reports as any, email as any, jobs as any);

    const tenant = {
        id: 't1',
        name: 'Karim Electronics',
        timezone: 'Asia/Dhaka',
        default_locale: 'en',
        daily_summary_recipient_ids: ['staff'],
        owner: { id: 'owner', email: 'Owner@Shop.test' },
    };

    beforeEach(() => {
        sends.clear();
        jest.resetAllMocks();
        db.tenant.findMany.mockResolvedValue([tenant]);
        db.store.findMany.mockResolvedValue([{ id: 'main', name: 'Main' }]);
        db.tenantUser.findMany.mockResolvedValue([{ user: { email: 'staff@shop.test' } }]);
        reports.getReport.mockResolvedValue(quietReport());
        email.getFrontendUrl.mockResolvedValue('https://app.erp71.com');
        email.sendDailyBusinessSummary.mockResolvedValue(undefined);

        db.dailySummaryEmailSend.upsert.mockImplementation(async ({ where, create }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            const key = keyOf(tenant_id, report_date);
            if (!sends.has(key)) {
                sends.set(key, {
                    tenant_id,
                    report_date,
                    sent_to: create.sent_to ?? [],
                    locked_until: null,
                    completed_at: null,
                });
            }
            return sends.get(key);
        });
        db.dailySummaryEmailSend.findUnique.mockImplementation(async ({ where }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            return sends.get(keyOf(tenant_id, report_date)) ?? null;
        });
        db.dailySummaryEmailSend.updateMany.mockImplementation(async ({ where, data }: any) => {
            const row = sends.get(keyOf(where.tenant_id, where.report_date));
            if (!row || row.completed_at) return { count: 0 };
            const until = where.OR?.[1]?.locked_until?.lt as Date | undefined;
            const locked = row.locked_until && until && row.locked_until >= until;
            if (locked) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        });
        db.dailySummaryEmailSend.update.mockImplementation(async ({ where, data }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            const row = sends.get(keyOf(tenant_id, report_date));
            Object.assign(row, data);
            return row;
        });
    });

    it('does nothing before 00:20 shop time', async () => {
        await service.sendDue(new Date('2026-10-20T18:19:00.000Z'));
        expect(reports.getReport).not.toHaveBeenCalled();
        expect(email.sendDailyBusinessSummary).not.toHaveBeenCalled();
    });

    it('sends to the owner and the chosen member once, then not again', async () => {
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);
        await service.sendDue(now);

        const addresses = email.sendDailyBusinessSummary.mock.calls.map((call: any[]) => call[0]);
        expect(addresses).toEqual(['owner@shop.test', 'staff@shop.test']);
        expect(email.sendDailyBusinessSummary.mock.calls[0][1]).toBe('Karim Electronics · Main · 20 Oct');
        expect(reports.getReport).toHaveBeenCalledTimes(1);
    });

    it('retries only the address that failed', async () => {
        email.sendDailyBusinessSummary.mockImplementation(async (address: string) => {
            if (address === 'staff@shop.test') throw new Error('smtp down');
        });
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);

        email.sendDailyBusinessSummary.mockResolvedValue(undefined);
        await service.sendDue(now);

        const addresses = email.sendDailyBusinessSummary.mock.calls.map((call: any[]) => call[0]);
        expect(addresses).toEqual(['owner@shop.test', 'staff@shop.test', 'staff@shop.test']);
    });

    it('keeps going when one workspace fails', async () => {
        db.tenant.findMany.mockResolvedValue([
            tenant,
            { ...tenant, id: 't2', owner: { id: 'o2', email: 'two@shop.test' }, daily_summary_recipient_ids: [] },
        ]);
        reports.getReport.mockImplementation(async ({ tenantId }: { tenantId: string }) => {
            if (tenantId === 't1') throw new Error('report broke');
            return quietReport();
        });

        await service.sendDue(new Date('2026-10-20T18:20:00.000Z'));

        expect(email.sendDailyBusinessSummary).toHaveBeenCalledWith(
            'two@shop.test',
            expect.any(String),
            expect.any(String),
        );
    });
});
