import { BillingSchedulerService } from './billing-scheduler.service';

describe('BillingSchedulerService', () => {
    const db = {
        tenantSubscription: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        tenantAddonSubscription: { findMany: jest.fn(), update: jest.fn() },
        subscriptionPlan: { findUnique: jest.fn() },
        tenant: { update: jest.fn(), updateMany: jest.fn() },
        billingEvent: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
    } as any;

    const email = {
        sendSubscriptionCancelled: jest.fn().mockResolvedValue(undefined),
        sendPaymentRetryReminder: jest.fn().mockResolvedValue(undefined),
        sendSubscriptionGoodStanding: jest.fn().mockResolvedValue(undefined),
        sendSubscriptionFeePosted: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceSuspended: jest.fn().mockResolvedValue(undefined),
    } as any;

    const audit = {
        log: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Passthrough tracker: invokes the wrapped job body so tests exercise it.
    const jobTracker = {
        track: jest.fn((_name: string, fn: () => any) => fn()),
    } as any;

    const notifications = {
        create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    } as any;

    let service: BillingSchedulerService;

    const freePlan = { id: 'plan-free', code: 'FREE', name: 'Free', monthly_price: 0, yearly_price: 0 };

    const makeSubscription = (overrides?: Partial<{
        tenant_id: string;
        status: string;
        billing_cycle: string;
        current_period_end: Date;
        past_due_since: Date | null;
        last_reminder_at: Date | null;
        plan: object;
        tenant: object;
    }>) => ({
        tenant_id: 'tenant-1',
        status: 'PAST_DUE',
        billing_cycle: 'MONTHLY',
        current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        // Overdue long enough to be past the 30-day suspension window by default,
        // which is what the dunning tests below exercise.
        past_due_since: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        last_reminder_at: null,
        plan: { id: 'plan-premium', code: 'PREMIUM', monthly_price: 3999, yearly_price: 39990 },
        tenant: {
            id: 'tenant-1',
            name: 'Tenant One',
            owner: { id: 'user-1', email: 'owner@example.com' },
        },
        ...overrides,
    });

    /** Seeds the ledger so `outstandingBalance` reports `amount` owed (or 0 when settled). */
    const seedOutstanding = (amount: number) => {
        db.billingEvent.findMany.mockResolvedValue(
            amount > 0 ? [{ event_type: 'subscription_fee', amount }] : [],
        );
    };

    beforeEach(() => {
        jest.resetAllMocks();
        audit.log.mockResolvedValue(undefined);
        jobTracker.track.mockImplementation((_name: string, fn: () => any) => fn());
        service = new BillingSchedulerService(db, email, audit, jobTracker, notifications);
        delete process.env.DUNNING_GRACE_DAYS;
        delete process.env.SUBSCRIPTION_GOOD_STANDING_DAYS;

        email.sendPaymentRetryReminder.mockResolvedValue(undefined);
        email.sendSubscriptionGoodStanding.mockResolvedValue(undefined);
        // The reminder cycle queries subscriptions twice: PAST_DUE candidates, then
        // settled ones. Tests seed the first pass with mockResolvedValueOnce.
        db.tenantSubscription.findMany.mockResolvedValue([]);
        db.subscriptionPlan.findUnique.mockResolvedValue(freePlan);
        db.tenantSubscription.update.mockResolvedValue({});
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);
        db.tenantAddonSubscription.update.mockResolvedValue({});
        db.billingEvent.findFirst.mockResolvedValue(null);
        db.billingEvent.findUnique.mockResolvedValue(null);
        db.billingEvent.create.mockResolvedValue({ id: 'retry-event-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({ status: 'PAST_DUE', past_due_since: null });
        db.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });
        db.tenant.update.mockResolvedValue({});
        db.tenant.updateMany.mockResolvedValue({ count: 1 });
        delete process.env.BILLING_SUSPENSION_DAYS;
        delete process.env.DUNNING_REMINDER_INTERVAL_DAYS;
        // Default: the tenant owes a cycle, which is what most reminder and
        // dunning cases assume.
        seedOutstanding(3999);
    });

    it('sends a payment reminder naming the outstanding balance and the days left to settle', async () => {
        db.tenantSubscription.findMany.mockResolvedValueOnce([
            makeSubscription({
                current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                past_due_since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            }),
        ]);

        await service.retryFailedPayments();

        expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ event_type: 'PAYMENT_RETRY_REMINDER' }),
        }));
        // 2 days overdue against the 30-day window leaves 28 to settle.
        expect(email.sendPaymentRetryReminder).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
            28,
        );
        expect(notifications.create).toHaveBeenCalledWith(
            'tenant-1',
            'user-1',
            'PAYMENT_RETRY_REMINDER',
            'Payment overdue',
            expect.stringContaining('Tenant One'),
            '/billing',
        );
    });

    it('keeps reminding past the grace window, where the old cutoff went silent', async () => {
        // 20 days overdue: outside DUNNING_GRACE_DAYS (7), inside the 30-day
        // suspension window. The previous query bounded candidates to the grace
        // cutoff, so this tenant heard nothing at all.
        db.tenantSubscription.findMany.mockResolvedValueOnce([
            makeSubscription({
                past_due_since: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
                last_reminder_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            }),
        ]);

        await service.retryFailedPayments();

        expect(email.sendPaymentRetryReminder).toHaveBeenCalledWith(
            'owner@example.com', 'Tenant One', 3999, 'BDT', 10,
        );
    });

    it('throttles to the reminder interval once past the grace window', async () => {
        // Reminded yesterday, 20 days overdue: outside the daily grace cadence,
        // inside the 3-day interval, so this run stays quiet.
        db.tenantSubscription.findMany.mockResolvedValueOnce([
            makeSubscription({
                past_due_since: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
                last_reminder_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            }),
        ]);

        await service.retryFailedPayments();

        expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
    });

    it('does not bound reminder candidates by the period end', async () => {
        db.tenantSubscription.findMany.mockResolvedValueOnce([]);

        await service.retryFailedPayments();

        expect(db.tenantSubscription.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: { status: 'PAST_DUE', tenant: { deleted_at: null } },
        }));
    });

    it('skips payment reminders when one was sent in the last 24 hours', async () => {
        // Inside the grace window the cadence is daily, so a reminder sent a few
        // hours ago suppresses this run.
        db.tenantSubscription.findMany.mockResolvedValueOnce([
            makeSubscription({
                past_due_since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                last_reminder_at: new Date(Date.now() - 60 * 60 * 1000),
            }),
        ]);

        await service.retryFailedPayments();

        expect(db.billingEvent.create).not.toHaveBeenCalled();
        expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
    });

    describe('good-standing note', () => {
        const settled = (overrides?: Record<string, unknown>) => makeSubscription({
            status: 'ACTIVE',
            current_period_end: new Date('2026-10-01T00:00:00Z'),
            plan: { id: 'plan-premium', code: 'PREMIUM', name: 'Premium', monthly_price: 3999 },
            ...overrides,
        });

        it('sends a positive note — no amount, no payment knock — to a settled tenant', async () => {
            db.tenantSubscription.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([settled()]);

            await service.retryFailedPayments();

            expect(db.billingEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    event_type: 'SUBSCRIPTION_GOOD_STANDING',
                    status: 'SENT',
                    amount: null,
                }),
            });
            expect(email.sendSubscriptionGoodStanding).toHaveBeenCalledWith(
                'owner@example.com',
                'Tenant One',
                'Premium',
                new Date('2026-10-01T00:00:00Z'),
            );
            expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'user-1',
                'SUBSCRIPTION_GOOD_STANDING',
                'Your subscription is all set',
                expect.stringContaining('Premium'),
                '/billing',
            );
        });

        it('queries only settled, non-cancelling subscriptions on a paid plan', async () => {
            db.tenantSubscription.findMany.mockResolvedValue([]);

            await service.retryFailedPayments();

            expect(db.tenantSubscription.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
                where: expect.objectContaining({
                    status: { in: ['ACTIVE', 'TRIALING'] },
                    cancel_at_period_end: false,
                    plan: { monthly_price: { gt: 0 } },
                }),
            }));
        });

        it('sends at most one note per interval', async () => {
            db.tenantSubscription.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([settled()]);
            db.billingEvent.findFirst.mockResolvedValue({ id: 'recent-note' });

            await service.retryFailedPayments();

            expect(db.billingEvent.create).not.toHaveBeenCalled();
            expect(email.sendSubscriptionGoodStanding).not.toHaveBeenCalled();
        });

        it('is switched off by SUBSCRIPTION_GOOD_STANDING_DAYS=0', async () => {
            process.env.SUBSCRIPTION_GOOD_STANDING_DAYS = '0';
            db.tenantSubscription.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([settled()]);

            await service.retryFailedPayments();

            expect(db.tenantSubscription.findMany).toHaveBeenCalledTimes(1);
            expect(email.sendSubscriptionGoodStanding).not.toHaveBeenCalled();
        });

        it('greets a PAST_DUE tenant whose ledger shows nothing owed instead of chasing payment', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                makeSubscription({
                    current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                    plan: { id: 'plan-premium', code: 'PREMIUM', name: 'Premium', monthly_price: 3999 },
                    discount_type: 'PERCENTAGE',
                    discount_value: 100,
                } as any),
            ]);
            // A fully discounted plan posts no fee, so the ledger is square.
            seedOutstanding(0);

            await service.retryFailedPayments();

            expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
            expect(email.sendSubscriptionGoodStanding).toHaveBeenCalledWith(
                'owner@example.com',
                'Tenant One',
                'Premium',
                expect.any(Date),
            );
        });

        it('leaves free-plan tenants out of the cycle entirely', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                makeSubscription({
                    current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                    plan: { id: 'plan-free', code: 'FREE', name: 'Free', monthly_price: 0 },
                }),
            ]);
            seedOutstanding(0);

            await service.retryFailedPayments();

            expect(db.billingEvent.create).not.toHaveBeenCalled();
            expect(email.sendPaymentRetryReminder).not.toHaveBeenCalled();
            expect(email.sendSubscriptionGoodStanding).not.toHaveBeenCalled();
        });

        it('reminds for the outstanding ledger balance, not one cycle of list price', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                makeSubscription({
                    current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                    past_due_since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                    discount_type: 'PERCENTAGE',
                    discount_value: 25,
                } as any),
            ]);
            // What was actually posted and left unpaid: a discounted cycle.
            seedOutstanding(2999.25);

            await service.retryFailedPayments();

            expect(email.sendPaymentRetryReminder).toHaveBeenCalledWith(
                'owner@example.com',
                'Tenant One',
                2999.25,
                'BDT',
                28,
            );
        });

        it('names the full arrears when several cycles have gone unpaid', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                makeSubscription({
                    past_due_since: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
                }),
            ]);
            // Three unpaid months, not one — understating this was how the old
            // plan-price reminder misreported a long-overdue account.
            db.billingEvent.findMany.mockResolvedValue([
                { event_type: 'subscription_fee', amount: 3999 },
                { event_type: 'subscription_fee', amount: 3999 },
                { event_type: 'subscription_fee', amount: 3999 },
            ]);

            await service.retryFailedPayments();

            expect(email.sendPaymentRetryReminder).toHaveBeenCalledWith(
                'owner@example.com', 'Tenant One', 11997, 'BDT', 10,
            );
        });
    });

    it('suspends a workspace overdue beyond the suspension window', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: {
                billing_suspended_at: expect.any(Date),
                billing_suspension_reason: expect.stringContaining('3999.00'),
            },
        });
        expect(email.sendWorkspaceSuspended).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
            30,
        );
        expect(notifications.create).toHaveBeenCalledWith(
            'tenant-1',
            'user-1',
            'TENANT_SUSPENDED',
            'Workspace suspended',
            expect.stringContaining('Tenant One'),
            '/billing',
        );
    });

    it('leaves the plan in place when suspending, rather than downgrading to FREE', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        // The old behaviour swapped plan_id to the FREE plan, silently stripping
        // entitlements. Suspension is recoverable, so the plan must survive it.
        expect(db.tenantSubscription.update).not.toHaveBeenCalled();
        expect(db.subscriptionPlan.findUnique).not.toHaveBeenCalled();
    });

    it('logs an audit event for each suspended tenant', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await service.performDunning();

        expect(audit.log).toHaveBeenCalledWith(
            'TENANT_SUSPENDED_NONPAYMENT',
            'Tenant',
            { tenantId: 'tenant-1' },
            'tenant-1',
            expect.objectContaining({ plan: 'PREMIUM', outstanding: 3999, suspensionDays: 30 }),
        );
    });

    it('does not suspend a tenant whose ledger has been settled since the status was set', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);
        seedOutstanding(0);

        await service.performDunning();

        expect(db.tenant.update).not.toHaveBeenCalled();
        expect(email.sendWorkspaceSuspended).not.toHaveBeenCalled();
        // ...and the stale PAST_DUE state is cleaned up instead.
        expect(db.tenantSubscription.updateMany).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1', status: 'PAST_DUE' },
            data: { status: 'ACTIVE', past_due_since: null, last_reminder_at: null },
        });
    });

    it('does nothing when no subscriptions are overdue', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([]);

        await service.performDunning();

        expect(db.tenant.update).not.toHaveBeenCalled();
        expect(email.sendWorkspaceSuspended).not.toHaveBeenCalled();
    });

    it('skips email when tenant owner has no email address', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'user-1', email: null } } }),
        ]);

        await service.performDunning();

        expect(db.tenant.update).toHaveBeenCalled();
        expect(email.sendWorkspaceSuspended).not.toHaveBeenCalled();
    });

    it('skips email when tenant has no owner', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant: { id: 'tenant-1', name: 'Tenant One', owner: null } }),
        ]);

        await service.performDunning();

        expect(db.tenant.update).toHaveBeenCalled();
        expect(email.sendWorkspaceSuspended).not.toHaveBeenCalled();
    });

    it('processes multiple overdue subscriptions independently', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant_id: 'tenant-1', tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'u1', email: 'owner1@example.com' } } }),
            makeSubscription({ tenant_id: 'tenant-2', tenant: { id: 'tenant-2', name: 'Tenant Two', owner: { id: 'u2', email: 'owner2@example.com' } } }),
        ]);

        await service.performDunning();

        expect(db.tenant.update).toHaveBeenCalledTimes(2);
        expect(email.sendWorkspaceSuspended).toHaveBeenCalledTimes(2);
    });

    it('continues processing other tenants when one suspension fails', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            makeSubscription({ tenant_id: 'tenant-1', tenant: { id: 'tenant-1', name: 'Tenant One', owner: { id: 'u1', email: 'owner1@example.com' } } }),
            makeSubscription({ tenant_id: 'tenant-2', tenant: { id: 'tenant-2', name: 'Tenant Two', owner: { id: 'u2', email: 'owner2@example.com' } } }),
        ]);
        db.tenant.update
            .mockRejectedValueOnce(new Error('DB error'))
            .mockResolvedValueOnce({});

        await service.performDunning();

        expect(db.tenant.update).toHaveBeenCalledTimes(2);
        expect(email.sendWorkspaceSuspended).toHaveBeenCalledTimes(1);
        expect(email.sendWorkspaceSuspended).toHaveBeenCalledWith(
            'owner2@example.com', 'Tenant Two', 3999, 'BDT', 30,
        );
    });

    it('respects BILLING_SUSPENSION_DAYS env variable', async () => {
        process.env.BILLING_SUSPENSION_DAYS = '14';
        const freshService = new BillingSchedulerService(db, email, audit, jobTracker, notifications);

        db.tenantSubscription.findMany.mockResolvedValue([makeSubscription()]);

        await freshService.performDunning();

        expect(email.sendWorkspaceSuspended).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
            14,
        );
    });

    it('selects only PAST_DUE subscriptions whose dunning clock predates the suspension cutoff', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([]);

        await service.performDunning();

        expect(db.tenantSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: 'PAST_DUE',
                // Measured from when the tenant fell behind, not from the period
                // end, which now moves forward with every renewal.
                past_due_since: { not: null, lt: expect.any(Date) },
                tenant: { deleted_at: null, billing_suspended_at: null },
            }),
        }));
    });

    describe('add-on lifecycle', () => {
        const makeAddonSubscription = (overrides?: Partial<{
            tenant_id: string;
            addon_id: string;
            status: string;
            current_period_end: Date;
            cancel_at_period_end: boolean;
            addon: object;
            tenant: object;
        }>) => ({
            tenant_id: 'tenant-1',
            addon_id: 'addon-1',
            status: 'PAST_DUE',
            current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            cancel_at_period_end: false,
            addon: { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500 },
            tenant: {
                id: 'tenant-1',
                name: 'Tenant One',
                owner: { id: 'user-1', email: 'owner@example.com' },
            },
            ...overrides,
        });

        beforeEach(() => {
            db.tenantSubscription.findMany.mockResolvedValue([]);
        });

        it('sends a retry reminder for a PAST_DUE add-on subscription within the grace window', async () => {
            db.tenantAddonSubscription.findMany.mockResolvedValueOnce([
                makeAddonSubscription({ current_period_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }),
            ]);

            await service.retryFailedPayments();

            expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'ADDON_PAYMENT_RETRY_REMINDER', reference_id: 'addon-1' }),
            }));
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'user-1',
                'ADDON_PAYMENT_RETRY_REMINDER',
                'Add-on payment retry reminder',
                expect.stringContaining('Manufacturing'),
                '/billing',
            );
        });

        it('cancels an overdue PAST_DUE add-on subscription without touching the base plan', async () => {
            db.tenantAddonSubscription.findMany.mockResolvedValueOnce([makeAddonSubscription()]);

            await service.performDunning();

            expect(db.tenantAddonSubscription.update).toHaveBeenCalledWith({
                where: { tenant_id_addon_id: { tenant_id: 'tenant-1', addon_id: 'addon-1' } },
                data: { status: 'CANCELLED', cancel_at_period_end: false },
            });
            expect(db.tenantSubscription.update).not.toHaveBeenCalled();
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'user-1',
                'ADDON_SUBSCRIPTION_CANCELLED',
                'Add-on subscription cancelled',
                expect.stringContaining('Manufacturing'),
                '/billing',
            );
        });

        it('posts a fee for a due add-on subscription and does not duplicate on replay', async () => {
            db.tenantAddonSubscription.findMany.mockResolvedValueOnce([
                makeAddonSubscription({ status: 'ACTIVE', current_period_end: new Date(Date.now() - 60_000) }),
            ]);

            await service.postSubscriptionPeriodFees();

            expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'addon_fee', amount: 500, reference_id: 'addon-1' }),
            }));
        });
    });
    describe('recurring subscription fees', () => {
        const due = (overrides?: Record<string, unknown>) => makeSubscription({
            status: 'ACTIVE',
            current_period_end: new Date('2026-08-10T00:00:00Z'),
            past_due_since: null,
            plan: { id: 'plan-p', code: 'PREMIUM', name: 'Premium', monthly_price: 750, yearly_price: 7500 },
            ...overrides,
        } as any);

        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date('2026-09-07T10:00:00Z'));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('advances the period after posting, so the next run is not suppressed by its own key', async () => {
            // The whole bug in one assertion: nothing used to write
            // current_period_end, so the fee key never changed and every later
            // run hit the dedup and skipped.
            db.tenantSubscription.findMany.mockResolvedValueOnce([due()]);

            await service.postSubscriptionPeriodFees();

            // The Aug 10 period had run out, so it is charged and the subscription
            // moves onto the Aug 10 - Sep 10 period, which is still running.
            expect(db.tenantSubscription.update).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1' },
                data: {
                    current_period_start: new Date('2026-08-10T00:00:00Z'),
                    current_period_end: new Date('2026-09-10T00:00:00Z'),
                },
            });
        });

        it('posts one fee per elapsed cycle for a subscription frozen for months', async () => {
            // BUETEN's shape: created in March at 750/-, period never advanced.
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                due({ current_period_end: new Date('2026-03-10T00:00:00Z') }),
            ]);

            await service.postSubscriptionPeriodFees();

            const feeCalls = db.billingEvent.create.mock.calls.filter(
                ([arg]: any[]) => arg.data.event_type === 'subscription_fee',
            );
            expect(feeCalls).toHaveLength(6);
            expect(feeCalls.every(([arg]: any[]) => arg.data.amount === 750)).toBe(true);
            // Each period gets its own idempotency key.
            expect(feeCalls.map(([arg]: any[]) => arg.data.external_event_id)).toEqual([
                'subscription_fee:tenant-1:2026-03-10',
                'subscription_fee:tenant-1:2026-04-10',
                'subscription_fee:tenant-1:2026-05-10',
                'subscription_fee:tenant-1:2026-06-10',
                'subscription_fee:tenant-1:2026-07-10',
                'subscription_fee:tenant-1:2026-08-10',
            ]);
        });

        it('charges the yearly price and advances a year for a yearly subscription', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                due({ billing_cycle: 'YEARLY', current_period_end: new Date('2026-08-10T00:00:00Z') }),
            ]);

            await service.postSubscriptionPeriodFees();

            expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'subscription_fee', amount: 7500 }),
            }));
            expect(db.tenantSubscription.update).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1' },
                data: {
                    current_period_start: new Date('2026-08-10T00:00:00Z'),
                    current_period_end: new Date('2027-08-10T00:00:00Z'),
                },
            });
        });

        it('applies the admin discount to the posted fee', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                due({ discount_type: 'PERCENTAGE', discount_value: 20 }),
            ]);

            await service.postSubscriptionPeriodFees();

            expect(db.billingEvent.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'subscription_fee', amount: 600 }),
            }));
        });

        it('skips a period already posted but still advances past it', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([due()]);
            db.billingEvent.findUnique.mockResolvedValue({ id: 'already-posted' });

            await service.postSubscriptionPeriodFees();

            expect(db.billingEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'subscription_fee' }),
            }));
            // The advance still happens — otherwise a voided or pre-existing fee
            // would strand the subscription on that period forever.
            expect(db.tenantSubscription.update).toHaveBeenCalled();
        });

        it('renews a zero-price plan without posting a charge', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([
                due({ plan: { id: 'plan-free', code: 'FREE', name: 'Free', monthly_price: 0, yearly_price: 0 } }),
            ]);

            await service.postSubscriptionPeriodFees();

            expect(db.billingEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ event_type: 'subscription_fee' }),
            }));
            expect(db.tenantSubscription.update).toHaveBeenCalled();
        });

        it('starts the dunning clock when the posted fee leaves a balance owing', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([due()]);
            db.tenantSubscription.findUnique.mockResolvedValue({ status: 'ACTIVE', past_due_since: null });
            seedOutstanding(750);

            await service.postSubscriptionPeriodFees();

            expect(db.tenantSubscription.update).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1' },
                data: { status: 'PAST_DUE', past_due_since: expect.any(Date) },
            });
        });

        it('does not restart the dunning clock for a tenant already behind', async () => {
            const original = new Date('2026-07-01T00:00:00Z');
            db.tenantSubscription.findMany.mockResolvedValueOnce([due()]);
            db.tenantSubscription.findUnique.mockResolvedValue({ status: 'PAST_DUE', past_due_since: original });
            seedOutstanding(1500);

            await service.postSubscriptionPeriodFees();

            // Each new unpaid cycle must not buy another 30 days.
            expect(db.tenantSubscription.update).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1' },
                data: { status: 'PAST_DUE', past_due_since: original },
            });
        });

        it('leaves a settled tenant in good standing after a renewal', async () => {
            db.tenantSubscription.findMany.mockResolvedValueOnce([due()]);
            seedOutstanding(0);

            await service.postSubscriptionPeriodFees();

            expect(db.tenantSubscription.update).not.toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'PAST_DUE' }) }),
            );
        });
    });
});
