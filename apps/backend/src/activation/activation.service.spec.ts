import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivationService } from './activation.service';

jest.mock('../auth/permission.util', () => ({
    hasStorePermission: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hasStorePermission } = require('../auth/permission.util') as { hasStorePermission: jest.Mock };

describe('ActivationService', () => {
    const db = {
        tenantSubscription: { findUnique: jest.fn() },
        activationRequest: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        billingEvent: { create: jest.fn() },
        tenantUser: { findFirst: jest.fn() },
        tenant: { findUnique: jest.fn() },
        user: { findMany: jest.fn() },
    };
    const email = {
        getFrontendUrl: jest.fn(),
        sendActivationRequestAlert: jest.fn(),
        sendActivationPaymentReceived: jest.fn(),
        sendWorkspaceActivated: jest.fn(),
        sendActivationRequestRejected: jest.fn(),
    };
    const audit = { log: jest.fn() };
    const billing = { quoteSubscriptionAmount: jest.fn(), applySubscriptionChange: jest.fn() };
    const settings = { getGroup: jest.fn() };

    let service: ActivationService;
    const ctx = { userId: 'user-1', tenantId: 'tenant-1' } as any;

    const pendingSubscription = {
        status: 'PAST_DUE',
        activated_at: null,
        billing_cycle: 'MONTHLY',
        plan: { code: 'STANDARD', name: 'Growth' },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        service = new ActivationService(db as any, email as any, audit as any, billing as any, settings as any);
        hasStorePermission.mockResolvedValue(true);
        audit.log.mockResolvedValue(undefined);
        email.getFrontendUrl.mockResolvedValue('https://app.erp71.com');
        email.sendActivationRequestAlert.mockResolvedValue(undefined);
        email.sendActivationPaymentReceived.mockResolvedValue(undefined);
        email.sendWorkspaceActivated.mockResolvedValue(undefined);
        email.sendActivationRequestRejected.mockResolvedValue(undefined);
        settings.getGroup.mockResolvedValue({ bkash_number: '01711000000', sla_hours: '12' });
        billing.quoteSubscriptionAmount.mockResolvedValue({ amount: 3599, setupFee: 500 });
        billing.applySubscriptionChange.mockResolvedValue({});
        db.tenant.findUnique.mockResolvedValue({ name: 'Dhaka Retail' });
        db.tenantUser.findFirst.mockResolvedValue({
            user: { email: 'owner@example.com' },
            tenant: { name: 'Dhaka Retail' },
        });
        db.activationRequest.findFirst.mockResolvedValue(null);
    });

    describe('getStatus', () => {
        it('quotes what a never-activated workspace owes and where to send it', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(pendingSubscription);

            const status = await service.getStatus(ctx);

            expect(status.pending_activation).toBe(true);
            expect(status.amount_due).toBe(3599);
            expect(status.instructions.bkash_number).toBe('01711000000');
            expect(status.instructions.sla_hours).toBe(12);
            // Only the methods the team has actually configured are offered — an
            // empty Nagad number must not render a field with nothing to pay to.
            expect(status.instructions.methods).toEqual(['BKASH']);
        });

        it('quotes nothing once the workspace is active', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue({
                status: 'ACTIVE',
                activated_at: new Date(),
                billing_cycle: 'MONTHLY',
                plan: { code: 'STANDARD', name: 'Growth' },
            });

            const status = await service.getStatus(ctx);

            expect(status.pending_activation).toBe(false);
            expect(status.amount_due).toBeNull();
            expect(billing.quoteSubscriptionAmount).not.toHaveBeenCalled();
        });

        it('is readable by a member who cannot submit', async () => {
            // A cashier deserves "the workspace is being activated" rather than a
            // permission error on a screen that only explains the wait.
            hasStorePermission.mockResolvedValue(false);
            db.tenantSubscription.findUnique.mockResolvedValue(pendingSubscription);

            const status = await service.getStatus(ctx);

            expect(status.pending_activation).toBe(true);
            expect(status.can_submit).toBe(false);
        });

        it('still renders payment details when the plan cannot be priced', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(pendingSubscription);
            billing.quoteSubscriptionAmount.mockRejectedValue(new Error('plan deactivated'));

            const status = await service.getStatus(ctx);

            expect(status.amount_due).toBeNull();
            expect(status.instructions.bkash_number).toBe('01711000000');
        });
    });

    describe('submitRequest', () => {
        const dto = { method: 'BKASH', transactionId: ' 8n7a2kd9 ', amount: 3599, senderNumber: '01812345678' } as any;

        beforeEach(() => {
            db.tenantSubscription.findUnique.mockResolvedValue(pendingSubscription);
            db.activationRequest.create.mockImplementation(({ data }: any) => ({
                id: 'req-1',
                ...data,
                status: 'PENDING',
                review_note: null,
                reviewed_at: null,
                created_at: new Date(),
            }));
        });

        it('records the claim without touching the subscription', async () => {
            const result = await service.submitRequest(ctx, dto);

            expect(result.status).toBe('PENDING');
            // Normalised, so a TrxID typed in lower case still collides with the
            // same receipt submitted by someone else.
            expect(result.transaction_id).toBe('8N7A2KD9');
            expect(billing.applySubscriptionChange).not.toHaveBeenCalled();
        });

        it('alerts the team and confirms to the owner', async () => {
            await service.submitRequest(ctx, dto);

            expect(email.sendActivationRequestAlert).toHaveBeenCalledWith(
                expect.objectContaining({ tenantName: 'Dhaka Retail', transactionId: '8N7A2KD9' }),
            );
            expect(email.sendActivationPaymentReceived).toHaveBeenCalledWith(
                'owner@example.com',
                expect.objectContaining({ slaHours: 12 }),
            );
        });

        it('refuses a second submission while one is already queued', async () => {
            db.activationRequest.findFirst.mockResolvedValue({ id: 'req-0', status: 'PENDING' });

            await expect(service.submitRequest(ctx, dto)).rejects.toThrow(ConflictException);
            expect(db.activationRequest.create).not.toHaveBeenCalled();
        });

        it('refuses once the workspace is already activated', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue({
                status: 'ACTIVE',
                activated_at: new Date(),
                billing_cycle: 'MONTHLY',
                plan: { code: 'STANDARD', name: 'Growth' },
            });

            await expect(service.submitRequest(ctx, dto)).rejects.toThrow(ConflictException);
        });

        it('refuses a member without billing permission', async () => {
            hasStorePermission.mockResolvedValue(false);

            await expect(service.submitRequest(ctx, dto)).rejects.toThrow(ForbiddenException);
        });

        it('turns a duplicate transaction ID into an answer the owner can act on', async () => {
            db.activationRequest.create.mockRejectedValue(
                new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                    code: 'P2002',
                    clientVersion: '5.22.0',
                }),
            );

            await expect(service.submitRequest(ctx, dto)).rejects.toThrow(/already been submitted/);
        });
    });

    describe('approve', () => {
        const request = {
            id: 'req-1',
            tenant_id: 'tenant-1',
            status: 'PENDING',
            method: 'BKASH',
            transaction_id: '8N7A2KD9',
            sender_number: '01812345678',
            amount: new Prisma.Decimal(3599),
            plan_code: 'STANDARD',
            billing_cycle: 'MONTHLY',
            tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
        };

        beforeEach(() => {
            db.activationRequest.findUnique.mockResolvedValue(request);
            db.activationRequest.updateMany.mockResolvedValue({ count: 1 });
            db.billingEvent.create.mockResolvedValue({ id: 'event-1' });
        });

        it('posts the payment and activates the workspace on a real period', async () => {
            await service.approve('req-1', 'admin-1', {});

            expect(db.billingEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ event_type: 'manual_payment', reference_id: '8N7A2KD9' }),
                }),
            );
            // Through applySubscriptionChange, not a status flip: a zero-length
            // period would leave the renewal job with a period that already ended.
            expect(billing.applySubscriptionChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: 'tenant-1',
                    planCode: 'STANDARD',
                    status: 'ACTIVE',
                    periodStart: expect.any(Date),
                }),
            );
            expect(email.sendWorkspaceActivated).toHaveBeenCalledWith('owner@example.com', 'Dhaka Retail');
        });

        it('posts what the admin actually received, not what was claimed', async () => {
            await service.approve('req-1', 'admin-1', { amount: 3000 });

            const [[call]] = db.billingEvent.create.mock.calls;
            expect(Number(call.data.amount)).toBe(3000);
        });

        it('lets only one of two admins approve the same request', async () => {
            db.activationRequest.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.approve('req-1', 'admin-2', {})).rejects.toThrow(ConflictException);
            expect(db.billingEvent.create).not.toHaveBeenCalled();
            expect(billing.applySubscriptionChange).not.toHaveBeenCalled();
        });

        it('refuses a request that was already reviewed', async () => {
            db.activationRequest.findUnique.mockResolvedValue({ ...request, status: 'REJECTED' });

            await expect(service.approve('req-1', 'admin-1', {})).rejects.toThrow(ConflictException);
        });
    });

    describe('reject', () => {
        beforeEach(() => {
            db.activationRequest.findUnique.mockResolvedValue({
                id: 'req-1',
                tenant_id: 'tenant-1',
                status: 'PENDING',
                tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
            });
            db.activationRequest.updateMany.mockResolvedValue({ count: 1 });
        });

        it('tells the owner why, and activates nothing', async () => {
            await service.reject('req-1', 'admin-1', { reason: 'No payment found for that TrxID.' });

            expect(email.sendActivationRequestRejected).toHaveBeenCalledWith(
                'owner@example.com',
                'Dhaka Retail',
                'No payment found for that TrxID.',
            );
            expect(billing.applySubscriptionChange).not.toHaveBeenCalled();
            expect(db.billingEvent.create).not.toHaveBeenCalled();
        });
    });
});
