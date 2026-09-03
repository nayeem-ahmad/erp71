/**
 * Marketing copy for the public pricing surfaces.
 *
 * **Prices here are a fallback, not the truth.** Every price, name, tagline and
 * bullet is overridden by `GET /auth/plans` via `buildMarketingPlansFromApi`,
 * because a platform admin edits live values in the admin UI and the seed
 * deliberately never rewrites an existing plan row. The constants below are what
 * a freshly seeded environment holds — they match
 * `packages/database/prisma/seed-platform.ts` — and are what renders if the API
 * is unreachable. Keep them in step with the seed, and expect production to
 * differ until the reprice happens.
 *
 * Content is English-only by design, matching how this file has always worked:
 * the page chrome is translated through `t.marketing.pricing`, plan content is
 * not.
 */

/** The capability ladder. Accounting is deliberately not on it — see `ACCOUNTING_EDITION`. */
export type PlanId = 'starter' | 'growth' | 'business' | 'enterprise';

export type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

export type MarketingPlan = {
    id: PlanId;
    /** Absent on Enterprise: there is no ENTERPRISE row, `SubscriptionPlanCode` is an enum. */
    code?: PlanCode;
    name: string;
    monthlyPrice: number;
    /** Monthly equivalent when billed yearly, i.e. yearly total / 12. */
    yearlyPrice: number;
    /** One-time onboarding fee. Zero is hidden by the UI rather than shown as free. */
    setupFee: number;
    /** Monthly AI credit allowance, shown on the card. */
    aiCredits: number | null;
    highlight: boolean;
    tagline: string;
    features: string[];
    comingSoon?: boolean;
    /** Quote-led: renders a contact link instead of a checkout button. */
    contactSales?: boolean;
    priceLabel?: string;
};

export const MARKETING_PLANS: MarketingPlan[] = [
    {
        id: 'starter',
        code: 'BASIC',
        name: 'Starter',
        monthlyPrice: 299,
        yearlyPrice: 249,
        setupFee: 0,
        aiCredits: 100,
        highlight: false,
        tagline: 'One counter, one owner, a couple of staff',
        features: [
            '1 branch, 1 warehouse',
            '2 users, 500 products',
            'POS, sales & returns',
            'Purchase entry & suppliers',
            'Cash book & expenses',
            'AI assistant, 100 credits',
            'Email support, 2 business days',
        ],
    },
    {
        id: 'growth',
        code: 'STANDARD',
        name: 'Growth',
        monthlyPrice: 999,
        yearlyPrice: 833,
        setupFee: 4000,
        aiCredits: 500,
        highlight: true,
        tagline: 'Books to close, a second branch, someone chasing customers',
        features: [
            '2 branches, 10 users',
            '10,000 products',
            'Full ledger & financial reports',
            'Sales orders & quotations',
            'CRM pipeline & loyalty',
            'Online storefront',
            'AI assistant, 500 credits',
            'Priority email support',
        ],
    },
    {
        id: 'business',
        code: 'PREMIUM',
        name: 'Business',
        monthlyPrice: 2499,
        yearlyPrice: 2083,
        setupFee: 15000,
        aiCredits: 2000,
        highlight: false,
        comingSoon: true,
        tagline: 'Multi-branch operators who run payroll, manufacture, or import',
        features: [
            '5 branches, 30 users',
            'Unlimited products',
            'Manufacturing & BOM included',
            'Payroll & recruitment',
            'Advanced accounting reports',
            'Public API & white-label',
            'AI assistant, 2,000 credits',
            'Phone & chat support',
        ],
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        monthlyPrice: 8000,
        yearlyPrice: 8000,
        setupFee: 0,
        aiCredits: null,
        highlight: false,
        contactSales: true,
        priceLabel: 'Quote',
        tagline: 'Chains and groups where procurement wants a contract',
        features: [
            'Unlimited branches & users',
            'Single sign-on',
            'Dedicated database',
            'Data migration included',
            'Custom modules & integrations',
            'Named account manager',
            '99.9% SLA with credits',
        ],
    },
];

/**
 * Off the ladder on purpose. It carries `accountingOnly`, which hides every
 * retail module, so asking whether it "has POS" is the wrong question — it is a
 * bookkeeping product for a different buyer, not a cheaper rung.
 */
export const ACCOUNTING_EDITION = {
    code: 'ACCOUNTING' as const,
    name: 'Accounting edition',
    monthlyPrice: 749,
    yearlyPrice: 624,
    setupFee: 0,
    tagline: 'For a firm that keeps books rather than a shop that makes sales',
    features: [
        'Full ledger & chart of accounts',
        'P&L, balance sheet, trial balance',
        'Comparative P&L, budget vs actual, ratios',
        'Expenses, fund transfers, loans, investors',
        'Bank reconciliation & recurring journals',
        '5 users, 1 workspace',
        'No POS, no inventory, no CRM — by design',
    ],
};

/** Included on every plan, so it is stated once rather than repeated per card. */
export const INCLUDED_EVERYWHERE = [
    'Full Bangla and English interface',
    'bKash, Nagad and card checkout',
    'Daily backups and full data export',
    'Roles, permissions and a full audit log',
    'POS terminal and cashier sessions',
    'Unlimited customer accounts',
    'AI assistant, with monthly credits',
    'Free import of your existing data',
];

export const AI_HIGHLIGHTS = [
    { title: 'Ask about your own data', body: 'Answered from your sales, stock and ledger.' },
    { title: 'Speak instead of typing', body: 'Record a sale or a stock entry by voice, in Bangla or English.' },
    { title: 'Reports in plain words', body: 'A written summary of what a report actually shows.' },
    { title: 'Drafting and scanning', body: 'Draft a message, or turn a business card into a contact.' },
];

export const MIGRATION_HIGHLIGHTS = [
    { title: 'Products & catalogue', body: 'Names, codes, prices, units and categories from a spreadsheet.' },
    { title: 'Customers & suppliers', body: 'Contacts, addresses and what each party currently owes.' },
    { title: 'Opening stock', body: 'Counted quantities per branch, so day one is real.' },
    { title: 'Opening balances', body: 'Cash, bank, receivables and payables, ready for your accountant.' },
];

export type ComparisonCell = string | boolean;

export type ComparisonRow = {
    feature: string;
    /** Shown as a roadmap marker: listed so nothing comes as a surprise later. */
    soon?: boolean;
    starter: ComparisonCell;
    growth: ComparisonCell;
    business: ComparisonCell;
    enterprise: ComparisonCell;
};

export type ComparisonGroup = {
    title: string;
    rows: ComparisonRow[];
};

const all = (value: ComparisonCell = true) => ({
    starter: value,
    growth: value,
    business: value,
    enterprise: value,
});

const growthUp = { starter: false, growth: true, business: true, enterprise: true };
const businessUp = { starter: false, growth: false, business: true, enterprise: true };

export const PLAN_COMPARISON_GROUPS: ComparisonGroup[] = [
    {
        title: 'Capacity',
        rows: [
            { feature: 'Branches included', starter: '1', growth: '2', business: '5', enterprise: 'Unlimited' },
            { feature: 'Team members included', starter: '2', growth: '10', business: '30', enterprise: 'Unlimited' },
            { feature: 'Products (SKUs)', starter: '500', growth: '10,000', business: 'Unlimited', enterprise: 'Unlimited' },
            { feature: 'Warehouses per branch', starter: '1', growth: '3', business: '5', enterprise: 'Unlimited' },
            { feature: 'Additional branch', starter: false, growth: '৳400/mo', business: '৳400/mo', enterprise: 'Included' },
            { feature: 'Additional 5 team members', starter: false, growth: '৳300/mo', business: '৳300/mo', enterprise: 'Included' },
        ],
    },
    {
        title: 'Selling',
        rows: [
            { feature: 'POS terminal & cashier sessions', ...all() },
            { feature: 'Sales invoices, returns & receipts', ...all() },
            { feature: 'Sales quotations & sales orders', ...growthUp },
            { feature: 'Price lists & customer groups', ...growthUp },
            { feature: 'Loyalty points & discount codes', ...growthUp },
            { feature: 'Delivery tracking & warranty claims', ...growthUp },
        ],
    },
    {
        title: 'Online storefront',
        rows: [
            { feature: 'Storefront on an erp71.com address', ...growthUp },
            { feature: 'Web orders into the same stock & ledger', ...growthUp },
            { feature: 'Shop blog & product pages', ...growthUp },
            { feature: 'Customer accounts & order history', soon: true, ...growthUp },
            { feature: 'Custom domain & unbranded pages', soon: true, ...businessUp },
        ],
    },
    {
        title: 'Buying and stock',
        rows: [
            { feature: 'Purchase entry & supplier records', ...all() },
            { feature: 'Purchase orders, quotations & returns', ...growthUp },
            { feature: 'Stock takes & shrinkage recording', ...growthUp },
            { feature: 'Branch & warehouse transfers', ...growthUp },
            { feature: 'Stock valuation, aging & reorder analytics', ...growthUp },
        ],
    },
    {
        title: 'Money',
        rows: [
            { feature: 'Cash book & expense tracking', ...all() },
            { feature: 'Full ledger & chart of accounts', ...growthUp },
            { feature: 'P&L, balance sheet & trial balance', ...growthUp },
            { feature: 'Comparative P&L, budget vs actual, ratios', starter: false, growth: '৳599/mo', business: true, enterprise: true },
            { feature: 'Fund transfers, loans & investors', ...growthUp },
            { feature: 'Bank reconciliation & recurring journals', ...growthUp },
        ],
    },
    {
        title: 'People',
        rows: [
            { feature: 'Users, roles & per-branch permissions', ...all() },
            { feature: 'Attendance & work schedules', ...growthUp },
            { feature: 'Expense claims & approvals', ...growthUp },
            { feature: 'Employee self-service portal', ...growthUp },
            { feature: 'Payroll & salary payments', ...businessUp },
            { feature: 'Recruitment & employee lifecycle', ...businessUp },
        ],
    },
    {
        title: 'Customers and portal accounts',
        rows: [
            { feature: 'Customer & supplier records', ...all() },
            { feature: 'Storefront customer accounts', ...all('Unlimited') },
            { feature: 'Seats used by customer or portal logins', ...all('None') },
            { feature: 'CRM leads, pipeline & activities', ...growthUp },
            { feature: 'Campaigns, territories & lead scoring', ...businessUp },
            { feature: 'Projects & timesheets', ...businessUp },
        ],
    },
    {
        title: 'Artificial intelligence',
        rows: [
            { feature: 'AI assistant over your own data', ...all() },
            { feature: 'Report narration & message drafting', ...all() },
            { feature: 'Business card scanning', ...all() },
            { feature: 'Voice entry & voice navigation', ...growthUp },
            { feature: 'Anomaly detection on sales & stock', ...businessUp },
            { feature: 'Monthly credit allowance', starter: '100', growth: '500', business: '2,000', enterprise: 'Custom' },
            { feature: 'Buy extra credits', ...all() },
        ],
    },
    {
        title: 'Industry add-ons',
        rows: [
            { feature: 'Manufacturing & bill of materials', starter: false, growth: '৳999/mo', business: true, enterprise: true },
            { feature: 'Team chat', starter: '৳299/mo', growth: '৳299/mo', business: true, enterprise: true },
            { feature: 'Imports & letters of credit', soon: true, starter: false, growth: '৳999/mo', business: true, enterprise: true },
            { feature: 'Book publishing', soon: true, starter: false, growth: '৳799/mo', business: '৳799/mo', enterprise: true },
        ],
    },
    {
        title: 'Platform',
        rows: [
            { feature: 'Bangla & English interface', ...all() },
            { feature: 'bKash, Nagad & card checkout', ...all() },
            { feature: 'Daily backups, audit log & data export', ...all() },
            { feature: 'Standard data migration', ...all('Free') },
            { feature: 'Custom fields & print templates', ...growthUp },
            { feature: 'Public API & webhooks', ...businessUp },
            { feature: 'White-label branding', ...businessUp },
            { feature: 'Single sign-on & dedicated database', soon: true, starter: false, growth: false, business: false, enterprise: true },
            {
                feature: 'Support',
                starter: 'Email, 2 days',
                growth: 'Priority email',
                business: 'Phone & chat',
                enterprise: 'Named manager',
            },
        ],
    },
];

export const PRICING_FAQS = [
    {
        q: 'Can I change my plan later?',
        a: 'Yes — upgrade or downgrade at any time from your account settings. Upgrades take effect immediately and you are billed the prorated difference. Downgrades take effect at the start of your next billing cycle.',
    },
    {
        q: 'Is there a free trial?',
        a: 'We are not offering free trials or a free plan at this time. Starter with no setup fee and a 7-day refund is the low-risk way in.',
    },
    {
        q: 'Do I pay extra for the AI?',
        a: 'No. Every plan includes the assistant and a monthly credit allowance, from 100 on Starter to 2,000 on Business. Top-ups are available if you run out, and nothing stops working except the assistant — the POS keeps ringing up sales.',
    },
    {
        q: 'Will you move my existing data in?',
        a: 'Yes, free on every plan — products, customers, suppliers, opening stock and balances. Send us the files and we load them. Only customisation is charged, such as history out of Tally or a desktop POS, and it is always quoted before any work starts.',
    },
    {
        q: 'Do staff accounts cost extra?',
        a: 'Only above your plan’s included count, in packs of five. Customer accounts on your storefront and employee self-service logins never count toward it.',
    },
    {
        q: 'What is the setup fee?',
        a: 'A one-time charge for getting your workspace ready on day one, charged on your first payment only and never again. Starter has none. It is refundable in full within 30 days.',
    },
    {
        q: 'How does billing work?',
        a: 'Monthly plans are billed on the same date each month. Yearly plans are billed once upfront and save you the equivalent of 2 months. We accept bKash, Nagad, and all major credit/debit cards.',
    },
    {
        q: 'What happens to my data if I cancel?',
        a: 'Your data is retained for 90 days after cancellation. You can export everything — products, customers, transactions — at any time from the settings panel. After 90 days it is permanently deleted.',
    },
];

export function yearlySavingsPercent(plan: MarketingPlan): number {
    if (plan.monthlyPrice <= 0) return 0;
    return Math.round(((plan.monthlyPrice - plan.yearlyPrice) / plan.monthlyPrice) * 100);
}

export type PublicPlanFromApi = {
    code: PlanCode;
    name: string;
    description?: string | null;
    monthly_price: number;
    yearly_price?: number | null;
    setup_fee?: number;
    marketing_features?: string[];
    features_json?: Record<string, unknown> | null;
};

function aiCreditsFrom(plan: PublicPlanFromApi, fallback: number | null): number | null {
    const raw = plan.features_json?.aiCreditsMonthly;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Merge live API plans onto the static defaults.
 *
 * The API is authoritative for everything it sends, so a reprice in the admin UI
 * reaches this page with no deploy. A plan the API omits — today that is
 * PREMIUM, filtered out while it sits in `COMING_SOON_SUBSCRIPTION_PLAN_CODES` —
 * keeps its static values, and Enterprise has no row to come from at all.
 */
export function buildMarketingPlansFromApi(apiPlans: PublicPlanFromApi[]): MarketingPlan[] {
    const paidApiPlans = apiPlans.filter((plan) => plan.code !== 'FREE' && plan.monthly_price > 0);
    if (!paidApiPlans.length) return MARKETING_PLANS;

    return MARKETING_PLANS.map((fallback) => {
        const live = fallback.code
            ? paidApiPlans.find((plan) => plan.code === fallback.code)
            : undefined;
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
            setupFee: typeof live.setup_fee === 'number' ? live.setup_fee : fallback.setupFee,
            aiCredits: aiCreditsFrom(live, fallback.aiCredits),
            features: live.marketing_features?.length ? live.marketing_features : fallback.features,
            // A plan the API returns is purchasable by definition — the endpoint
            // filters on `isSelfServeSubscriptionPlan`. So a live row clears the
            // static coming-soon flag rather than contradicting it.
            comingSoon: false,
        };
    });
}

/** The accounting edition, with live values when the API returns it. */
export function buildAccountingEditionFromApi(apiPlans: PublicPlanFromApi[]) {
    const live = apiPlans.find((plan) => plan.code === 'ACCOUNTING');
    if (!live) return ACCOUNTING_EDITION;

    return {
        ...ACCOUNTING_EDITION,
        name: live.name || ACCOUNTING_EDITION.name,
        tagline: live.description?.trim() || ACCOUNTING_EDITION.tagline,
        monthlyPrice: live.monthly_price,
        yearlyPrice: live.yearly_price && live.yearly_price > 0
            ? Math.round(live.yearly_price / 12)
            : ACCOUNTING_EDITION.yearlyPrice,
        setupFee: typeof live.setup_fee === 'number' ? live.setup_fee : ACCOUNTING_EDITION.setupFee,
        features: live.marketing_features?.length ? live.marketing_features : ACCOUNTING_EDITION.features,
    };
}
