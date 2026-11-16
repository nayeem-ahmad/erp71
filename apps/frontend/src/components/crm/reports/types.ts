export type LeadSourceRow = {
    source_id: string | null;
    name: string | null;
    leads: number;
    contacted: number;
    contacted_pct: number | null;
    open: number;
    converted: number;
    lost: number;
    conversion_pct: number | null;
    win_rate_pct: number | null;
    median_days_to_convert: number | null;
    revenue: number;
    revenue_per_lead: number | null;
};

export type LeadSourceReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: LeadSourceRow[];
    totals: Omit<LeadSourceRow, 'source_id' | 'name'>;
};

export type ScorecardRow = {
    user_id: string;
    name: string;
    open_leads: number;
    new_leads: number;
    activities_logged: number;
    leads_touched: number;
    follow_ups_due: number;
    follow_ups_on_time_pct: number | null;
    overdue_now: number;
    converted: number;
    lost: number;
    win_rate_pct: number | null;
    revenue: number;
};

export type ScorecardReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: ScorecardRow[];
    totals: Omit<ScorecardRow, 'user_id' | 'name'>;
};

export type FollowUpOutcome = 'on_time' | 'late' | 'overdue' | 'pending' | 'cancelled';

export type ComplianceCounts = {
    due: number;
    on_time: number;
    late: number;
    overdue: number;
    pending: number;
    cancelled: number;
    compliance_pct: number | null;
};

export type FollowUpComplianceReport = {
    filters: { from: string; to: string; mine: boolean };
    by_assignee: (ComplianceCounts & { user_id: string | null; name: string | null })[];
    by_purpose: (ComplianceCounts & { purpose_id: string | null; name: string | null })[];
    totals: ComplianceCounts;
    undated_open: number;
};

export type ColdCustomerRow = {
    customer_id: string;
    name: string;
    phone: string | null;
    customer_code: string | null;
    segment: string;
    orders: number;
    lifetime_spend: number;
    avg_gap_days: number;
    days_since_last: number;
    overdue_days: number;
    last_purchase_date: string;
    last_contacted_at: string | null;
    has_open_follow_up: boolean;
};

export type ColdCustomersReport = {
    as_of: string;
    store_id: string | null;
    factor: number;
    min_gap_days: number;
    rows: ColdCustomerRow[];
    total: number;
    truncated: boolean;
};
