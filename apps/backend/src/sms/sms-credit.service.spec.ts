import { BadRequestException } from '@nestjs/common';
import { SmsCreditService } from './sms-credit.service';

describe('SmsCreditService', () => {
    const db = {
        tenant: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        smsPackage: { findMany: jest.fn(), findUnique: jest.fn() },
        smsTransaction: { findMany: jest.fn(), create: jest.fn() },
    } as any;

    let service: SmsCreditService;

    beforeEach(() => {
        jest.resetAllMocks();
        service = new SmsCreditService(db);
    });

    describe('countSegments', () => {
        it('counts a short GSM message as one segment', () => {
            expect(service.countSegments('Hello there')).toBe(1);
        });

        it('splits long GSM messages into 153-char segments', () => {
            expect(service.countSegments('a'.repeat(161))).toBe(2);
            expect(service.countSegments('a'.repeat(306))).toBe(2);
            expect(service.countSegments('a'.repeat(307))).toBe(3);
        });

        it('bills Unicode (e.g. Bangla) messages at the shorter segment length', () => {
            // 70 Bangla chars = 1 segment, 71 = 2 segments
            expect(service.countSegments('আ'.repeat(70))).toBe(1);
            expect(service.countSegments('আ'.repeat(71))).toBe(2);
        });
    });

    describe('creditsForSend', () => {
        it('multiplies segments by recipient count', () => {
            expect(service.creditsForSend('a'.repeat(161), 3)).toBe(6);
        });
    });

    describe('consume', () => {
        it('deducts SMS credits and records a usage entry when the balance is sufficient', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 1 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 95, whatsapp_credits: 0, email_credits: 0 });

            const result = await service.consume('tenant-1', 5, { recipient: '8801', description: 'Sale receipt' });

            expect(result).toEqual({ allowed: true, balance: 95 });
            expect(db.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'tenant-1', sms_credits: { gte: 5 } },
                data: { sms_credits: { decrement: 5 } },
            });
            expect(db.smsTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ channel: 'SMS', type: 'USAGE', credits: -5, balance_after: 95 }),
            });
        });

        it('spends the balance of the channel it is given', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 1 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 500, whatsapp_credits: 9, email_credits: 41 });

            const result = await service.consume('tenant-1', 1, { channel: 'EMAIL', recipient: 'a@b.com' });

            expect(result).toEqual({ allowed: true, balance: 41 });
            expect(db.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'tenant-1', email_credits: { gte: 1 } },
                data: { email_credits: { decrement: 1 } },
            });
            expect(db.smsTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ channel: 'EMAIL', credits: -1, balance_after: 41 }),
            });
        });

        it('does not let one channel spend another channel’s balance', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 0 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 500, whatsapp_credits: 0, email_credits: 0 });

            const result = await service.consume('tenant-1', 1, { channel: 'WHATSAPP' });

            expect(result).toEqual({ allowed: false, balance: 0 });
            expect(db.tenant.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'tenant-1', whatsapp_credits: { gte: 1 } } }),
            );
            expect(db.smsTransaction.create).not.toHaveBeenCalled();
        });

        it('does not deduct when the balance is insufficient', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 0 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 2, whatsapp_credits: 0, email_credits: 0 });

            const result = await service.consume('tenant-1', 5);

            expect(result).toEqual({ allowed: false, balance: 2 });
            expect(db.smsTransaction.create).not.toHaveBeenCalled();
        });

        it('allows zero-credit sends without touching the balance', async () => {
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 10, whatsapp_credits: 0, email_credits: 0 });

            const result = await service.consume('tenant-1', 0);

            expect(result).toEqual({ allowed: true, balance: 10 });
            expect(db.tenant.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('grantCredits', () => {
        it('adds to the named channel and writes a ledger entry for it', async () => {
            db.tenant.update.mockResolvedValue({ whatsapp_credits: 2500 });
            db.smsTransaction.create.mockResolvedValue({ id: 'tx-1' });

            const result = await service.grantCredits('tenant-1', 'WHATSAPP', 2000, {
                type: 'PURCHASE',
                reference: 'bkash:ABC123',
            });

            expect(result).toEqual({ balance: 2500, transactionId: 'tx-1' });
            expect(db.tenant.update).toHaveBeenCalledWith({
                where: { id: 'tenant-1' },
                data: { whatsapp_credits: { increment: 2000 } },
                select: { whatsapp_credits: true },
            });
            expect(db.smsTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    channel: 'WHATSAPP',
                    type: 'PURCHASE',
                    credits: 2000,
                    balance_after: 2500,
                    reference: 'bkash:ABC123',
                }),
            });
        });

        it('runs inside the transaction it is handed', async () => {
            const tx = {
                tenant: { update: jest.fn().mockResolvedValue({ sms_credits: 10 }) },
                smsTransaction: { create: jest.fn().mockResolvedValue({ id: 'tx-2' }) },
            } as any;

            await service.grantCredits('tenant-1', 'SMS', 10, { type: 'PURCHASE' }, tx);

            expect(tx.tenant.update).toHaveBeenCalled();
            expect(tx.smsTransaction.create).toHaveBeenCalled();
            expect(db.tenant.update).not.toHaveBeenCalled();
        });
    });

    describe('getActivePackage', () => {
        it('rejects unknown and retired packages', async () => {
            db.smsPackage.findUnique.mockResolvedValueOnce(null);
            await expect(service.getActivePackage('missing')).rejects.toBeInstanceOf(BadRequestException);

            db.smsPackage.findUnique.mockResolvedValueOnce({ id: 'pkg-1', is_active: false });
            await expect(service.getActivePackage('pkg-1')).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    it('has no method a tenant could call to add credits for free', () => {
        // The old self-serve "Buy" flow granted credits on click with no
        // payment behind it. Credits are now added only by platform-admin
        // paths (an approved top-up request, or an admin sale).
        expect((service as any).createPurchase).toBeUndefined();
        expect((service as any).confirmPurchase).toBeUndefined();
    });
});
