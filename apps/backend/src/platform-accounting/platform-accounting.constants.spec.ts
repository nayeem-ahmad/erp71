import { PLATFORM_ACCOUNT, PLATFORM_ACCOUNTING_TEMPLATE } from '@erp71/database';
import { ledgerEventDelta } from '../admin-tenants/ledger-balance.util';
import {
    BILLING_EVENT_POSTINGS,
    PROJECTED_BILLING_EVENT_TYPES,
    resolvePlatformCashAccount,
} from './platform-accounting.constants';

/**
 * Event types the platform books count but the tenant billing ledger does not.
 * See the test that pins them, at the bottom of this describe block.
 */
const UNCOUNTED_BY_BILLING = new Set(['addon_fee', 'IPN', 'CALLBACK_SUCCESS']);

const templateAccountNames = new Set(
    PLATFORM_ACCOUNTING_TEMPLATE.flatMap((group) =>
        group.subgroups.flatMap((subgroup) => subgroup.accounts.map((account) => account.name)),
    ),
);

describe('BILLING_EVENT_POSTINGS', () => {
    it('only names accounts the platform chart of accounts actually seeds', () => {
        // The lookup is by name, so a typo here is a posting that fails at run
        // time on live billing data rather than in CI.
        for (const [eventType, posting] of Object.entries(BILLING_EVENT_POSTINGS)) {
            expect({ eventType, account: posting.debit, seeded: templateAccountNames.has(posting.debit) })
                .toEqual({ eventType, account: posting.debit, seeded: true });
            expect({ eventType, account: posting.credit, seeded: templateAccountNames.has(posting.credit) })
                .toEqual({ eventType, account: posting.credit, seeded: true });
        }
    });

    it('never posts an entry to the same account on both sides', () => {
        for (const [eventType, posting] of Object.entries(BILLING_EVENT_POSTINGS)) {
            expect({ eventType, sameAccount: posting.debit === posting.credit })
                .toEqual({ eventType, sameAccount: false });
        }
    });

    /**
     * The contract that makes the two ledgers reconcilable: Subscription
     * Receivable in the platform books is the mirror of the sum of every
     * tenant's billing-ledger balance. A charge makes the tenant owe money
     * (negative there, a debit here); a payment settles it (positive there, a
     * credit here). Get this backwards and the receivable grows when it should
     * shrink — which is exactly the kind of error nobody notices until a year
     * of books has to be restated.
     */
    it('moves the receivable in the opposite direction to the tenant billing ledger', () => {
        const receivable = PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE;

        for (const eventType of PROJECTED_BILLING_EVENT_TYPES) {
            const posting = BILLING_EVENT_POSTINGS[eventType];
            const tenantDelta = ledgerEventDelta(eventType, 100);
            // Zero is tolerated only for the three types billing does not count,
            // pinned in the test below; every other zero means the two ledgers
            // have drifted apart.
            const uncountedByBilling = UNCOUNTED_BY_BILLING.has(eventType);

            if (posting.debit === receivable) {
                // Debit here = the tenant owes more = negative there.
                expect({ eventType, tenantDelta }).toEqual({
                    eventType,
                    tenantDelta: uncountedByBilling ? 0 : -100,
                });
            } else if (posting.credit === receivable) {
                expect({ eventType, tenantDelta }).toEqual({
                    eventType,
                    tenantDelta: uncountedByBilling ? 0 : 100,
                });
            } else {
                // Untouched here must mean untouched there: a credit sale or a
                // gateway refund, neither of which is part of the account
                // current. `ledgerEventDelta` scores an unknown type 0, so this
                // also catches a new event type added to one side only.
                const settled = eventType === 'sms_credit_sale_payment' || eventType === 'ai_credit_sale_payment';
                expect({ eventType, tenantDelta: settled ? 0 : tenantDelta })
                    .toEqual({ eventType, tenantDelta: 0 });
            }
        }
    });

    /**
     * Pre-existing gaps in billing, pinned here rather than worked around.
     *
     * `ledgerEventDelta` has no case for any of these three, so each scores zero
     * and never moves the tenant's balance, dunning clock or suspension — even
     * though the admin ledger lists them all. An uncounted add-on charge makes a
     * tenant look like they owe less than they do; an uncounted card payment
     * makes them look like they owe more, and the fee cron charges every
     * subscription whatever it pays by. The platform books count all three,
     * because all three really happened, which is why the receivable differs
     * from the tenant-ledger total by exactly these amounts.
     *
     * When someone gives `ledgerEventDelta` its missing cases this test fails,
     * which is the point: narrow or delete this set, and the caveat in
     * BILLING_EVENT_POSTINGS with it.
     */
    it('pins the event types the two ledgers disagree about', () => {
        for (const eventType of UNCOUNTED_BY_BILLING) {
            expect({ eventType, delta: ledgerEventDelta(eventType, 100) }).toEqual({ eventType, delta: 0 });
            expect(BILLING_EVENT_POSTINGS[eventType]).toBeDefined();
        }
        expect([...UNCOUNTED_BY_BILLING].sort()).toEqual(['CALLBACK_SUCCESS', 'IPN', 'addon_fee']);
    });

    it('routes a refund out through revenue, not through the receivable', () => {
        // A gateway refund is invisible to the tenant's billing ledger
        // (ledgerEventDelta scores it 0), so touching the receivable would
        // break the mirror above.
        expect(BILLING_EVENT_POSTINGS.REFUND.debit).toBe(PLATFORM_ACCOUNT.REFUNDS);
        expect(BILLING_EVENT_POSTINGS.REFUND.credit).toBe(PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE);
    });

    it('skips the event types that are notifications rather than money', () => {
        for (const eventType of [
            'PAYMENT_RETRY_REMINDER',
            'ADDON_PAYMENT_RETRY_REMINDER',
            'SUBSCRIPTION_GOOD_STANDING',
            'CHECKOUT_CREATED',
            'MANUAL_WEBHOOK',
            'CALLBACK_FAIL',
            'CALLBACK_CANCEL',
            'subscription_fee_voided',
        ]) {
            expect(BILLING_EVENT_POSTINGS[eventType]).toBeUndefined();
        }
    });
});

describe('resolvePlatformCashAccount', () => {
    it.each([
        ['bKash', PLATFORM_ACCOUNT.BKASH],
        ['BKASH personal', PLATFORM_ACCOUNT.BKASH],
        ['nagad', PLATFORM_ACCOUNT.NAGAD],
        ['Cash', PLATFORM_ACCOUNT.CASH],
        ['bank transfer', PLATFORM_ACCOUNT.BANK],
        ['Bank', PLATFORM_ACCOUNT.BANK],
    ])('reads %s as %s', (method, expected) => {
        expect(resolvePlatformCashAccount(method)).toBe(expected);
    });

    it('gives up rather than guessing on text it does not recognise', () => {
        // Null means "use the mapping's default leg", which is the bank — the
        // right answer far more often than a guess drawn from free text.
        expect(resolvePlatformCashAccount('admin_sale')).toBeNull();
        expect(resolvePlatformCashAccount('')).toBeNull();
        expect(resolvePlatformCashAccount(null)).toBeNull();
        expect(resolvePlatformCashAccount(undefined)).toBeNull();
    });
});
