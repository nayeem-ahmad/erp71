export type PlanId = 'basic' | 'accounting' | 'standard' | 'premium';

export type MarketingPlan = {
    id: PlanId;
    code: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    name: string;
    monthlyPrice: number;
    yearlyPrice: number;
    highlight: boolean;
    tagline: string;
    features: string[];
    comingSoon?: boolean;
};

/** Aligned with `packages/database/prisma/seed.ts` paid subscription plans. */
export const MARKETING_PLANS: MarketingPlan[] = [
    {
        id: 'basic',
        code: 'BASIC',
        name: 'BASIC',
        monthlyPrice: 499,
        yearlyPrice: 416,
        highlight: false,
        tagline: 'For small shops just getting started',
        features: [
            'Full POS terminal',
            'Inventory management',
            'Purchase orders',
            '3 user accounts',
            '1 store location',
            'Up to 2,000 products',
            'Email support',
        ],
    },
    {
        id: 'accounting',
        code: 'ACCOUNTING',
        name: 'ACCOUNTING',
        monthlyPrice: 749,
        yearlyPrice: 624,
        highlight: false,
        tagline: 'Bookkeeping-focused pack for accountants',
        features: [
            'Full accounting module',
            'Financial reports (P&L, balance sheet, cashbook)',
            'Expense & fund management',
            'Loan tracking',
            '5 user accounts',
            '1 store location',
            'Email support',
        ],
    },
    {
        id: 'standard',
        code: 'STANDARD',
        name: 'STANDARD',
        monthlyPrice: 999,
        yearlyPrice: 833,
        highlight: true,
        tagline: 'For growing businesses with multiple locations',
        features: [
            'Everything in BASIC',
            'Accounting module',
            'Financial reports',
            'Sales orders',
            'Customer management',
            'Supplier management',
            'E-commerce storefront',
            '3 store locations',
            '10 user accounts',
            'Priority email support',
        ],
    },
    {
        id: 'premium',
        code: 'PREMIUM',
        name: 'PREMIUM',
        monthlyPrice: 1499,
        yearlyPrice: 1249,
        highlight: false,
        comingSoon: true,
        tagline: 'For enterprise retailers scaling fast',
        features: [
            'Everything in STANDARD',
            'Manufacturing / BOM',
            'White-label branding',
            'Public API access',
            '10 store locations',
            '30 user accounts',
            'Unlimited products',
            'Priority phone & chat support',
        ],
    },
];

export type ComparisonCell = string | boolean;

export type ComparisonRow = {
    feature: string;
    basic: ComparisonCell;
    accounting: ComparisonCell;
    standard: ComparisonCell;
    premium: ComparisonCell;
};

export const PLAN_COMPARISON_ROWS: ComparisonRow[] = [
    { feature: 'POS terminal', basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Inventory management', basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Purchase orders', basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Sales orders', basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Accounting module', basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Financial reports', basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Expense & fund management', basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Customer management', basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Supplier management', basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Multi-store support', basic: '1 store', accounting: '1 store', standard: '3 stores', premium: '10 stores' },
    { feature: 'E-commerce storefront', basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Manufacturing / BOM', basic: false, accounting: false, standard: false, premium: true },
    { feature: 'White-label branding', basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Lead management & conversations', basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Public API access', basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Priority support', basic: false, accounting: false, standard: true, premium: true },
];

export const PRICING_FAQS = [
    {
        q: 'Can I change my plan later?',
        a: 'Yes — you can upgrade or downgrade at any time from your account settings. Upgrades take effect immediately and you are billed the prorated difference. Downgrades take effect at the start of your next billing cycle.',
    },
    {
        q: 'Is there a free trial?',
        a: 'We are not offering free trials or a free plan at this time. Choose a paid plan during signup and complete checkout from your billing dashboard to activate your workspace.',
    },
    {
        q: 'How does billing work?',
        a: 'Monthly plans are billed on the same date each month. Yearly plans are billed once upfront and save you the equivalent of 2 months. We accept bKash, Nagad, and all major credit/debit cards.',
    },
    {
        q: 'Do you offer refunds?',
        a: 'We offer a full refund within 7 days of the first charge on any new subscription. After that period, refunds are issued on a case-by-case basis — contact support and we will work something out.',
    },
    {
        q: 'What happens to my data if I cancel?',
        a: 'Your data is retained for 90 days after cancellation. You can export everything (products, customers, transactions) at any time from the settings panel. After 90 days, data is permanently deleted.',
    },
];

export function yearlySavingsPercent(plan: MarketingPlan): number {
    if (plan.monthlyPrice <= 0) return 0;
    return Math.round(((plan.monthlyPrice - plan.yearlyPrice) / plan.monthlyPrice) * 100);
}

export type PublicPlanFromApi = {
    code: MarketingPlan['code'];
    name: string;
    description?: string | null;
    monthly_price: number;
    yearly_price?: number | null;
    marketing_features?: string[];
};

/** Merge live API plan data onto static marketing defaults (pricing/signup). */
export function buildMarketingPlansFromApi(apiPlans: PublicPlanFromApi[]): MarketingPlan[] {
    const paidApiPlans = apiPlans.filter((plan) => plan.code !== 'FREE' && plan.monthly_price > 0);
    if (!paidApiPlans.length) return MARKETING_PLANS;

    return MARKETING_PLANS.map((fallback) => {
        const live = paidApiPlans.find((plan) => plan.code === fallback.code);
        if (!live) return fallback;

        const yearlyMonthlyEquivalent = live.yearly_price && live.yearly_price > 0
            ? Math.round(live.yearly_price / 12)
            : fallback.yearlyPrice;

        return {
            ...fallback,
            name: live.name || fallback.name,
            tagline: live.description?.trim() || fallback.tagline,
            monthlyPrice: live.monthly_price,
            yearlyPrice: yearlyMonthlyEquivalent,
            features: live.marketing_features?.length ? live.marketing_features : fallback.features,
        };
    });
}