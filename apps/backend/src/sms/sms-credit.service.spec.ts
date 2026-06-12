import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SmsCreditService } from './sms-credit.service';

describe('SmsCreditService', () => {
    const db = {
        tenant: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        smsPackage: { findMany: jest.fn(), findUnique: jest.fn() },
        smsTransaction: { findMany: jest.fn(), create: jest.fn() },
        tenantUser: { findUnique: jest.fn() },
        billingEvent: { upsert: jest.fn() },
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    let service: SmsCreditService;

    beforeEach(() => {
        jest.resetAllMocks();
        audit.log.mockResolvedValue(undefined);
        service = new SmsCreditService(db, audit);
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
        it('deducts credits and records a usage entry when the balance is sufficient', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 1 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 95 });

            const result = await service.consume('tenant-1', 5, { recipient: '8801', description: 'Sale receipt' });

            expect(result).toEqual({ allowed: true, balance: 95 });
            expect(db.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'tenant-1', sms_credits: { gte: 5 } },
                data: { sms_credits: { decrement: 5 } },
            });
            expect(db.smsTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ type: 'USAGE', credits: -5, balance_after: 95 }),
            });
        });

        it('does not deduct when the balance is insufficient', async () => {
            db.tenant.updateMany.mockResolvedValue({ count: 0 });
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 2 });

            const result = await service.consume('tenant-1', 5);

            expect(result).toEqual({ allowed: false, balance: 2 });
            expect(db.smsTransaction.create).not.toHaveBeenCalled();
        });

        it('allows zero-credit sends without touching the balance', async () => {
            db.tenant.findUnique.mockResolvedValue({ sms_credits: 10 });

            const result = await service.consume('tenant-1', 0);

            expect(result).toEqual({ allowed: true, balance: 10 });
            expect(db.tenant.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('createPurchase', () => {
        it('rejects non owner/manager roles', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ role: 'CASHIER' });

            await expect(
                service.createPurchase('user-1', 'tenant-1', { packageId: 'pkg-1' }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('rejects unknown packages', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });
            db.smsPackage.findUnique.mockResolvedValue(null);

            await expect(
                service.createPurchase('user-1', 'tenant-1', { packageId: 'missing' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('records a pending billing event and asks for confirmation', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });
            db.smsPackage.findUnique.mockResolvedValue({
                id: 'pkg-1',
                name: 'Starter',
                credits: 500,
                price: 250,
                currency: 'BDT',
                is_active: true,
            });

            const result = await service.createPurchase('user-1', 'tenant-1', { packageId: 'pkg-1' });

            expect(result.requires_confirmation).toBe(true);
            expect(result.package.credits).toBe(500);
            expect(db.billingEvent.upsert).toHaveBeenCalled();
        });
    });

    describe('confirmPurchase', () => {
        it('grants credits and writes a purchase ledger entry', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });
            db.smsPackage.findUnique.mockResolvedValue({
                id: 'pkg-1',
                name: 'Starter',
                credits: 500,
                price: 250,
                currency: 'BDT',
                is_active: true,
            });
            db.tenant.update.mockResolvedValue({ sms_credits: 600 });
            db.smsTransaction.create.mockResolvedValue({ id: 'tx-1' });

            const result = await service.confirmPurchase('user-1', 'tenant-1', {
                packageId: 'pkg-1',
                reference: 'sms_ref',
            });

            expect(result).toEqual(
                expect.objectContaining({ purchased: true, credits_added: 500, balance: 600 }),
            );
            expect(db.tenant.update).toHaveBeenCalledWith({
                where: { id: 'tenant-1' },
                data: { sms_credits: { increment: 500 } },
                select: { sms_credits: true },
            });
            expect(db.smsTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ type: 'PURCHASE', credits: 500, balance_after: 600 }),
            });
        });
    });
});
