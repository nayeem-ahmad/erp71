import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

/**
 * Unit coverage for the referral commission ledger.
 *
 * This module moves money to people outside the platform, so the cases below
 * concentrate on the parts where a silent mistake becomes a wrong payout: the
 * PENDING → EARNED → PAID state machine, which commissions a payment actually
 * clears, and the ledger arithmetic the partner-facing balance is read from.
 */
describe('ReferralsService', () => {
    const tx = {
        refereePayment: { create: jest.fn() },
        referralSignup: { updateMany: jest.fn() },
    };

    const db = {
        referee: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        referralSignup: {
            count: jest.fn(),
            aggregate: jest.fn(),
            groupBy: jest.fn(),
            findMany: jest.fn(),
            updateMany: jest.fn(),
        },
        refereePayment: { create: jest.fn(), findMany: jest.fn() },
        user: { findUnique: jest.fn(), create: jest.fn() },
        $transaction: jest.fn(),
    } as any;

    const passwordReset = { requestRefereeInvite: jest.fn() } as any;
    const email = {
        sendRefereeCommissionEarned: jest.fn(),
        sendRefereePaymentRecorded: jest.fn(),
    } as any;

    let service: ReferralsService;

    const signup = (overrides: Record<string, unknown> = {}) => ({
        id: 'commission-1',
        referee_id: 'referee-1',
        tenant_id: 'tenant-1',
        discount_pct: 10,
        commission_pct: 10,
        plan_amount: null,
        commission_amount: null,
        status: 'PENDING',
        signed_up_at: new Date('2026-07-01T00:00:00.000Z'),
        earned_at: null,
        paid_at: null,
        referee_payment_id: null,
        ...overrides,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        passwordReset.requestRefereeInvite.mockResolvedValue(undefined);
        email.sendRefereePaymentRecorded.mockResolvedValue(undefined);
        db.$transaction.mockImplementation(async (cb: any) => cb(tx));
        service = new ReferralsService(db, passwordReset, email);
    });

    // --- Referee creation and login provisioning ---------------------------------

    describe('createReferee', () => {
        const dto = {
            name: 'Rahman Traders',
            email: 'rahman@example.com',
            commission_rate: 10,
            signup_discount: 5,
        };

        const created = {
            id: 'referee-1',
            name: 'Rahman Traders',
            email: 'rahman@example.com',
            referral_code: 'RAHMA1B2C3',
            commission_rate: 10,
            signup_discount: 5,
            user_id: null,
            deleted_at: null,
        };

        it('generates a code from the name and provisions a login invite', async () => {
            db.referee.findFirst.mockResolvedValue(null);
            db.referee.create.mockResolvedValue(created);
            db.referee.findUnique.mockResolvedValue(created);
            db.user.findUnique.mockResolvedValue(null);
            db.user.create.mockResolvedValue({ id: 'user-1', email: 'rahman@example.com' });
            db.referee.update.mockResolvedValue({ ...created, user_id: 'user-1' });

            const result = await service.createReferee(dto, 'admin-1');

            expect(db.referee.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        referral_code: expect.stringMatching(/^RAHM[0-9A-F]{6}$/),
                        created_by: 'admin-1',
                    }),
                }),
            );
            expect(db.user.create).toHaveBeenCalled();
            expect(db.referee.update).toHaveBeenCalledWith({
                where: { id: 'referee-1' },
                data: { user_id: 'user-1' },
            });
            expect(passwordReset.requestRefereeInvite).toHaveBeenCalledWith(
                'rahman@example.com',
                'Rahman Traders',
                'RAHMA1B2C3',
            );
            expect(result.commission_rate).toBe(10);
        });

        it('pads a short name out to a four-character code prefix', async () => {
            db.referee.findFirst.mockResolvedValue(null);
            db.referee.create.mockResolvedValue({ ...created, name: 'Al' });
            db.referee.findUnique.mockResolvedValue({ ...created, name: 'Al' });
            db.user.findUnique.mockResolvedValue(null);
            db.user.create.mockResolvedValue({ id: 'user-1', email: 'rahman@example.com' });
            db.referee.update.mockResolvedValue({ ...created, user_id: 'user-1' });

            await service.createReferee({ ...dto, name: 'Al' }, 'admin-1');

            expect(db.referee.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        referral_code: expect.stringMatching(/^ALXX[0-9A-F]{6}$/),
                    }),
                }),
            );
        });

        it('rejects a duplicate email without creating anything', async () => {
            db.referee.findFirst.mockResolvedValue({ id: 'referee-existing' });

            await expect(service.createReferee(dto, 'admin-1')).rejects.toThrow(ConflictException);
            expect(db.referee.create).not.toHaveBeenCalled();
        });

        it('links an existing user account instead of creating a second one', async () => {
            db.referee.findFirst.mockResolvedValue(null);
            db.referee.create.mockResolvedValue(created);
            db.referee.findUnique.mockResolvedValue(created);
            db.user.findUnique.mockResolvedValue({ id: 'user-existing', email: 'rahman@example.com' });
            db.referee.update.mockResolvedValue({ ...created, user_id: 'user-existing' });

            await service.createReferee(dto, 'admin-1');

            expect(db.user.create).not.toHaveBeenCalled();
            expect(db.referee.update).toHaveBeenCalledWith({
                where: { id: 'referee-1' },
                data: { user_id: 'user-existing' },
            });
        });

        it('refuses to steal a user account already linked to another referee', async () => {
            db.referee.findFirst
                .mockResolvedValueOnce(null)                      // no duplicate email
                .mockResolvedValueOnce({ id: 'referee-other' });  // user already linked elsewhere
            db.referee.create.mockResolvedValue(created);
            db.referee.findUnique.mockResolvedValue(created);
            db.user.findUnique.mockResolvedValue({ id: 'user-existing', email: 'rahman@example.com' });

            await expect(service.createReferee(dto, 'admin-1')).rejects.toThrow(ConflictException);
            expect(passwordReset.requestRefereeInvite).not.toHaveBeenCalled();
        });
    });

    // --- Payouts -----------------------------------------------------------------

    describe('recordPayment', () => {
        beforeEach(() => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                name: 'Rahman Traders',
                email: 'rahman@example.com',
                deleted_at: null,
            });
            tx.refereePayment.create.mockResolvedValue({
                id: 'payment-1',
                referee_id: 'referee-1',
                amount: 500,
                method: 'bKash',
                reference: 'TRX1',
                notes: null,
                paid_at: new Date('2026-07-10T00:00:00.000Z'),
                created_by: 'admin-1',
                created_at: new Date('2026-07-10T00:00:00.000Z'),
            });
        });

        /** Three earned commissions worth 300 + 200 + 150 = 650 in total. */
        const threeEarned = () => [
            signup({ id: 'commission-1', status: 'EARNED', commission_amount: 300 }),
            signup({ id: 'commission-2', status: 'EARNED', commission_amount: 200 }),
            signup({ id: 'commission-3', status: 'EARNED', commission_amount: 150 }),
        ];

        it('marks only the selected earned commissions as paid and links them to the payment', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment(
                'referee-1',
                { amount: 450, commission_ids: ['commission-1', 'commission-3'] },
                'admin-1',
            );

            expect(tx.referralSignup.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['commission-1', 'commission-3'] } },
                data: expect.objectContaining({ status: 'PAID', referee_payment_id: 'payment-1' }),
            });
        });

        it('clears every earned commission when no ids are supplied', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment('referee-1', { amount: 650 }, 'admin-1');

            expect(tx.referralSignup.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['commission-1', 'commission-2', 'commission-3'] } },
                data: expect.objectContaining({ status: 'PAID' }),
            });
        });

        // --- Reconciliation ------------------------------------------------------

        it('defaults the amount to exactly what the selected commissions are worth', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment(
                'referee-1',
                { commission_ids: ['commission-1', 'commission-2'] },
                'admin-1',
            );

            expect(tx.refereePayment.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ amount: 500 }) }),
            );
        });

        it('defaults to the full outstanding balance when nothing is selected', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment('referee-1', {}, 'admin-1');

            expect(tx.refereePayment.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ amount: 650 }) }),
            );
        });

        it('refuses an underpayment that would silently clear the full commission', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await expect(
                service.recordPayment('referee-1', { amount: 1 }, 'admin-1'),
            ).rejects.toThrow(/does not match the 650 owed/);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('refuses an overpayment just as firmly', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await expect(
                service.recordPayment('referee-1', { amount: 5000 }, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('allows a deliberate part-payment when it says so', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment('referee-1', { amount: 100, allow_partial: true }, 'admin-1');

            expect(tx.refereePayment.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ amount: 100 }) }),
            );
        });

        it('tolerates float drift across many commissions rather than failing on a rounding cent', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 0.1 }),
                signup({ id: 'commission-2', status: 'EARNED', commission_amount: 0.2 }),
            ]);

            await service.recordPayment('referee-1', { amount: 0.3 }, 'admin-1');

            expect(tx.refereePayment.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ amount: 0.3 }) }),
            );
        });

        it('names a commission id that is not awaiting payment instead of ignoring it', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await expect(
                service.recordPayment(
                    'referee-1',
                    { commission_ids: ['commission-1', 'commission-already-paid'] },
                    'admin-1',
                ),
            ).rejects.toThrow(/commission-already-paid/);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        // --- Notification --------------------------------------------------------

        it('tells the partner a payment was recorded', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment(
                'referee-1',
                { amount: 650, method: 'bKash', reference: 'TRX1' },
                'admin-1',
            );

            expect(email.sendRefereePaymentRecorded).toHaveBeenCalledWith(
                'rahman@example.com',
                'Rahman Traders',
                650,
                'bKash',
                'TRX1',
            );
        });

        it('notifies with the amount actually recorded, not the one requested', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());

            await service.recordPayment('referee-1', { commission_ids: ['commission-1'] }, 'admin-1');

            expect(email.sendRefereePaymentRecorded).toHaveBeenCalledWith(
                'rahman@example.com',
                'Rahman Traders',
                300,
                undefined,
                undefined,
            );
        });

        it('still records the payout when the notification fails', async () => {
            db.referralSignup.findMany.mockResolvedValue(threeEarned());
            email.sendRefereePaymentRecorded.mockRejectedValue(new Error('smtp down'));
            const logWarn = jest
                .spyOn((service as any).logger, 'warn')
                .mockImplementation(() => undefined);

            await expect(
                service.recordPayment('referee-1', { amount: 650 }, 'admin-1'),
            ).resolves.toEqual(expect.objectContaining({ id: 'payment-1' }));
            await new Promise(process.nextTick);

            expect(tx.referralSignup.updateMany).toHaveBeenCalled();
            expect(logWarn).toHaveBeenCalledWith(
                expect.stringContaining('notification email failed'),
            );
        });

        // --- Guards --------------------------------------------------------------

        it('rejects a payout when nothing has been earned', async () => {
            db.referralSignup.findMany.mockResolvedValue([]);

            await expect(
                service.recordPayment('referee-1', { amount: 500 }, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects a payout to an archived referee', async () => {
            db.referee.findUnique.mockResolvedValue({ id: 'referee-1', deleted_at: new Date() });

            await expect(
                service.recordPayment('referee-1', { amount: 500 }, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
        });

        it('404s for an unknown referee', async () => {
            db.referee.findUnique.mockResolvedValue(null);

            await expect(
                service.recordPayment('referee-nope', { amount: 500 }, 'admin-1'),
            ).rejects.toThrow(NotFoundException);
        });
    });

    // --- Ledger arithmetic -------------------------------------------------------

    describe('getLedger', () => {
        beforeEach(() => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                name: 'Rahman Traders',
                email: 'rahman@example.com',
                referral_code: 'RAHMA1B2C3',
                deleted_at: null,
            });
        });

        it('counts EARNED and PAID toward total earned, and nets payments off the balance', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'PENDING' }),
                signup({ id: 'commission-2', status: 'EARNED', commission_amount: 300 }),
                signup({ id: 'commission-3', status: 'PAID', commission_amount: 200 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([
                { id: 'payment-1', amount: 200, paid_at: new Date('2026-07-05T00:00:00.000Z') },
            ]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary).toEqual(
                expect.objectContaining({
                    total_referrals: 3,
                    pending: 1,
                    earned: 1,
                    paid: 1,
                    total_earned_amount: 500,
                    total_paid_amount: 200,
                    balance_due: 300,
                }),
            );
        });

        it('leaves a PENDING referral out of the earned total entirely', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'PENDING', commission_amount: 999 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.total_earned_amount).toBe(0);
            expect(ledger.summary.balance_due).toBe(0);
        });

        // recordPayment now refuses to create this state, but rows written before that
        // still exist. balance_due stays clamped so the partner-facing figure is never
        // negative, and overpaid_amount carries the difference so it is visible rather
        // than absorbed.
        it('surfaces an overpayment instead of absorbing it into a zero balance', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 100 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([{ id: 'payment-1', amount: 500 }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.total_earned_amount).toBe(100);
            expect(ledger.summary.total_paid_amount).toBe(500);
            expect(ledger.summary.balance_due).toBe(0);
            expect(ledger.summary.overpaid_amount).toBe(400);
        });

        it('reports no overpayment on a healthy ledger', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 300 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([{ id: 'payment-1', amount: 100 }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.balance_due).toBe(200);
            expect(ledger.summary.overpaid_amount).toBe(0);
        });

        it('drops a reversed commission out of the earned total and reports it separately', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 300 }),
                signup({ id: 'commission-2', status: 'REVERSED', commission_amount: 200 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.total_earned_amount).toBe(300);
            expect(ledger.summary.total_reversed_amount).toBe(200);
            expect(ledger.summary.reversed).toBe(1);
            expect(ledger.summary.balance_due).toBe(300);
        });

        // The money already left the platform, so it cannot be un-sent. Dropping the
        // commission out of `earned` while the payment still counts turns it into an
        // overpayment, which is exactly the credit that nets off the next payout.
        it('nets a commission reversed after payout against what is owed next', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 300 }),
                signup({
                    id: 'commission-2',
                    status: 'REVERSED',
                    commission_amount: 200,
                    reversed_after_paid: true,
                }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([{ id: 'payment-1', amount: 200 }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.total_earned_amount).toBe(300);
            expect(ledger.summary.total_paid_amount).toBe(200);
            expect(ledger.summary.balance_due).toBe(100);
            expect(ledger.summary.overpaid_amount).toBe(0);
        });

        it('does not let float drift leak into the ledger totals', async () => {
            db.referralSignup.findMany.mockResolvedValue([
                signup({ id: 'commission-1', status: 'EARNED', commission_amount: 0.1 }),
                signup({ id: 'commission-2', status: 'EARNED', commission_amount: 0.2 }),
            ]);
            db.refereePayment.findMany.mockResolvedValue([]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.total_earned_amount).toBe(0.3);
            expect(ledger.summary.balance_due).toBe(0.3);
        });
    });

    // --- Portal identity resolution ---------------------------------------------

    describe('resolveActiveRefereeForUser', () => {
        const profile = {
            id: 'referee-1',
            name: 'Rahman Traders',
            email: 'rahman@example.com',
            referral_code: 'RAHMA1B2C3',
            signup_discount: 5,
            commission_rate: 10,
            is_active: true,
            user_id: 'user-1',
        };

        it('resolves by user_id without touching the row', async () => {
            db.referee.findFirst.mockResolvedValueOnce(profile);

            const result = await service.resolveActiveRefereeForUser('user-1', 'rahman@example.com');

            expect(result).toEqual(profile);
            expect(db.referee.update).not.toHaveBeenCalled();
        });

        it('falls back to email and back-fills the missing user link', async () => {
            db.referee.findFirst
                .mockResolvedValueOnce(null)                          // no user_id match
                .mockResolvedValueOnce({ ...profile, user_id: null }) // email match, unlinked
                .mockResolvedValueOnce(null);                         // user not linked elsewhere
            db.referee.update.mockResolvedValue({ ...profile, user_id: 'user-1' });

            const result = await service.resolveActiveRefereeForUser('user-1', 'rahman@example.com');

            expect(db.referee.update).toHaveBeenCalledWith({
                where: { id: 'referee-1' },
                data: { user_id: 'user-1' },
            });
            expect(result?.user_id).toBe('user-1');
        });

        it('refuses an email match that belongs to a different user account', async () => {
            db.referee.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ ...profile, user_id: 'user-someone-else' });

            const result = await service.resolveActiveRefereeForUser('user-1', 'rahman@example.com');

            expect(result).toBeNull();
            expect(db.referee.update).not.toHaveBeenCalled();
        });

        it('refuses to link when this user already owns another referee profile', async () => {
            db.referee.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ ...profile, user_id: null })
                .mockResolvedValueOnce({ id: 'referee-other' });

            const result = await service.resolveActiveRefereeForUser('user-1', 'rahman@example.com');

            expect(result).toBeNull();
            expect(db.referee.update).not.toHaveBeenCalled();
        });

        it('returns null when no active referee matches at all', async () => {
            db.referee.findFirst.mockResolvedValue(null);

            await expect(
                service.resolveActiveRefereeForUser('user-1', 'nobody@example.com'),
            ).resolves.toBeNull();
        });
    });

    // --- Archival ----------------------------------------------------------------

    describe('deleteReferee', () => {
        it('archives a referee that has ledger history and releases the login link', async () => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                deleted_at: null,
                _count: { referralSignups: 2, payments: 1 },
            });
            db.referee.update.mockResolvedValue({});

            const result = await service.deleteReferee('referee-1');

            expect(db.referee.update).toHaveBeenCalledWith({
                where: { id: 'referee-1' },
                data: expect.objectContaining({ is_active: false, user_id: null, deleted_at: expect.any(Date) }),
            });
            expect(db.referee.delete).not.toHaveBeenCalled();
            expect(result).toEqual({ id: 'referee-1', deleted: true, archived: true });
        });

        it('hard-deletes a referee with no signups or payments', async () => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                deleted_at: null,
                _count: { referralSignups: 0, payments: 0 },
            });
            db.referee.delete.mockResolvedValue({});

            const result = await service.deleteReferee('referee-1');

            expect(db.referee.delete).toHaveBeenCalledWith({ where: { id: 'referee-1' } });
            expect(result).toEqual({ id: 'referee-1', deleted: true, archived: false });
        });

        it('refuses to archive twice', async () => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                deleted_at: new Date(),
                _count: { referralSignups: 1, payments: 0 },
            });

            await expect(service.deleteReferee('referee-1')).rejects.toThrow(BadRequestException);
        });
    });

    // --- Updates -----------------------------------------------------------------

    describe('updateReferee', () => {
        it('normalises a hand-entered referral code to upper case', async () => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                email: 'rahman@example.com',
                referral_code: 'RAHMA1B2C3',
                deleted_at: null,
            });
            db.referee.findFirst.mockResolvedValue(null);
            db.referee.update.mockResolvedValue({ commission_rate: 10, signup_discount: 5 });

            await service.updateReferee('referee-1', { referral_code: ' spring26 ' });

            expect(db.referee.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ referral_code: 'SPRING26' }) }),
            );
        });

        it('rejects a referral code already in use', async () => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                email: 'rahman@example.com',
                referral_code: 'RAHMA1B2C3',
                deleted_at: null,
            });
            db.referee.findFirst.mockResolvedValue({ id: 'referee-other' });

            await expect(
                service.updateReferee('referee-1', { referral_code: 'SPRING26' }),
            ).rejects.toThrow(ConflictException);
        });

        it('refuses to edit an archived referee', async () => {
            db.referee.findUnique.mockResolvedValue({ id: 'referee-1', deleted_at: new Date() });

            await expect(service.updateReferee('referee-1', { name: 'New' })).rejects.toThrow(
                BadRequestException,
            );
        });
    });

    // --- Commission listing ------------------------------------------------------

    describe('listCommissions', () => {
        beforeEach(() => {
            db.referralSignup.findMany.mockResolvedValue([]);
            db.referralSignup.count.mockResolvedValue(0);
        });

        it('passes both filters through to the query', async () => {
            await service.listCommissions({ referee_id: 'referee-1', status: 'EARNED' as any });

            expect(db.referralSignup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { referee_id: 'referee-1', status: 'EARNED' } }),
            );
        });

        it('omits absent filters rather than sending undefined keys', async () => {
            await service.listCommissions({});

            expect(db.referralSignup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: {} }),
            );
        });

        it('pages by default rather than returning the whole table', async () => {
            await service.listCommissions({});

            expect(db.referralSignup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 0, take: 50 }),
            );
        });

        it('honours an explicit page window', async () => {
            await service.listCommissions({ limit: 10, offset: 20 });

            expect(db.referralSignup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 20, take: 10 }),
            );
        });

        it('reports how much was left behind instead of truncating silently', async () => {
            db.referralSignup.findMany.mockResolvedValue([signup({ id: 'commission-1' })]);
            db.referralSignup.count.mockResolvedValue(120);

            const page = await service.listCommissions({ limit: 1, offset: 0 });

            expect(page).toEqual(
                expect.objectContaining({ total: 120, limit: 1, offset: 0, has_more: true }),
            );
            expect(page.items).toHaveLength(1);
        });

        it('reports has_more false on the last page', async () => {
            db.referralSignup.findMany.mockResolvedValue([signup({ id: 'commission-1' })]);
            db.referralSignup.count.mockResolvedValue(21);

            const page = await service.listCommissions({ limit: 20, offset: 20 });

            expect(page.has_more).toBe(false);
        });
    });

    // --- Referee listing ---------------------------------------------------------

    describe('listReferees', () => {
        const referee = (overrides: Record<string, unknown> = {}) => ({
            id: 'referee-1',
            name: 'Rahman Traders',
            email: 'rahman@example.com',
            commission_rate: 10,
            signup_discount: 5,
            deleted_at: null,
            _count: { referralSignups: 3 },
            ...overrides,
        });

        it('hides archived referees by default', async () => {
            db.referee.findMany.mockResolvedValue([]);

            await service.listReferees();

            expect(db.referee.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { deleted_at: null } }),
            );
        });

        it('includes archived referees on request', async () => {
            db.referee.findMany.mockResolvedValue([]);

            await service.listReferees({ include_archived: true });

            expect(db.referee.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: {} }),
            );
        });

        it('builds every referee stat from a single grouped query', async () => {
            db.referee.findMany.mockResolvedValue([referee(), referee({ id: 'referee-2' })]);
            db.referralSignup.groupBy.mockResolvedValue([
                { referee_id: 'referee-1', status: 'PENDING', _count: { _all: 2 }, _sum: { commission_amount: null } },
                { referee_id: 'referee-1', status: 'EARNED', _count: { _all: 1 }, _sum: { commission_amount: 300 } },
                { referee_id: 'referee-2', status: 'PAID', _count: { _all: 4 }, _sum: { commission_amount: 800 } },
            ]);

            const result = await service.listReferees();

            expect(db.referralSignup.groupBy).toHaveBeenCalledTimes(1);
            expect(db.referralSignup.aggregate).not.toHaveBeenCalled();
            expect(db.referralSignup.count).not.toHaveBeenCalled();
            expect(result[0].stats).toEqual(
                expect.objectContaining({ pending_signups: 2, earned_count: 1, earned_amount: 300 }),
            );
            expect(result[1].stats).toEqual(
                expect.objectContaining({ paid_count: 4, paid_amount: 800 }),
            );
        });

        it('reports zeroes for a referee with no signups at all', async () => {
            db.referee.findMany.mockResolvedValue([referee({ _count: { referralSignups: 0 } })]);
            db.referralSignup.groupBy.mockResolvedValue([]);

            const result = await service.listReferees();

            expect(result[0].stats).toEqual({
                pending_signups: 0,
                earned_count: 0,
                earned_amount: 0,
                paid_count: 0,
                paid_amount: 0,
                reversed_count: 0,
                reversed_amount: 0,
            });
        });

        it('does not query for stats when there are no referees', async () => {
            db.referee.findMany.mockResolvedValue([]);

            await expect(service.listReferees()).resolves.toEqual([]);
            expect(db.referralSignup.groupBy).not.toHaveBeenCalled();
        });
    });
});
