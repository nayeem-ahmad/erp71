export type ReferralCommissionStatus = 'PENDING' | 'EARNED' | 'PAID' | 'REVERSED';

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
};

export type RefereeLedger = {
    referee: {
        id: string;
        name: string;
        email: string;
        referral_code: string;
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
    commissions: ReferralCommission[];
    payments: RefereePayment[];
};