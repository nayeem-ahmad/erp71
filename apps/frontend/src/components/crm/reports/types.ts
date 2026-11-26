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

export type AgingBucketKey = '0-7' | '8-14' | '15-30' | '31-60' | '61-90' | '90+';

export type AgingBucket = {
    key: AgingBucketKey;
    leads: number;
    share_pct: number | null;
    stale: number;
    oldest_days: number | null;
};

export type AgingStage = {
    status: string;
    leads: number;
    avg_age_days: number | null;
    oldest_days: number | null;
    stale: number;
};

/** A snapshot of the open pipeline — no date window, only `as_of`. */
export type LeadAgingReport = {
    as_of: string;
    stale_after_days: number;
    buckets: AgingBucket[];
    by_stage: AgingStage[];
    totals: {
        open: number;
        stale: number;
        stale_pct: number | null;
        avg_age_days: number | null;
        oldest_days: number | null;
    };
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

export type ActivitySummaryChannel = {
    code: string;
    name: string;
    total: number;
};

export type ActivitySummaryRow = {
    user_id: string | null;
    name: string | null;
    /** Keyed by channel code. A channel the person did not use is absent. */
    counts: Record<string, number>;
    total: number;
    share_pct: number | null;
};

export type CrmActivitySummaryReport = {
    filters: { from: string; to: string; mine: boolean };
    channels: ActivitySummaryChannel[];
    rows: ActivitySummaryRow[];
    totals: { total: number; unspecified: number; counts: Record<string, number> };
};

export type CampaignPerformanceRow = {
    campaign_id: string;
    name: string;
    channel: string;
    status: string;
    sent_at: string | null;
    recipients: number;
    delivered: number;
    failed: number;
    delivery_pct: number | null;
    orders: number;
    revenue: number;
    conversion_pct: number | null;
    revenue_per_order: number | null;
};

export type CampaignChannelRow = {
    channel: string;
    campaigns: number;
    recipients: number;
    delivered: number;
    orders: number;
    revenue: number;
};

export type CampaignPerformanceReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: CampaignPerformanceRow[];
    by_channel: CampaignChannelRow[];
    totals: {
        campaigns: number;
        recipients: number;
        delivered: number;
        failed: number;
        orders: number;
        revenue: number;
        delivery_pct: number | null;
        conversion_pct: number | null;
    };
};

export type BirthdayRow = {
    customer_id: string;
    name: string;
    phone: string | null;
    birthday: string;
    next_birthday: string;
    days_until: number;
    turning: number | null;
    today: boolean;
};

export type BirthdaysReport = {
    filters: { from: string; to: string };
    days: number;
    rows: BirthdayRow[];
    total: number;
    today: number;
};

export type CoverageParty = 'lead' | 'customer';

export type CoverageRow = {
    party: CoverageParty;
    total: number;
    by_phone: number;
    by_email: number;
    by_both: number;
    reachable: number;
    unreachable: number;
    reachable_pct: number | null;
};

export type SourceCoverageRow = {
    source_id: string | null;
    name: string | null;
    total: number;
    reachable: number;
    reachable_pct: number | null;
};

export type ContactCoverageReport = {
    by_party: CoverageRow[];
    by_source: SourceCoverageRow[];
    totals: { total: number; reachable: number; unreachable: number; reachable_pct: number | null };
};

export type RfmSegment = 'champion' | 'loyal' | 'new' | 'at_risk' | 'hibernating' | 'needs_attention';

export type RfmRow = {
    customer_id: string;
    name: string;
    orders: number;
    revenue: number;
    recency_days: number;
    recency: number;
    frequency: number;
    monetary: number;
    code: string;
    segment: RfmSegment;
};

export type RfmSegmentRow = {
    segment: RfmSegment;
    customers: number;
    revenue: number;
    share_pct: number | null;
};

export type RfmReport = {
    as_of: string;
    rows: RfmRow[];
    by_segment: RfmSegmentRow[];
    totals: { customers: number; revenue: number; repeat: number };
};

export type FunnelRow = {
    month: string;
    arrived: number;
    new: number;
    contacted: number;
    qualified: number;
    converted: number;
    lost: number;
    open: number;
    conversion_pct: number | null;
};

export type LeadFunnelReport = {
    months: string[];
    rows: FunnelRow[];
    totals: {
        arrived: number;
        converted: number;
        lost: number;
        open: number;
        conversion_pct: number | null;
    };
};

export type MovementStageMeta = {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
    is_active: boolean;
    sort_order: number;
};

export type LeadMovementStageRow = MovementStageMeta & {
    count: number;
    share_pct: number | null;
};

export type LeadMovementReport = {
    filters: { from: string; to: string; mine: boolean; status_ids: string[] };
    available_stages: MovementStageMeta[];
    stages: LeadMovementStageRow[];
    totals: { moved: number; converted: number; lost: number; conversion_pct: number | null };
};

export type LostLeadRow = {
    lead_id: string;
    name: string;
    reason: string | null;
    closed_at: string | null;
    days_open: number;
};

export type LostReasonRow = {
    reason: string | null;
    leads: number;
    share_pct: number | null;
    avg_days_open: number | null;
};

export type LostLeadsReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: LostLeadRow[];
    by_reason: LostReasonRow[];
    totals: { lost: number; avg_days_open: number | null };
};
