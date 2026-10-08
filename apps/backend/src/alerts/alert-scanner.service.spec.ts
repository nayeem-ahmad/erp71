import { AlertScannerService, ENQUIRY_PREFIX } from './alert-scanner.service';
import { DEFAULT_THRESHOLDS } from './alert-settings.service';

describe('AlertScannerService', () => {
    const NOW = new Date('2026-10-08T08:00:00.000Z');
    const TO = new Date('2026-10-08T07:59:00.000Z'); // a minute's commit lag
    let db: any;
    let notifications: { create: jest.Mock };
    let directory: { userIds: jest.Mock };
    let settings: any;
    let anomalies: { scan: jest.Mock };
    let scanner: AlertScannerService;

    beforeEach(() => {
        db = {
            alertScanCursor: {
                findUnique: jest.fn().mockResolvedValue({ name: 'mobile-alerts', scanned_to: new Date('2026-10-08T07:54:00Z') }),
                upsert: jest.fn(),
            },
            sale: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
            salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
            cashierSession: { findMany: jest.fn().mockResolvedValue([]) },
            leadConversation: { findMany: jest.fn().mockResolvedValue([]) },
        };
        notifications = { create: jest.fn().mockResolvedValue({}) };
        directory = { userIds: jest.fn().mockResolvedValue(['u-owner', 'u-manager', 'u-cashier']) };
        settings = {
            lowest: jest.fn().mockResolvedValue(DEFAULT_THRESHOLDS),
            forTenants: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, DEFAULT_THRESHOLDS]))),
        };
        anomalies = { scan: jest.fn() };
        scanner = new AlertScannerService(
            db,
            notifications as any,
            directory as any,
            settings,
            anomalies as any,
            { for: jest.fn().mockResolvedValue('Asia/Dhaka') } as any,
            { track: (_: string, fn: () => unknown) => fn() } as any,
        );
    });

    it('reads from the cursor to a minute ago, and moves the cursor there', async () => {
        await scanner.scanOnce(NOW);

        const where = db.sale.findMany.mock.calls[0][0].where;
        expect(where.created_at).toEqual({ gt: new Date('2026-10-08T07:54:00Z'), lte: TO });
        // Asked the database for nothing under the lowest line any shop draws.
        expect(where.total_amount).toEqual({ gte: 50000 });
        expect(db.alertScanCursor.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { scanned_to: TO } }),
        );
    });

    it('looks back no more than a day after downtime', async () => {
        db.alertScanCursor.findUnique.mockResolvedValue({ scanned_to: new Date('2026-09-01T00:00:00Z') });
        await scanner.scanOnce(NOW);
        expect(db.sale.findMany.mock.calls[0][0].where.created_at.gt).toEqual(new Date('2026-10-07T07:59:00Z'));
    });

    it('tells the branch’s managers about a short till, never the cashier, once per session', async () => {
        db.cashierSession.findMany.mockResolvedValue([
            {
                id: 'sess-1', tenant_id: 't1', store_id: 'store-1', user_id: 'u-cashier', variance: -650,
                closing_cash: 3850, expected_cash: 4500,
                user: { name: 'Rina' }, counter: { name: 'Counter 1' }, store: { name: 'Main Store' },
            },
        ]);

        expect(await scanner.scanOnce(NOW)).toBe(1);

        expect(directory.userIds).toHaveBeenCalledWith('t1', 'VIEW_FINANCIAL_REPORTS', 'store-1');
        expect(notifications.create.mock.calls.map((c) => c[1])).toEqual(['u-owner', 'u-manager']);
        expect(notifications.create).toHaveBeenCalledWith(
            't1', 'u-owner', 'TILL_SHORTFALL', 'Till closed ৳ 650.00 short',
            'Rina · Counter 1 · Main Store: counted ৳ 3,850.00 against ৳ 4,500.00',
            '/sales/cashier-sessions',
            { dedupeKey: 'till:sess-1' },
        );
    });

    it('applies each shop’s own line, not the lowest', async () => {
        settings.lowest.mockResolvedValue({ ...DEFAULT_THRESHOLDS, large_sale_amount: 20000 });
        settings.forTenants.mockImplementation(async () =>
            new Map([
                ['t-small', { ...DEFAULT_THRESHOLDS, large_sale_amount: 20000 }],
                ['t-big', DEFAULT_THRESHOLDS],
            ]),
        );
        const sale = (tenant: string, id: string) => ({
            id, tenant_id: tenant, store_id: 's', serial_number: id, total_amount: 30000, created_by: null,
            store: { name: 'Main' }, customer: null,
        });
        db.sale.findMany.mockImplementation(async ({ where }: any) =>
            where.status === 'COMPLETED' ? [sale('t-small', 'INV-1'), sale('t-big', 'INV-2')] : [],
        );

        await scanner.scanOnce(NOW);

        const tenants = [...new Set(notifications.create.mock.calls.map((c) => c[0]))];
        expect(tenants).toEqual(['t-small']);
        expect(notifications.create.mock.calls[0][3]).toBe('Large sale: ৳ 30,000.00');
    });

    it('raises a website enquiry for the CRM, with the lead to open', async () => {
        db.leadConversation.findMany.mockResolvedValue([
            { id: 'conv-1', tenant_id: 't1', lead_id: 'lead-1', summary: `${ENQUIRY_PREFIX}Salma:\n\nDo you deliver to Mirpur?` },
        ]);

        await scanner.scanOnce(NOW);

        expect(directory.userIds).toHaveBeenCalledWith('t1', 'VIEW_LEADS', null);
        expect(notifications.create).toHaveBeenCalledWith(
            't1', 'u-owner', 'ENQUIRY', 'New website enquiry', 'Salma: Do you deliver to Mirpur?', '/crm/leads/lead-1',
            { dedupeKey: 'enquiry:conv-1' },
        );
    });

    it('sends one anomaly digest per workspace that found something today', async () => {
        db.sale.groupBy.mockResolvedValue([{ tenant_id: 't1' }, { tenant_id: 't2' }]);
        anomalies.scan.mockImplementation(async (tenantId: string) =>
            tenantId === 't1'
                ? { totalFlags: 3, anomalies: [{ detail: 'INV-9 sold below cost' }, { detail: 'INV-4 twice' }, { detail: 'x' }] }
                : { totalFlags: 0, anomalies: [] },
        );

        expect(await scanner.anomalyDigestOnce(NOW)).toBe(1);

        expect(anomalies.scan).toHaveBeenCalledWith('t1', { from: '2026-10-08', to: '2026-10-08', sensitivity: 'normal' });
        expect(notifications.create).toHaveBeenCalledWith(
            't1', 'u-owner', 'ANOMALY_DIGEST', '3 things looked unusual today',
            'INV-9 sold below cost · INV-4 twice · and 1 more', undefined,
            { dedupeKey: 'anomaly:2026-10-08' },
        );
    });
});
