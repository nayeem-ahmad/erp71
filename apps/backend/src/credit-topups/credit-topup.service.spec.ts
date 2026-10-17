import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditTopupService, normalizeTransactionId } from './credit-topup.service';
import { TenantContext } from '../database/tenant.decorator';

const ctx: TenantContext = {
    timezone: 'Asia/Dhaka',
    tenantId: 'tenant-1',
    userId: 'user-1',
    userRole: 'OWNER',
    storeId: 'store-1',
};

const pkg = {
    id: 'pkg-1',
    channel: 'WHATSAPP',
    name: 'Business — 2,000 WhatsApp',
    credits: 2000,
    price: 1800,
    currency: 'BDT',
    is_active: true,
};

const pendingRequest = {
    id: 'req-1',
    tenant_id: 'tenant-1',
    submitted_by: 'user-1',
    channel: 'WHATSAPP',
    package_id: 'pkg-1',
    package_name: pkg.name,
    credits: 2000,
    amount: new Prisma.Decimal(1800),
    currency: 'BDT',
    method: 'BKASH',
    transaction_id: 'ABC123XYZ',
    sender_number: '01711111111',
    note: null,
    status: 'PENDING',
    support_thread_id: 'thread-1',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    credits_granted: null,
    amount_received: null,
    created_at: new Date('2026-10-15T10:00:00Z'),
    updated_at: new Date('2026-10-15T10:00:00Z'),
};

function build() {
    const tx = {
        supportThread: {
            create: jest.fn().mockResolvedValue({ id: 'thread-1', ticketNumber: 1042 }),
            update: jest.fn().mockResolvedValue({}),
        },
        supportMessage: { create: jest.fn().mockResolvedValue({}) },
        creditTopupRequest: {
            create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...pendingRequest, ...data, id: 'req-1', supportThread: { ticketNumber: 1042 } }),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        billingEvent: { create: jest.fn().mockResolvedValue({ id: 'evt-1' }) },
    };
    const db = {
        tenantUser: { findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Rahim Store', sms_enabled: true }) },
        user: {
            findUnique: jest.fn().mockResolvedValue({ name: 'Rahim', email: 'rahim@example.com' }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
        creditTopupRequest: {
            count: jest.fn().mockResolvedValue(0),
            findUnique: jest.fn().mockResolvedValue(pendingRequest),
            findMany: jest.fn().mockResolvedValue([]),
        },
        activationRequest: { findFirst: jest.fn().mockResolvedValue(null) },
        supportThread: { findUnique: jest.fn().mockResolvedValue({ ticketNumber: 1042 }) },
        $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) as jest.Mock,
    };
    const credits = {
        getActivePackage: jest.fn().mockResolvedValue(pkg),
        getBalances: jest.fn().mockResolvedValue({ SMS: 0, WHATSAPP: 0, EMAIL: 0 }),
        listActivePackages: jest.fn().mockResolvedValue([]),
        listTransactions: jest.fn().mockResolvedValue([]),
        grantCredits: jest.fn().mockResolvedValue({ balance: 2000, transactionId: 'tx-1' }),
        mapPackage: jest.fn((p) => p),
    };
    const settings = {
        getGroup: jest.fn().mockResolvedValue({ bkash_number: '0714111977', instructions: null }),
    };
    const email = {
        getFrontendUrl: jest.fn().mockResolvedValue('https://app.erp71.com'),
        sendCreditTopupRequestAlert: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const supportEvents = { publish: jest.fn() };

    const service = new CreditTopupService(
        db as any,
        credits as any,
        settings as any,
        email as any,
        audit as any,
        supportEvents as any,
    );
    return { service, db, tx, credits, email, supportEvents };
}

describe('CreditTopupService', () => {
    describe('submitRequest', () => {
        const dto = { packageId: 'pkg-1', transactionId: ' abc123xyz ', senderNumber: '01711111111' };

        it('opens a support ticket and records the claim without granting any credit', async () => {
            const { service, tx, credits, email, supportEvents } = build();

            const result = await service.submitRequest(ctx, dto);

            expect(result).toEqual(
                expect.objectContaining({ status: 'PENDING', transaction_id: 'ABC123XYZ', ticket_number: 1042 }),
            );
            expect(tx.supportThread.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenantId: 'tenant-1',
                        createdById: 'user-1',
                        subject: expect.stringContaining('ABC123XYZ'),
                        messages: {
                            create: expect.objectContaining({
                                senderRole: 'owner',
                                body: expect.stringContaining('Paid by bKash to: 0714111977'),
                            }),
                        },
                    }),
                }),
            );
            expect(tx.creditTopupRequest.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        channel: 'WHATSAPP',
                        credits: 2000,
                        method: 'BKASH',
                        transaction_id: 'ABC123XYZ',
                        support_thread_id: 'thread-1',
                    }),
                }),
            );
            expect(credits.grantCredits).not.toHaveBeenCalled();
            expect(supportEvents.publish).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId: 'tenant-1', ticketNumber: 1042, actor: 'owner' }),
            );
            await new Promise((resolve) => setImmediate(resolve));
            expect(email.sendCreditTopupRequestAlert).toHaveBeenCalledWith(
                expect.objectContaining({ transactionId: 'ABC123XYZ', ticketNumber: 1042 }),
            );
        });

        it('refuses members without billing permission', async () => {
            const { service, db, tx } = build();
            db.tenantUser.findUnique.mockResolvedValue({ role: 'CASHIER' });

            await expect(service.submitRequest({ ...ctx, userRole: 'CASHIER' }, dto)).rejects.toBeInstanceOf(
                ForbiddenException,
            );
            expect(tx.creditTopupRequest.create).not.toHaveBeenCalled();
        });

        it('refuses a TrxID already submitted', async () => {
            const { service, db } = build();
            db.$transaction.mockRejectedValue(
                new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
            );

            await expect(service.submitRequest(ctx, dto)).rejects.toBeInstanceOf(ConflictException);
        });

        it('refuses a TrxID already used to pay for a workspace activation', async () => {
            const { service, db, tx } = build();
            db.activationRequest.findFirst.mockResolvedValue({ id: 'act-1' });

            await expect(service.submitRequest(ctx, dto)).rejects.toBeInstanceOf(ConflictException);
            expect(db.activationRequest.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { method: 'BKASH', transaction_id: 'ABC123XYZ' } }),
            );
            expect(tx.creditTopupRequest.create).not.toHaveBeenCalled();
        });

        it('caps how many unverified top-ups a shop can have open', async () => {
            const { service, db } = build();
            db.creditTopupRequest.count.mockResolvedValue(5);

            await expect(service.submitRequest(ctx, dto)).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('approve', () => {
        it('grants the credits, records the bKash payment and answers the ticket in one transaction', async () => {
            const { service, tx, credits } = build();

            const result = await service.approve('req-1', 'admin-1', {});

            expect(tx.creditTopupRequest.updateMany).toHaveBeenCalledWith({
                where: { id: 'req-1', status: 'PENDING' },
                data: expect.objectContaining({ status: 'APPROVED', reviewed_by: 'admin-1', credits_granted: 2000 }),
            });
            expect(credits.grantCredits).toHaveBeenCalledWith(
                'tenant-1',
                'WHATSAPP',
                2000,
                expect.objectContaining({ type: 'PURCHASE', reference: 'bkash:ABC123XYZ' }),
                tx,
            );
            expect(tx.billingEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    event_type: 'whatsapp_credit_sale_payment',
                    provider_name: 'bkash',
                    external_event_id: 'credit_topup_req-1',
                    reference_id: 'ABC123XYZ',
                    payload: expect.objectContaining({ method: 'bkash' }),
                }),
            });
            expect(tx.supportMessage.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ threadId: 'thread-1', senderId: 'admin-1', senderRole: 'admin' }),
            });
            expect(tx.supportThread.update).toHaveBeenCalledWith({
                where: { id: 'thread-1' },
                data: { status: 'resolved' },
            });
            expect(result).toEqual(expect.objectContaining({ status: 'APPROVED', credits_granted: 2000, balance: 2000 }));
        });

        it('uses the admin’s figures when the payment was short', async () => {
            const { service, tx, credits } = build();

            await service.approve('req-1', 'admin-1', { amount: 900, credits: 1000 });

            expect(credits.grantCredits).toHaveBeenCalledWith('tenant-1', 'WHATSAPP', 1000, expect.anything(), tx);
            expect(tx.billingEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ amount: new Prisma.Decimal(900) }),
            });
        });

        it('grants nothing when another admin got there first', async () => {
            const { service, tx, credits } = build();
            tx.creditTopupRequest.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.approve('req-1', 'admin-1', {})).rejects.toBeInstanceOf(ConflictException);
            expect(credits.grantCredits).not.toHaveBeenCalled();
            expect(tx.billingEvent.create).not.toHaveBeenCalled();
        });

        it('refuses a request that is no longer pending', async () => {
            const { service, db, credits } = build();
            db.creditTopupRequest.findUnique.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });

            await expect(service.approve('req-1', 'admin-1', {})).rejects.toBeInstanceOf(ConflictException);
            expect(credits.grantCredits).not.toHaveBeenCalled();
        });
    });

    describe('reject', () => {
        it('closes the request with the reason and grants nothing', async () => {
            const { service, tx, credits } = build();

            const result = await service.reject('req-1', 'admin-1', { reason: 'No such TrxID in bKash' });

            expect(result).toEqual({ id: 'req-1', status: 'REJECTED' });
            expect(tx.creditTopupRequest.updateMany).toHaveBeenCalledWith({
                where: { id: 'req-1', status: 'PENDING' },
                data: expect.objectContaining({ status: 'REJECTED', review_note: 'No such TrxID in bKash' }),
            });
            expect(tx.supportMessage.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ body: expect.stringContaining('No such TrxID in bKash') }),
            });
            expect(credits.grantCredits).not.toHaveBeenCalled();
        });
    });

    it('normalizes a TrxID the way bKash prints it', () => {
        expect(normalizeTransactionId(' 9a7 b3c2d1e ')).toBe('9A7B3C2D1E');
    });
});
