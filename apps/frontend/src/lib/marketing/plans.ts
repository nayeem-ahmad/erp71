export type PlanId = 'free' | 'basic' | 'accounting' | 'standard' | 'premium';

export type MarketingPlan = {
    id: PlanId;
    code: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    name: string;
    monthlyPrice: number;
    yearlyPrice: number;
    highlight: boolean;
    tagline: string;
    features: string[];
};

/** Aligned with `packages/database/prisma/seed.ts` subscription plans. */
export const MARKETING_PLANS: MarketingPlan[] = [
    {
        id: 'free',
        code: 'FREE',
        name: 'FREE',
        monthlyPrice: 0,
        yearlyPrice: 0,
        highlight: false,
        tagline: 'Try it out, no strings attached',
        features: [
            'Basic POS terminal',
            '1 user account',
            '1 store location',
            'Up to 100 products',
            'Community support',
        ],
    },
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
    free: ComparisonCell;
    basic: ComparisonCell;
    accounting: ComparisonCell;
    standard: ComparisonCell;
    premium: ComparisonCell;
};

export const PLAN_COMPARISON_ROWS: ComparisonRow[] = [
    { feature: 'POS terminal', free: true, basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Inventory management', free: false, basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Purchase orders', free: false, basic: true, accounting: false, standard: true, premium: true },
    { feature: 'Sales orders', free: false, basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Accounting module', free: false, basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Financial reports', free: false, basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Expense & fund management', free: false, basic: false, accounting: true, standard: true, premium: true },
    { feature: 'Customer management', free: false, basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Supplier management', free: false, basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Multi-store support', free: '1 store', basic: '1 store', accounting: '1 store', standard: '3 stores', premium: '10 stores' },
    { feature: 'E-commerce storefront', free: false, basic: false, accounting: false, standard: true, premium: true },
    { feature: 'Manufacturing / BOM', free: false, basic: false, accounting: false, standard: false, premium: true },
    { feature: 'White-label branding', free: false, basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Lead management & conversations', free: false, basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Public API access', free: false, basic: false, accounting: false, standard: false, premium: true },
    { feature: 'Priority support', free: false, basic: false, accounting: false, standard: true, premium: true },
];

export const PRICING_FAQS = [
    {
        q: 'Can I change my plan later?',
        a: 'Yes — you can upgrade or downgrade at any time from your account settings. Upgrades take effect immediately and you are billed the prorated difference. Downgrades take effect at the start of your next billing cycle.',
    },
    {
        q: 'Is there a free trial?',
        a: 'Every paid plan comes with a 14-day free trial. No credit card is required to start. If you decide not to continue, your account simply reverts to the FREE plan.',
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