import { DailySummarySmsService } from './daily-summary-sms.service';
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

describe('DailySummarySmsService', () => {
    const sends = new Map<string, SendRow>();
    const keyOf = (tenantId: string, reportDate: string) => `${tenantId}|${reportDate}`;

    const db = {
        tenant: { findMany: jest.fn() },
        store: { findMany: jest.fn() },
        tenantUser: { findMany: jest.fn() },
        dailySummarySmsSend: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn(),
        },
    };
    const reports = { getReport: jest.fn() };
    const sms = { sendSms: jest.fn() };
    const jobs = { track: jest.fn() };

    const service = new DailySummarySmsService(db as any, reports as any, sms as any, jobs as any);

    const tenant = {
        id: 't1',
        name: 'Karim Electronics',
        timezone: 'Asia/Dhaka',
        default_locale: 'en',
        daily_summary_recipient_ids: ['staff'],
        owner: { id: 'owner', mobile: '01711111111' },
    };

    beforeEach(() => {
        sends.clear();
        jest.resetAllMocks();
        db.tenant.findMany.mockResolvedValue([tenant]);
        db.store.findMany.mockResolvedValue([{ id: 'main', name: 'Main' }]);
        db.tenantUser.findMany.mockResolvedValue([{ user: { mobile: '01822222222' } }]);
        reports.getReport.mockResolvedValue(quietReport());
        sms.sendSms.mockResolvedValue({ sent: true });

        db.dailySummarySmsSend.upsert.mockImplementation(async ({ where, create }: any) => {
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
        db.dailySummarySmsSend.findUnique.mockImplementation(async ({ where }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            return sends.get(keyOf(tenant_id, report_date)) ?? null;
        });
        db.dailySummarySmsSend.updateMany.mockImplementation(async ({ where, data }: any) => {
            const row = sends.get(keyOf(where.tenant_id, where.report_date));
            if (!row || row.completed_at) return { count: 0 };
            const until = where.OR?.[1]?.locked_until?.lt as Date | undefined;
            const locked = row.locked_until && until && row.locked_until >= until;
            if (locked) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        });
        db.dailySummarySmsSend.update.mockImplementation(async ({ where, data }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            const row = sends.get(keyOf(tenant_id, report_date));
            Object.assign(row, data);
            return row;
        });
    });

    it('does nothing before 00:20 shop time', async () => {
        await service.sendDue(new Date('2026-10-20T18:19:00.000Z'));
        expect(reports.getReport).not.toHaveBeenCalled();
        expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it('texts the owner and the chosen member once, then not again', async () => {
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);
        await service.sendDue(now);

        const phones = sms.sendSms.mock.calls.map((call: any[]) => call[0]);
        expect(phones).toEqual(['+8801711111111', '+8801822222222']);
        expect(sms.sendSms.mock.calls[0][1]).toBe('Karim Electronics 20 Oct: No sales.');
        expect(sms.sendSms.mock.calls[0][2]).toEqual({ tenantId: 't1', purpose: 'Daily business summary' });
        expect(reports.getReport).toHaveBeenCalledTimes(1);
    });

    it('skips a login with no mobile and retries only the text that failed', async () => {
        db.tenant.findMany.mockResolvedValue([{ ...tenant, owner: { id: 'owner', mobile: null } }]);
        sms.sendSms.mockResolvedValueOnce({ sent: false, reason: 'INSUFFICIENT_SMS_CREDITS' });
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);

        sms.sendSms.mockResolvedValue({ sent: true });
        await service.sendDue(now);

        const phones = sms.sendSms.mock.calls.map((call: any[]) => call[0]);
        expect(phones).toEqual(['+8801822222222', '+8801822222222']);
    });

    it('keeps going when one workspace fails', async () => {
        db.tenant.findMany.mockResolvedValue([
            tenant,
            { ...tenant, id: 't2', owner: { id: 'o2', mobile: '01933333333' }, daily_summary_recipient_ids: [] },
        ]);
        reports.getReport.mockImplementation(async ({ tenantId }: { tenantId: string }) => {
            if (tenantId === 't1') throw new Error('report broke');
            return quietReport();
        });

        await service.sendDue(new Date('2026-10-20T18:20:00.000Z'));

        expect(sms.sendSms).toHaveBeenCalledWith(
            '+8801933333333',
            expect.any(String),
            { tenantId: 't2', purpose: 'Daily business summary' },
        );
    });
});
