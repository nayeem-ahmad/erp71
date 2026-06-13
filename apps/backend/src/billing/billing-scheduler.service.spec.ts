import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
    const db = {
        tenantSubscription: { findMany: jest.fn(), update: jest.fn() },
        subscriptionPlan: { findUnique: jest.fn() },
        billingEvent: { findFirst: jest.fn(), create: jest.fn() },
    } as any;

    const email = {
        sendSubscriptionCancelled: jest.fn().mockResolvedValue(undefined),
        sendPaymentRetryReminder: jest.fn().mockResolvedValue(undefined),
    } as any;

    const audit = {
        log: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Passthrough tracker: invokes the wrapped job body so tests exercise it.
    const jobTracker = {
        track: jest.fn((_name: string, fn: () => any) => fn()),
    } as any;

    let service: BillingSchedulerService;

    const freePlan = { id: 'plan-free', code: 'FREE', name: 'Free', monthly_price: 0, yearly_price: 0 };

    const makeSubscription = (overrides?: Partial<{
        tenant_id: string;
        status: string;
        current_period_end: Date;
        plan: object;
        tenant: object;
    }>) => ({
        tenant_id: 'tenant-1',
        status: 'PAST_DUE',
        current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        plan: { id: 'plan-premium', code: 'PREMIUM', monthly_price: 3999 },
        tenant: {
            id: 'tenant-1',
            name: 'Tenant One',
            owner: { id: 'user-1', email: 'owner@example.com' },
        },
        ...overrides,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        audit.log.mockResolvedValue(undefined);
        jobTracker.track.mockImplementation((_name: string, fn: () => any) => fn());
        service = new BillingSchedulerService(db, email, audit, jobTracker);
        delete process.env.DUNNING_GRACE_DAYS;

        db.subscriptionPlan.findUnique.mockResolvedValue(freePlan);
        db.tenantSubscription.update.mockResolvedValue({});
        db.billingEvent.findFirst.mockResolvedValue(null);
        db.billingEvent.create.mockResolvedValue({ id: 'retry-event-1' });
    });

    it('sends payment retry reminders for PAST_DUE subscriptions within the grace window', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({
                current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            }),
        ]);

        await service.retryFailedPayments();

        expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ event_type: 'PAYMENT_RETRY_REMINDER' }),
        }));
        expect(email.sendPaymentRetryReminder).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
            7,
        );
    });

    it('skips payment retry reminders when one was sent in the last 24 hours', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);
        db.billingEvent.findFirst.mockResolvedValueOnce({ id: 'recent-reminder' });

        await service.retryFailedPayments();

        expect(db.billingEvent.create).not.toHaveBeenCalled();
        expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
    });

    it('cancels overdue PAST_DUE subscriptions and sends cancellation email', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        expect(db.tenantSubscription.update).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1' },
            data: { status: 'CANCELLED', plan_id: 'plan-free', cancel_at_period_end: false },
        });
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            7,
        );
    });

    it('logs an audit event for each cancelled subscription', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        expect(audit.log).toHaveBeenCalledWith(
            'SUBSCRIPTION_CANCELLED_DUNNING',
            'TenantSubscription',
            { tenantId: 'tenant-1' },
            'tenant-1',
            { previousPlan: 'PREMIUM', graceDays: 7 },
        );
    });

    it('does nothing when no subscriptions are overdue', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([]);

        await service.performDunning();

        expect(db.subscriptionPlan.findUnique).not.toHaveBeenCalled();
        expect(db.tenantSubscription.update).not.toHaveBeenCalled();
        expect(email.sendSubscriptionCancelled).not.toHaveBeenCalled();
    });

    it('aborts when FREE plan does not exist in database', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);
        db.subscriptionPlan.findUnique.mockResolvedValue(null);

        await service.performDunning();

        expect(db.tenantSubscription.update).not.toHaveBeenCalled();
        expect(email.sendSubscriptionCancelled).not.toHaveBeenCalled();
    });

    it('skips email when tenant owner has no email address', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'user-1', email: null } } }),
        ]);

        await service.performDunning();

        expect(db.tenantSubscription.update).toHaveBeenCalled();
        expect(email.sendSubscriptionCancelled).not.toHaveBeenCalled();
    });

    it('skips email when tenant has no owner', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant: { id: 'tenant-1', name: 'Tenant One', owner: null } }),
        ]);

        await service.performDunning();

        expect(db.tenantSubscription.update).toHaveBeenCalled();
        expect(email.sendSubscriptionCancelled).not.toHaveBeenCalled();
    });

    it('processes multiple overdue subscriptions independently', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant_id: 'tenant-1', tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'u1', email: 'owner1@example.com' } } }),
            makeSubscription({ tenant_id: 'tenant-2', tenant: { id: 'tenant-2', name: 'Tenant Two', owner: { id: 'u2', email: 'owner2@example.com' } } }),
        ]);

        await service.performDunning();

        expect(db.tenantSubscription.update).toHaveBeenCalledTimes(2);
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledTimes(2);
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledWith('owner1@example.com', 'Tenant One', 7);
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledWith('owner2@example.com', 'Tenant Two', 7);
    });

    it('continues processing other tenants when one update fails', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant_id: 'tenant-1', tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'u1', email: 'owner1@example.com' } } }),
            makeSubscription({ tenant_id: 'tenant-2', tenant: { id: 'tenant-2', name: 'Tenant Two', owner: { id: 'u2', email: 'owner2@example.com' } } }),
        ]);
        db.tenantSubscription.update
            .mockRejectedValueOnce(new Error('DB error'))
            .mockResolvedValueOnce({});

        await service.performDunning();

        expect(db.tenantSubscription.update).toHaveBeenCalledTimes(2);
        // Second tenant should still get processed even though first failed
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledTimes(1);
        expect(email.sendSubscriptionCancelled).toHaveBeenCalledWith('owner2@example.com', 'Tenant Two', 7);
    });

    it('respects DUNNING_GRACE_DAYS env variable', async () => {
        process.env.DUNNING_GRACE_DAYS = '14';
        const freshService = new BillingSchedulerService(db, email, audit, jobTracker);

        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await freshService.performDunning();

        expect(email.sendSubscriptionCancelled).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            14,
        );
    });

    it('queries only PAST_DUE subscriptions past the grace period cutoff', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([]);

        await service.performDunning();

        expect(db.tenantSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: 'PAST_DUE',
                current_period_end: expect.objectContaining({ lt: expect.any(Date) }),
            }),
        }));
    });

    it('looks up FREE plan by code', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        expect(db.subscriptionPlan.findUnique).toHaveBeenCalledWith({ where: { code: 'FREE' } });
    });
});
