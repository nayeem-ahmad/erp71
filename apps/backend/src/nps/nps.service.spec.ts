import { NpsService, PLATFORM_ASK_AFTER_DAYS } from './nps.service';
import { createSaleSurveyLink, newSurveyCode } from './nps-invite';

const DAY = 86_400_000;

function dbMock() {
    return {
        npsInvite: {
            findUnique: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn(async ({ data }: any) => ({ id: 'inv-1', ...data })),
        },
        npsResponse: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
        tenant: { findUnique: jest.fn() },
        salesSettings: { findUnique: jest.fn() },
    };
}

describe('survey codes and links', () => {
    it('makes short codes without look-alike characters', () => {
        const code = newSurveyCode();
        expect(code).toMatch(/^[A-HJ-NP-Za-km-z2-9]{8}$/);
    });

    it('creates a receipt link only when the shop has the survey on', async () => {
        const db = dbMock();
        process.env.FRONTEND_URL = 'https://app.erp71.com/';
        db.salesSettings.findUnique.mockResolvedValue({ nps_survey_enabled: false });
        expect(await createSaleSurveyLink(db as any, { tenantId: 't1', saleId: 's1', customerId: 'c1', storeId: null })).toBeNull();

        db.salesSettings.findUnique.mockResolvedValue({ nps_survey_enabled: true });
        const url = await createSaleSurveyLink(db as any, { tenantId: 't1', saleId: 's1', customerId: 'c1', storeId: 'b1' });
        expect(url).toMatch(/^https:\/\/app\.erp71\.com\/f\/[A-Za-z0-9]{8}$/);
        expect(db.npsInvite.create.mock.calls[0][0].data).toMatchObject({ tenant_id: 't1', sale_id: 's1', store_id: 'b1' });
    });

    it('never lets a survey failure cost the receipt', async () => {
        const db = dbMock();
        db.salesSettings.findUnique.mockRejectedValue(new Error('db down'));
        await expect(createSaleSurveyLink(db as any, { tenantId: 't1', saleId: 's1', customerId: 'c1', storeId: null })).resolves.toBeNull();
    });
});

describe('NpsService', () => {
    const invite = { id: 'inv-1', code: 'Ab3dE9xQ', tenant_id: 't1', store_id: 'b1', customer_id: 'c1', responded_at: null };

    it('records a receipt answer once, against the shop, branch and customer', async () => {
        const db = dbMock();
        db.npsInvite.findUnique.mockResolvedValue(invite);
        const service = new NpsService(db as any);

        await service.submitPublic('Ab3dE9xQ', 9, '  great service ');
        expect(db.npsResponse.create.mock.calls[0][0].data).toMatchObject({
            audience: 'tenant', tenant_id: 't1', store_id: 'b1', customer_id: 'c1', invite_id: 'inv-1', score: 9, comment: 'great service',
        });

        db.npsInvite.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.submitPublic('Ab3dE9xQ', 3)).rejects.toThrow('already been answered');
    });

    it('refuses a malformed or unknown code', async () => {
        const db = dbMock();
        db.npsInvite.findUnique.mockResolvedValue(null);
        const service = new NpsService(db as any);
        await expect(service.getPublicSurvey('../etc')).rejects.toThrow('not valid');
        await expect(service.getPublicSurvey('Unknown1')).rejects.toThrow('not valid');
        expect(db.npsInvite.findUnique).toHaveBeenCalledTimes(1);
    });

    it('asks only an owner, of a workspace at least a fortnight old, not answered or closed in 90 days', async () => {
        const db = dbMock();
        const now = new Date('2026-11-18T00:00:00Z');
        const old = { created_at: new Date(now.getTime() - (PLATFORM_ASK_AFTER_DAYS + 1) * DAY), platform_workspace_key: null };
        db.tenant.findUnique.mockResolvedValue(old);
        const service = new NpsService(db as any);

        expect(await service.shouldAskOwner({ userId: 'u1', tenantId: 't1', role: 'OWNER' }, now)).toEqual({ ask: true });
        expect(await service.shouldAskOwner({ userId: 'u1', tenantId: 't1', role: 'MANAGER' }, now)).toEqual({ ask: false });

        db.npsResponse.findFirst.mockResolvedValue({ id: 'r1' });
        expect(await service.shouldAskOwner({ userId: 'u1', tenantId: 't1', role: 'OWNER' }, now)).toEqual({ ask: false });

        db.npsResponse.findFirst.mockResolvedValue(null);
        db.tenant.findUnique.mockResolvedValue({ ...old, created_at: new Date(now.getTime() - 3 * DAY) });
        expect(await service.shouldAskOwner({ userId: 'u1', tenantId: 't1', role: 'OWNER' }, now)).toEqual({ ask: false });
    });

    it('stores a dismissal without a score, so the owner is not asked again for a while', async () => {
        const db = dbMock();
        const service = new NpsService(db as any);
        await service.submitOwner({ userId: 'u1', tenantId: 't1', role: 'OWNER' }, { dismissed: true, score: 8 });
        expect(db.npsResponse.create.mock.calls[0][0].data).toMatchObject({ audience: 'platform', score: null, dismissed: true });

        await expect(service.submitOwner({ userId: 'u2', tenantId: 't1', role: 'CASHIER' }, { score: 9 })).rejects.toThrow('owner');
    });
});
