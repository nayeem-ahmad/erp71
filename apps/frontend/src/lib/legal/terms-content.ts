import { INFO_EMAIL } from '@/lib/brand';

/**
 * The Terms of Service, as data rather than markup.
 *
 * It lives here because two surfaces need the same words: the `/terms` page,
 * and the consent box on signup that people tick a checkbox under. When the
 * document was hardcoded JSX only the page could render it, so signup showed a
 * link instead — asking people to agree to something they had not been shown.
 * Anything that renders from this module is renderable in both places, and the
 * two can no longer drift.
 *
 * Prose carries inline elements — links, bold labels, mailto addresses — so a
 * flat string model would lose them, and lose the punctuation that sits outside
 * them (several commas follow a link rather than being part of its label). Hence
 * the small node model below rather than plain text.
 *
 * English-only, matching `lib/marketing/plans.ts` and `lib/marketing/plan-terms.ts`:
 * page chrome is translated, legal and plan content is not.
 *
 * Editing this changes the agreement. `CURRENT_TERMS_VERSION` has to move with
 * it, or people will be recorded as having accepted a version whose text has
 * silently changed underneath them.
 */

export type LegalInline =
    | string
    | { kind: 'strong'; text: string }
    /**
     * `sameDocument` marks a fragment link that means "elsewhere in this
     * agreement". On `/terms` it is a bare `#anchor`; anywhere else it has to be
     * resolved against `/terms` or it would scroll the host page looking for an
     * id that is not there. The renderer's `linkBase` does that.
     */
    | { kind: 'link'; text: string; href: string; sameDocument?: boolean }
    | { kind: 'email'; address: string };

export type LegalBlock =
    | { kind: 'p'; content: LegalInline[] }
    | { kind: 'ul'; items: LegalInline[][] }
    /** The boxed contact details at the end of the document. */
    | { kind: 'contactCard'; lines: LegalInline[][] };

export type LegalSection =
    /** Numbering is positional — see `TERMS_SECTIONS`. */
    | { kind: 'prose'; heading: string; blocks: LegalBlock[] }
    /** Generated from `PLAN_TERMS_ADDENDA`; the renderer fills this slot. */
    | { kind: 'planAddenda' };

/**
 * Section numbers are NOT stored. They are the array index plus one, so the
 * generated plan-addenda section cannot fall out of step with the numbers the
 * prose refers to ("as further described in Section 4", "set out in Section 11").
 * Reordering or inserting a section renumbers everything automatically — but the
 * cross-references in the prose are plain text and will not, so check them.
 */
export const TERMS_SECTIONS: LegalSection[] = [
    {
        kind: 'prose',
        heading: 'Acceptance of Terms',
        blocks: [
            {
                kind: 'p',
                content: [
                    'By accessing or using the ERP71 platform (“Service”), you agree to be bound by these Terms of Service (“Terms”). If you are entering into these Terms on behalf of a business or organisation, you represent that you have the authority to bind that entity. If you do not agree to these Terms, do not use the Service.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Description of Service',
        blocks: [
            {
                kind: 'p',
                content: [
                    'ERP71 is a cloud-based retail management platform providing point-of-sale (POS), inventory management, sales analytics, customer relationship management, and integrated BDT payment processing for businesses operating in Bangladesh and internationally. The Service is provided on a subscription basis as further described in Section 4.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Account Registration',
        blocks: [
            {
                kind: 'p',
                content: [
                    'To use the Service you must create an account by providing accurate and complete information including your legal name, business name, and a valid email address. You are responsible for:',
                ],
            },
            {
                kind: 'ul',
                items: [
                    ['Maintaining the confidentiality of your account credentials.'],
                    ['All activity that occurs under your account.'],
                    ['Notifying us immediately at ', { kind: 'email', address: INFO_EMAIL }, ' of any unauthorised access.'],
                    ['Ensuring that all staff accounts you create comply with these Terms.'],
                ],
            },
            {
                kind: 'p',
                content: [
                    'You must be at least 18 years old and legally capable of entering into binding contracts under the laws of Bangladesh to register for the Service.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Subscription & Billing',
        // Deliberately no price table here. This document used to carry its own
        // copy of the tiers, which drifted until every figure in it was wrong.
        // Terms should state the billing rules; the prices themselves belong on
        // one page that reads them from the same source checkout charges from.
        blocks: [
            {
                kind: 'p',
                content: [
                    'ERP71 is offered on paid subscription tiers priced in Bangladeshi Taka (BDT), billed monthly or yearly. Current plans, inclusions, capacity limits and any one-time setup fee are listed on our ',
                    { kind: 'link', text: 'pricing page', href: '/pricing' },
                    ', which is the authoritative statement of what each plan costs. The price shown at checkout is the price that applies to your subscription.',
                ],
            },
            {
                kind: 'p',
                content: [
                    'The tier you subscribe to also carries its own terms — which modules it licenses and what obligations they place on you. Those are set out in ',
                    { kind: 'link', text: 'Section 11', href: '#plan-terms', sameDocument: true },
                    ' and form part of this agreement for your plan.',
                ],
            },
            {
                kind: 'ul',
                items: [
                    [
                        { kind: 'strong', text: 'Activation.' },
                        ' New workspaces require a paid plan and successful checkout before full access is granted. Free trials and the free tier are temporarily unavailable while platform capacity is being scaled.',
                    ],
                    [
                        { kind: 'strong', text: 'Auto-renewal.' },
                        ' Subscriptions renew automatically each calendar month on the anniversary of your start date. You authorise ERP71 to charge the applicable BDT amount to your payment method on file on each renewal date.',
                    ],
                    [
                        { kind: 'strong', text: 'Cancellation.' },
                        ' You may cancel or downgrade your subscription at any time from Account Settings. Cancellation takes effect at the end of the current billing period; no partial-month refunds are issued unless required by applicable law.',
                    ],
                    [
                        { kind: 'strong', text: 'Taxes.' },
                        ' All prices are exclusive of VAT and any other taxes imposed by the National Board of Revenue (NBR) of Bangladesh. You are responsible for remitting applicable taxes.',
                    ],
                    [
                        { kind: 'strong', text: 'Payment methods.' },
                        ' We accept bKash, Nagad, SSL Wireless, and major debit/credit cards. All transactions are processed in BDT.',
                    ],
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Acceptable Use',
        blocks: [
            { kind: 'p', content: ['You agree not to use the Service to:'] },
            {
                kind: 'ul',
                items: [
                    ['Violate any applicable law or regulation, including those of Bangladesh.'],
                    ['Process transactions for illegal goods or services.'],
                    ['Reverse-engineer, decompile, or attempt to extract the source code of the platform.'],
                    ['Introduce malicious code, conduct denial-of-service attacks, or scrape data at scale.'],
                    ['Resell or sublicense access to the Service without our express written consent.'],
                    ['Impersonate another person or entity.'],
                ],
            },
            {
                kind: 'p',
                content: [
                    'We reserve the right to suspend or terminate accounts found to be in violation of this section without prior notice.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Data & Privacy',
        blocks: [
            {
                kind: 'p',
                content: [
                    'Your use of the Service is also governed by our ',
                    { kind: 'link', text: 'Privacy Policy', href: '/privacy' },
                    ', which is incorporated into these Terms by reference. By using the Service you consent to the collection and use of your data as described in that policy. All business and transaction data you enter remains your property; ERP71 acts as a data processor on your behalf.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Intellectual Property',
        blocks: [
            {
                kind: 'p',
                content: [
                    'The Service, including all software, designs, trademarks, and documentation, is owned by ERP71 Ltd. and protected by applicable intellectual property laws. These Terms grant you a limited, non-exclusive, non-transferable licence to access and use the Service for your internal business purposes. No other rights are granted.',
                ],
            },
            {
                kind: 'p',
                content: [
                    'Your business data, logos, and content remain your intellectual property. You grant ERP71 a limited licence to store, display, and process that content solely for the purpose of providing the Service.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Limitation of Liability',
        blocks: [
            { kind: 'p', content: ['To the maximum extent permitted by law:'] },
            {
                kind: 'ul',
                items: [
                    ['The Service is provided “as is” and “as available” without warranties of any kind, express or implied, including fitness for a particular purpose or uninterrupted availability.'],
                    ["ERP71's total aggregate liability arising from or related to these Terms shall not exceed the amount you paid for the Service in the three months preceding the claim."],
                    ['ERP71 shall not be liable for any indirect, incidental, special, or consequential damages, including lost profits or lost data, even if advised of the possibility.'],
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Termination',
        blocks: [
            {
                kind: 'p',
                content: [
                    'Either party may terminate these Terms at any time. You may do so by cancelling your subscription and deleting your account. ERP71 may suspend or terminate your access immediately for breach of these Terms, non-payment, or if required by law. Upon termination, your right to use the Service ceases. You may export your data for 30 days following termination, after which it will be deleted in accordance with our ',
                    { kind: 'link', text: 'Privacy Policy', href: '/privacy' },
                    '.',
                ],
            },
        ],
    },
    {
        kind: 'prose',
        heading: 'Governing Law',
        blocks: [
            {
                kind: 'p',
                content: [
                    "These Terms are governed by and construed in accordance with the laws of the People's Republic of Bangladesh. Any dispute arising from or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of Dhaka, Bangladesh. Nothing in this section limits any statutory consumer rights you may have under applicable Bangladeshi law.",
                ],
            },
        ],
    },
    // Section 11 — the tier-specific half, generated from PLAN_TERMS_ADDENDA.
    { kind: 'planAddenda' },
    {
        kind: 'prose',
        heading: 'Contact',
        blocks: [
            { kind: 'p', content: ['For questions about these Terms, please contact us:'] },
            {
                kind: 'contactCard',
                lines: [
                    [{ kind: 'strong', text: 'ERP71 Ltd.' }],
                    ['Dhaka, Bangladesh'],
                    ['Email: ', { kind: 'email', address: INFO_EMAIL }],
                ],
            },
        ],
    },
];

/** Position of the plan-addenda section, 1-based — i.e. "Section 11". */
export const PLAN_ADDENDA_SECTION_NUMBER =
    TERMS_SECTIONS.findIndex((section) => section.kind === 'planAddenda') + 1;
