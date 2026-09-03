export type ReferralCommissionStatus = 'PENDING' | 'EARNED' | 'PAID' | 'REVERSED';

/** Mobile financial services first — that is how a Bangladeshi partner is paid. */
export type RefereePayoutMethod = 'BKASH' | 'NAGAD' | 'ROCKET' | 'BANK';

export type RefereePayoutRequestStatus =
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'PAID'
    | 'CANCELLED';

/** Where the partner's money goes. Owned by the partner, not by an admin. */
export type RefereePayoutProfile = {
    payout_method: RefereePayoutMethod | null;
    payout_account_name: string | null;
    payout_account_number: string | null;
    payout_bank_name: string | null;
    payout_branch: string | null;
    payout_updated_at: string | null;
    /** Enough on file to raise a payout request. */
    is_complete: boolean;
    /** Smallest balance a request may be raised for; a platform setting. */
    min_payout_amount: number;
};

export type RefereePayoutRequest = {
    id: string;
    referee_id: string;
    amount: number;
    status: RefereePayoutRequestStatus;
    /**
     * Snapshot of the destination as it was when the request was raised — editing
     * the profile afterwards must not redirect a payout already approved.
     */
    method: RefereePayoutMethod;
    account_name: string | null;
    account_number: string;
    bank_name: string | null;
    branch: string | null;
    note: string | null;
    /** The admin's reason, on a decline. */
    decision_note: string | null;
    requested_at: string;
    reviewed_at: string | null;
    payment_id: string | null;
    /** Present only on the admin listing. */
    referee?: { id: string; name: string; email: string; referral_code: string };
};

export type RefereeStats = {
    pending_signups: number;
    earned_count: number;
    /** Commissions still in EARNED — i.e. the outstanding balance for this referee. */
    earned_amount: number;
    paid_count: number;
    paid_amount: number;
    reversed_count: number;
    reversed_amount: number;
    clicks: number;
    /** signups / clicks as a percentage; null when nobody has clicked yet. */
    conversion_rate: number | null;
};

export type RefereeRecord = {
    id: string;
    user_id?: string | null;
    name: string;
    email: string;
    phone?: string | null;
    referral_code: string;
    commission_rate: number;
    signup_discount: number;
    is_active: boolean;
    notes?: string | null;
    created_at: string;
    deleted_at?: string | null;
    stats: RefereeStats;
};

export type ReferralCommission = {
    id: string;
    referee_id: string;
    tenant_id: string;
    tenant?: { id: string; name: string };
    discount_pct: number;
    commission_pct: number;
    plan_amount: number | null;
    commission_amount: number | null;
    status: ReferralCommissionStatus;
    signed_up_at: string;
    earned_at?: string | null;
    paid_at?: string | null;
    reversed_at?: string | null;
    reversal_reason?: string | null;
    /** The commission had already been paid out when it was reversed. */
    reversed_after_paid?: boolean;
};

export type RefereePayment = {
    id: string;
    referee_id: string;
    amount: number;
    method?: string | null;
    reference?: string | null;
    notes?: string | null;
    paid_at: string;
    /** The commissions this payout settled. Absent on the admin endpoints. */
    commissions?: ReferralCommission[];
};

/** One month of partner activity, as returned by the ledger endpoint. */
export type ReferralActivityPoint = {
    /** 'YYYY-MM' */
    month: string;
    clicks: number;
    signups: number;
    earned_amount: number;
    paid_amount: number;
};

export type RefereeLedger = {
    referee: {
        id: string;
        name: string;
        email: string;
        referral_code: string;
        /** Discount the referred business gets, as a percentage — printed on the one-pager. */
        signup_discount: number;
        deleted_at?: string | null;
    };
    summary: {
        clicks: number;
        /** signups / clicks as a percentage; null when nobody has clicked yet. */
        conversion_rate: number | null;
        total_referrals: number;
        pending: number;
        earned: number;
        paid: number;
        reversed: number;
        total_earned_amount: number;
        total_reversed_amount: number;
        total_paid_amount: number;
        balance_due: number;
        /** Payments recorded beyond what was earned. Non-zero means the ledger drifted. */
        overpaid_amount: number;
    };
    /** Twelve monthly buckets, oldest first, ending with the current month. */
    activity: ReferralActivityPoint[];
    commissions: ReferralCommission[];
    payments: RefereePayment[];
};