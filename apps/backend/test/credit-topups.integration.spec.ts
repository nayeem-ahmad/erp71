import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { SmsCreditService } from '../src/sms/sms-credit.service';
import { CreditTopupService } from '../src/credit-topups/credit-topup.service';
import type { TenantContext } from '../src/database/tenant.decorator';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(60_000);

/**
 * Messaging-credit top-ups against a real database, for the two guarantees a
 * mock cannot prove: one bKash TrxID buys one package (the unique index), and
 * two admins approving the same request at once grant the credits once (the
 * PENDING → APPROVED transition inside the grant's transaction).
 */
describe('Credit top-ups (integration)', () => {
    const db = new DatabaseService();
    const credits = new SmsCreditService(db);
    const supportEvents = { publish: jest.fn() };
    const service = new CreditTopupService(
        db,
        credits,
        { getGroup: jest.fn().mockResolvedValue({ bkash_number: '0714111977', instructions: null }) } as never,
        {
            getFrontendUrl: jest.fn().mockResolvedValue(''),
            sendCreditTopupRequestAlert: jest.fn().mockResolvedValue(undefined),
        } as never,
        { log: jest.fn().mockResolvedValue(undefined) } as never,
        supportEvents as never,
    );

    const suffix = `${Date.now()}`;
    let ownerId: string;
    let adminIds: string[];
    let tenantId: string;
    let packageId: string;
    let ctx: TenantContext;

    beforeAll(async () => {
        await db.$connect();

        const owner = await db.user.create({
            data: { email: `topup-owner-${suffix}@test.local`, passwordHash: 'x', name: 'Topup Owner' },
        });
        ownerId = owner.id;
        const admins = await Promise.all(
            [1, 2].map((n) =>
                db.user.create({
                    data: { email: `topup-admin-${n}-${suffix}@test.local`, passwordHash: 'x', name: `Admin ${n}`, is_platform_admin: true },
                }),
            ),
        );
        adminIds = admins.map((admin) => admin.id);

        const tenant = await db.tenant.create({ data: { name: `Topup ${suffix}`, owner_id: owner.id } });
        tenantId = tenant.id;
        await db.tenantUser.create({ data: { tenant_id: tenantId, user_id: ownerId, role: 'OWNER' } });

        const pkg = await db.smsPackage.create({
            data: { channel: 'WHATSAPP', name: `Test 2,000 WhatsApp ${suffix}`, credits: 2000, price: 1800, currency: 'BDT' },
        });
        packageId = pkg.id;

        ctx = { tenantId, userId: ownerId, userRole: 'OWNER', timezone: 'Asia/Dhaka' };
    });

    afterAll(async () => {
        await db.creditTopupRequest.deleteMany({ where: { tenant_id: tenantId } });
        await db.billingEvent.deleteMany({ where: { tenant_id: tenantId } });
        await db.supportThread.deleteMany({ where: { tenantId } });
        await db.tenant.delete({ where: { id: tenantId } });
        await db.smsPackage.delete({ where: { id: packageId } });
        await db.user.deleteMany({ where: { id: { in: [ownerId, ...adminIds] } } });
        await db.$disconnect();
    });

    it('records the claim and opens a ticket, granting nothing', async () => {
        const request = await service.submitRequest(ctx, {
            packageId,
            transactionId: `trx${suffix}`,
            senderNumber: '01711111111',
        });

        expect(request.status).toBe('PENDING');
        expect(request.transaction_id).toBe(`TRX${suffix}`);
        expect(request.ticket_number).toEqual(expect.any(Number));

        const thread = await db.supportThread.findFirst({
            where: { tenantId },
            include: { messages: true },
        });
        expect(thread?.status).toBe('open');
        expect(thread?.messages[0].body).toContain('0714111977');
        expect(thread?.messages[0].body).toContain(`TRX${suffix}`);

        expect(await credits.getBalances(tenantId)).toEqual({ SMS: 0, WHATSAPP: 0, EMAIL: 0 });
    });

    it('refuses the same TrxID a second time, whatever its case', async () => {
        await expect(
            service.submitRequest(ctx, { packageId, transactionId: `TrX${suffix}`, senderNumber: '01711111111' }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(await db.creditTopupRequest.count({ where: { tenant_id: tenantId } })).toBe(1);
        // The failed attempt's ticket rolled back with it.
        expect(await db.supportThread.count({ where: { tenantId } })).toBe(1);
    });

    it('grants the credits exactly once when two admins approve at the same moment', async () => {
        const request = await db.creditTopupRequest.findFirstOrThrow({ where: { tenant_id: tenantId } });

        const outcomes = await Promise.allSettled(
            adminIds.map((adminId) => service.approve(request.id, adminId, {})),
        );

        expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

        expect(await credits.getBalances(tenantId)).toEqual({ SMS: 0, WHATSAPP: 2000, EMAIL: 0 });
        expect(
            await db.smsTransaction.count({ where: { tenant_id: tenantId, channel: 'WHATSAPP', type: 'PURCHASE' } }),
        ).toBe(1);

        const payments = await db.billingEvent.findMany({ where: { tenant_id: tenantId } });
        expect(payments).toHaveLength(1);
        expect(payments[0]).toEqual(
            expect.objectContaining({ event_type: 'whatsapp_credit_sale_payment', provider_name: 'bkash' }),
        );
        expect(Number(payments[0].amount)).toBe(1800);

        const thread = await db.supportThread.findFirstOrThrow({ where: { tenantId }, include: { messages: true } });
        expect(thread.status).toBe('resolved');
        expect(thread.messages.filter((m) => m.senderRole === 'admin')).toHaveLength(1);
    });

    it('spends the WhatsApp balance one message at a time and stops at zero', async () => {
        await db.tenant.update({ where: { id: tenantId }, data: { whatsapp_credits: 1 } });

        const first = await credits.consume(tenantId, 1, { channel: 'WHATSAPP', recipient: '8801711111111' });
        const second = await credits.consume(tenantId, 1, { channel: 'WHATSAPP', recipient: '8801711111111' });

        expect(first).toEqual({ allowed: true, balance: 0 });
        expect(second).toEqual({ allowed: false, balance: 0 });
        expect(await credits.getBalances(tenantId)).toEqual({ SMS: 0, WHATSAPP: 0, EMAIL: 0 });
    });
});
