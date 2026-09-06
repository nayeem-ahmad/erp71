import type { PlanCode } from './plans';

/**
 * The tier-specific half of the Terms of Service.
 *
 * Section 4 of the terms deliberately carries no price table — the document used
 * to keep its own copy of the tiers and every figure in it drifted — so nothing
 * here restates a price, a capacity limit or an inclusion either. Those live on
 * the pricing page, which reads them from the same source checkout charges from,
 * and the addenda below link to it rather than duplicate it.
 *
 * What *is* here is the part that genuinely differs per tier and is contractual
 * rather than commercial: which modules a plan licenses, what obligations the
 * modules on that plan put on the customer, and which agreement governs. A
 * Growth workspace running a public storefront takes on responsibilities a
 * Starter workspace does not, and "you agreed to the terms" says nothing useful
 * unless the record also names which tier's addendum applied.
 *
 * Content is English-only, matching `plans.ts`: the page chrome is translated,
 * plan and legal content is not.
 */
export type PlanTermsAddendum = {
    /** URL slug — `/terms?plan=<slug>` — and the DOM id of its section. */
    slug: string;
    /** Absent on Enterprise: there is no ENTERPRISE plan row. */
    code?: PlanCode;
    name: string;
    /** One line naming who the tier is for, shown under the heading. */
    summary: string;
    clauses: Array<{ title: string; body: string }>;
};

export const PLAN_TERMS_ADDENDA: PlanTermsAddendum[] = [
    {
        slug: 'starter',
        code: 'BASIC',
        name: 'Starter',
        summary: 'Single-location retail, entry tier.',
        clauses: [
            {
                title: 'Single workspace',
                body: 'Starter licenses one workspace operating from a single location. Multi-branch operation, branch switching and additional warehouses are not licensed under this tier and remain unavailable until the subscription is upgraded.',
            },
            {
                title: 'Capacity',
                body: 'Users, locations and catalog size are capped at the figures published for Starter on the pricing page. Where a cap is reached, the Service will decline further records of that kind rather than bill an overage; continuing requires an upgrade.',
            },
            {
                title: 'Support',
                body: 'Support on Starter is provided by email only, to the response target published for the tier. Telephone and live chat support are not included. This does not affect the availability commitment in the SLA, which is identical across all paid tiers.',
            },
        ],
    },
    {
        slug: 'accounting',
        code: 'ACCOUNTING',
        name: 'Accounting edition',
        summary: 'Bookkeeping only — deliberately not a rung on the retail ladder.',
        clauses: [
            {
                title: 'Retail modules are not licensed',
                body: 'The Accounting edition licenses the ledger, financial reporting and related bookkeeping modules only. Point of sale, inventory, CRM, the online storefront and manufacturing are not licensed under this tier. Their absence is a term of this plan and not a defect, and you agree not to circumvent the restriction by any means.',
            },
            {
                title: 'Your clients’ data',
                body: 'Where you use the Accounting edition to keep books on behalf of third parties, you remain responsible for your own engagement terms with those parties, for the lawful basis on which you upload their records, and for any statutory retention obligations attaching to them.',
            },
            {
                title: 'Moving to a retail tier',
                body: 'Upgrading from the Accounting edition to a retail tier enables modules that were previously unavailable and does not migrate or reinterpret existing ledger data. Opening balances and mappings remain your responsibility.',
            },
        ],
    },
    {
        slug: 'growth',
        code: 'STANDARD',
        name: 'Growth',
        summary: 'Multi-branch retail with a public storefront and CRM.',
        clauses: [
            {
                title: 'Public storefront',
                body: 'Growth licenses a public online storefront. When you publish one you become the seller of record for orders placed through it, and are responsible for the accuracy of the listings, the fulfilment of the orders, and your own returns and consumer-rights obligations. ERP71 provides the platform and is not a party to any sale you make through it.',
            },
            {
                title: 'Shopper data',
                body: 'Personal data your storefront collects from shoppers is processed by ERP71 on your instructions. You are the controller of that data and we are your processor; the handling terms in Section 6 and the Privacy Policy apply. You are responsible for publishing your own privacy notice on the storefront.',
            },
            {
                title: 'CRM and outbound messaging',
                body: 'Where you use the CRM, loyalty or campaign features to contact customers, you warrant that you hold a lawful basis for each contact and will honour opt-outs. Sending unsolicited bulk messages through the Service is a breach of Section 5 and may result in suspension of the messaging features without notice.',
            },
            {
                title: 'Multi-branch access',
                body: 'Branches share one tenant and one audit log. Restricting a user to a branch is a permission setting under your control; ERP71 does not guarantee that any branch’s data is invisible to an administrator you have granted tenant-wide rights to.',
            },
        ],
    },
    {
        slug: 'business',
        code: 'PREMIUM',
        name: 'Business',
        summary: 'Multi-branch operators running payroll, manufacturing or imports.',
        clauses: [
            {
                title: 'Availability of the tier',
                body: 'Business is published but is not yet open for self-serve purchase. These terms take effect for a workspace on the tier from the date its subscription begins, not from the date the tier was announced.',
            },
            {
                title: 'Payroll and HR',
                body: 'The payroll module calculates and records; it does not file. You remain the employer of record and are solely responsible for the correctness of wages, deductions, income tax, and any contribution or reporting obligation owed to the National Board of Revenue or any other authority. Figures produced by the Service are an aid to your own compliance and not tax advice.',
            },
            {
                title: 'Manufacturing and imports',
                body: 'Bills of materials, production costing, landed-cost apportionment and letter-of-credit records are recorded as you enter them. Valuation and customs treatment of the resulting figures remain your responsibility and that of your advisers.',
            },
            {
                title: 'API and white-label use',
                body: 'API access is licensed for your own workspace’s data. You may not resell API access, expose it to third parties as a product of your own, or exceed published rate limits. White-label presentation does not transfer ownership of the platform or any part of it; Section 7 continues to apply in full.',
            },
        ],
    },
    {
        slug: 'enterprise',
        name: 'Enterprise',
        summary: 'Contracted separately — these Terms are the floor, not the agreement.',
        clauses: [
            {
                title: 'A signed agreement governs',
                body: 'Enterprise is not sold self-serve and is not activated by accepting these Terms. It is provided under a separately negotiated and signed agreement. Where that agreement conflicts with any provision of these Terms — including the liability cap in Section 8, the termination rights in Section 9, and the availability commitments in the SLA — the signed agreement prevails.',
            },
            {
                title: 'Until one is signed',
                body: 'If an Enterprise workspace is provisioned before its agreement is executed, these Terms govern the interim period in full. Nothing said during procurement varies them until it is in the signed agreement.',
            },
            {
                title: 'Dedicated infrastructure and SSO',
                body: 'Dedicated database hosting, single sign-on, custom modules, data migration and named account management are scoped in the signed agreement. They are not implied by these Terms and are not available by accepting them.',
            },
        ],
    },
];

/**
 * Query-string aliases, matching the signup page’s `PLAN_QUERY_TO_CODE`.
 *
 * Both the plan codes and the marketing slugs resolve, because the ladder was
 * renamed and `?plan=basic` is still in ad campaigns and bookmarks. An unknown
 * or absent value resolves to nothing, which renders every addendum rather than
 * guessing at one.
 */
const PLAN_TERMS_ALIASES: Record<string, string> = {
    basic: 'starter',
    starter: 'starter',
    accounting: 'accounting',
    standard: 'growth',
    growth: 'growth',
    premium: 'business',
    business: 'business',
    enterprise: 'enterprise',
};

export function resolvePlanTermsSlug(value: string | null | undefined): string | null {
    if (!value) return null;
    return PLAN_TERMS_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function planTermsAddendumForCode(code: string | null | undefined): PlanTermsAddendum | null {
    const slug = resolvePlanTermsSlug(code);
    return PLAN_TERMS_ADDENDA.find((addendum) => addendum.slug === slug) ?? null;
}
