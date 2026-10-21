import { DailySummaryWhatsAppService } from './daily-summary-whatsapp.service';
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

describe('DailySummaryWhatsAppService', () => {
    const sends = new Map<string, SendRow>();
    const keyOf = (tenantId: string, reportDate: string) => `${tenantId}|${reportDate}`;

    const db = {
        tenant: { findMany: jest.fn() },
        store: { findMany: jest.fn() },
        tenantUser: { findMany: jest.fn() },
        dailySummaryWhatsAppSend: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn(),
        },
    };
    const reports = { getReport: jest.fn() };
    const email = { getFrontendUrl: jest.fn() };
    const whatsapp = { sendOwnerDailySummary: jest.fn() };
    const jobs = { track: jest.fn() };

    const service = new DailySummaryWhatsAppService(
        db as any,
        reports as any,
        email as any,
        whatsapp as any,
        jobs as any,
    );

    const tenant = {
        id: 't1',
        name: 'Karim Electronics',
        timezone: 'Asia/Dhaka',
        default_locale: 'en',
        daily_summary_recipient_ids: ['staff'],
        owner: { id: 'owner', name: 'Karim', mobile: '01711111111' },
    };

    beforeEach(() => {
        sends.clear();
        jest.resetAllMocks();
        db.tenant.findMany.mockResolvedValue([tenant]);
        db.store.findMany.mockResolvedValue([{ id: 'main', name: 'Main' }]);
        db.tenantUser.findMany.mockResolvedValue([{ user: { name: 'Asha', mobile: '01822222222' } }]);
        reports.getReport.mockResolvedValue(quietReport());
        email.getFrontendUrl.mockResolvedValue('https://app.erp71.com');
        whatsapp.sendOwnerDailySummary.mockResolvedValue({ sent: true });

        db.dailySummaryWhatsAppSend.upsert.mockImplementation(async ({ where, create }: any) => {
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
        db.dailySummaryWhatsAppSend.findUnique.mockImplementation(async ({ where }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            return sends.get(keyOf(tenant_id, report_date)) ?? null;
        });
        db.dailySummaryWhatsAppSend.updateMany.mockImplementation(async ({ where, data }: any) => {
            const row = sends.get(keyOf(where.tenant_id, where.report_date));
            if (!row || row.completed_at) return { count: 0 };
            const until = where.OR?.[1]?.locked_until?.lt as Date | undefined;
            const locked = row.locked_until && until && row.locked_until >= until;
            if (locked) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        });
        db.dailySummaryWhatsAppSend.update.mockImplementation(async ({ where, data }: any) => {
            const { tenant_id, report_date } = where.tenant_id_report_date;
            const row = sends.get(keyOf(tenant_id, report_date));
            Object.assign(row, data);
            return row;
        });
    });

    it('does nothing before 00:20 shop time', async () => {
        await service.sendDue(new Date('2026-10-20T18:19:00.000Z'));
        expect(reports.getReport).not.toHaveBeenCalled();
        expect(whatsapp.sendOwnerDailySummary).not.toHaveBeenCalled();
    });

    it('messages the owner and the chosen member once, for that shop day', async () => {
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);
        await service.sendDue(now);

        const calls = whatsapp.sendOwnerDailySummary.mock.calls;
        expect(calls.map((call: any[]) => call[0])).toEqual(['+8801711111111', '+8801822222222']);
        expect(calls[0][1]).toMatchObject({ name: 'Karim', day: '20 Oct' });
        expect(calls[0][1].summary).toContain('No sales');
        expect(calls[1][1].name).toBe('Asha');
        expect(calls[0][2]).toEqual({ tenantId: 't1' });
        expect(reports.getReport).toHaveBeenCalledTimes(1);
    });

    it('retries only when the shop is out of WhatsApp credits', async () => {
        whatsapp.sendOwnerDailySummary
            .mockResolvedValueOnce({ sent: true })
            .mockResolvedValueOnce({ sent: false, reason: 'INSUFFICIENT_WHATSAPP_CREDITS' });
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);

        whatsapp.sendOwnerDailySummary.mockResolvedValue({ sent: true });
        await service.sendDue(now);

        const phones = whatsapp.sendOwnerDailySummary.mock.calls.map((call: any[]) => call[0]);
        expect(phones).toEqual(['+8801711111111', '+8801822222222', '+8801822222222']);
    });

    it('does not retry a Meta rejection', async () => {
        whatsapp.sendOwnerDailySummary.mockResolvedValue({
            sent: false,
            reason: 'WHATSAPP_REJECTED',
            error: 'template in review',
        });
        const now = new Date('2026-10-20T18:20:00.000Z');
        await service.sendDue(now);
        await service.sendDue(now);

        expect(whatsapp.sendOwnerDailySummary).toHaveBeenCalledTimes(2);
    });

    it('keeps going when one workspace fails', async () => {
        db.tenant.findMany.mockResolvedValue([
            tenant,
            {
                ...tenant,
                id: 't2',
                owner: { id: 'o2', name: 'Two', mobile: '01933333333' },
                daily_summary_recipient_ids: [],
            },
        ]);
        reports.getReport.mockImplementation(async ({ tenantId }: { tenantId: string }) => {
            if (tenantId === 't1') throw new Error('report broke');
            return quietReport();
        });

        await service.sendDue(new Date('2026-10-20T18:20:00.000Z'));

        expect(whatsapp.sendOwnerDailySummary).toHaveBeenCalledWith(
            '+8801933333333',
            expect.objectContaining({ name: 'Two', day: '20 Oct' }),
            { tenantId: 't2' },
        );
    });
});
