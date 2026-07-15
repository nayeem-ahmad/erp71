export type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export type SecondaryLocale = 'bn' | 'ms';

export type TenantRecord = {
    id: string;
    name: string;
    created_at: string;
    localization_enabled?: boolean;
    secondary_locale?: SecondaryLocale | null;
    business_type?: string | null;
    owner: { id: string; email: string; name?: string | null } | null;
    stores: Array<{ id: string; name: string; address?: string | null; created_at?: string }>;
    users: Array<{ id: string; email: string; name?: string | null; role: string; joined_at?: string }>;
    store_count: number;
    user_count: number;
    sms_credits?: number;
    ledger_balance?: number;
    ai_credits?: {
        used: number;
        limit: number;
        remaining: number;
        bonus: number;
    };
    subscription: {
        status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
        current_period_start: string;
        current_period_end: string;
        cancel_at_period_end: boolean;
        provider_name?: string | null;
        discount_type?: DiscountType | null;
        discount_value?: number | null;
        plan: {
            code: PlanCode;
            name: string;
            description?: string | null;
            monthly_price: number;
            yearly_price?: number | null;
        };
    } | null;
};

export type LedgerEvent = {
    id: string;
    tenant_id?: string;
    tenant_name?: string;
    event_type: string;
    status: string;
    provider_name: string;
    amount: number | null;
    currency: string | null;
    reference_id: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
    running_balance?: number;
};

export type CreateDraft = {
    ownerEmail: string;
    ownerName: string;
    existingEmail: string;
    ownerUserId: string;
    tenantName: string;
    storeName: string;
    address: string;
    businessType: string;
    planCode: PlanCode;
    discountMode: 'NONE' | DiscountType;
    discountValue: string;
};

export function emptyCreateDraft(): CreateDraft {
    return {
        ownerEmail: '',
        ownerName: '',
        existingEmail: '',
        ownerUserId: '',
        tenantName: '',
        storeName: '',
        address: '',
        businessType: '',
        planCode: 'FREE',
        discountMode: 'NONE',
        discountValue: '',
    };
}