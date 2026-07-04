export type RefereeStats = {
    pending_signups: number;
    earned_count: number;
    earned_amount: number;
    paid_count: number;
    paid_amount: number;
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
    status: 'PENDING' | 'EARNED' | 'PAID';
    signed_up_at: string;
    earned_at?: string | null;
    paid_at?: string | null;
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
    };
    summary: {
        total_referrals: number;
        pending: number;
        earned: number;
        paid: number;
        total_earned_amount: number;
        total_paid_amount: number;
        balance_due: number;
    };
    commissions: ReferralCommission[];
    payments: RefereePayment[];
};