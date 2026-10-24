/**
 * Pure planners for the CRM contact-identity backfill. No database: the rules
 * that decide inserts and null-column fills must be wrong here before a sync
 * script can write them.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const crmIdentityPlan = require('../../../../packages/database/prisma/crm-identity-plan.ts');
/* eslint-enable @typescript-eslint/no-var-requires */

const {
    organizationNameNorm,
    planContactNorms,
    planOrganizations,
    planLeadLinks,
} = crmIdentityPlan as {
    organizationNameNorm: (raw: string) => string;
    planContactNorms: (
        rows: any[],
        claimed: Set<string>,
    ) => { updates: { id: string; data: Record<string, string> }[]; collisions: number };
    planOrganizations: (
        contacts: any[],
        existing: { id: string; tenant_id: string; name_norm: string }[],
    ) => {
        inserts: { tenant_id: string; name: string; name_norm: string }[];
        links: { contactId: string; name_norm: string }[];
    };
    planLeadLinks: (
        leads: any[],
        contacts: any[],
    ) => {
        contactInserts: Record<string, unknown>[];
        leadLinks: Record<string, unknown>[];
        customerLinks: { contactId: string; customerId: string }[];
        nameMismatches: { leadId: string; contactId: string }[];
    };
};

const NORM_KEYS = ['mobile_norm', 'email_norm', 'linkedin_norm'];

const normRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    tenant_id: 't1',
    mobile: null,
    email: null,
    linkedin_url: null,
    mobile_norm: null,
    email_norm: null,
    linkedin_norm: null,
    created_at: '2020-01-01T00:00:00.000Z',
    ...over,
});

const orgContact = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    tenant_id: 't1',
    company: null as string | null,
    organization_id: null as string | null,
    created_at: '2020-01-01T00:00:00.000Z',
    ...over,
});

const leadRow = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    tenant_id: 't1',
    name: 'Karim',
    mobile: null,
    email: null,
    linkedin_url: null,
    address: null,
    contact_id: null,
    organization_id: null,
    converted_customer_id: null,
    created_at: '2020-01-01T00:00:00.000Z',
    ...over,
});

const contact = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    tenant_id: 't1',
    name: 'Karim',
    mobile: null,
    email: null,
    linkedin_url: null,
    address: null,
    mobile_norm: null,
    email_norm: null,
    linkedin_norm: null,
    organization_id: null,
    customer_id: null,
    created_at: '2019-01-01T00:00:00.000Z',
    ...over,
});

function expectOnlyNormKeys(updates: { data: Record<string, string> }[]) {
    for (const update of updates) {
        for (const key of Object.keys(update.data)) {
            expect(NORM_KEYS).toContain(key);
        }
        for (const value of Object.values(update.data)) {
            expect(typeof value).toBe('string');
            expect(value).not.toBe('');
        }
    }
}

describe('organizationNameNorm', () => {
    it('trims, lowercases, and collapses internal whitespace', () => {
        expect(organizationNameNorm(' Karim Traders ')).toBe('karim traders');
        expect(organizationNameNorm(' karim  traders ')).toBe('karim traders');
        expect(organizationNameNorm('Karim Traders Ltd')).toBe('karim traders ltd');
    });
});

describe('planContactNorms', () => {
    it('gives a contested mobile to the oldest contact and still fills every email', () => {
        // Same address on purpose: email_norm is not unique, so it must not count
        // as the collision. Rows are listed newest-first; created_at decides.
        const { updates, collisions } = planContactNorms(
            [
                normRow({
                    id: 'a-new',
                    mobile: '+8801712345678',
                    email: ' A@Shop.com ',
                    created_at: '2021-06-01T00:00:00.000Z',
                }),
                normRow({
                    id: 'z-old',
                    mobile: '01712-345678',
                    email: ' A@Shop.com ',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
            ],
            new Set(),
        );

        expect(updates).toEqual([
            { id: 'z-old', data: { mobile_norm: '+8801712345678', email_norm: 'a@shop.com' } },
            { id: 'a-new', data: { email_norm: 'a@shop.com' } },
        ]);
        expect(collisions).toBe(1);
        expectOnlyNormKeys(updates);
    });

    it('breaks a created_at tie by id', () => {
        const { updates, collisions } = planContactNorms(
            [
                normRow({ id: 'b', mobile: '01712-345678', created_at: '2020-01-01T00:00:00.000Z' }),
                normRow({ id: 'a', mobile: '+8801712345678', created_at: '2020-01-01T00:00:00.000Z' }),
            ],
            new Set(),
        );

        expect(updates).toEqual([{ id: 'a', data: { mobile_norm: '+8801712345678' } }]);
        expect(collisions).toBe(1);
    });

    it('counts a contested LinkedIn profile and does not treat email as claimed', () => {
        const { updates, collisions } = planContactNorms(
            [
                normRow({
                    id: 'old',
                    linkedin_url: 'https://www.LinkedIn.com/in/Jane-Doe/?utm_source=x',
                    email: 'info@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                normRow({
                    id: 'new',
                    linkedin_url: 'linkedin.com/in/jane-doe',
                    email: 'info@shop.com',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            new Set(['t1 email_norm info@shop.com']),
        );

        expect(updates).toEqual([
            {
                id: 'old',
                data: { email_norm: 'info@shop.com', linkedin_norm: 'linkedin.com/in/jane-doe' },
            },
            { id: 'new', data: { email_norm: 'info@shop.com' } },
        ]);
        expect(collisions).toBe(1);
        expectOnlyNormKeys(updates);
    });

    it('keeps tenants apart', () => {
        const { updates, collisions } = planContactNorms(
            [
                normRow({ id: 'a', tenant_id: 't1', mobile: '01712-345678' }),
                normRow({ id: 'b', tenant_id: 't2', mobile: '01712-345678' }),
            ],
            new Set(),
        );

        expect(updates).toEqual([
            { id: 'a', data: { mobile_norm: '+8801712345678' } },
            { id: 'b', data: { mobile_norm: '+8801712345678' } },
        ]);
        expect(collisions).toBe(0);
    });

    it('does not rewrite a norm that is already set, and blocks a later claim on it', () => {
        const { updates, collisions } = planContactNorms(
            [
                normRow({
                    id: 'kept',
                    mobile: '01712-345678',
                    mobile_norm: '+8801712345678',
                    email: 'kept@shop.com',
                    email_norm: 'kept@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                normRow({
                    id: 'later',
                    mobile: '+8801712345678',
                    email: 'later@shop.com',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            new Set(),
        );

        expect(updates).toEqual([{ id: 'later', data: { email_norm: 'later@shop.com' } }]);
        expect(collisions).toBe(1);
        expectOnlyNormKeys(updates);
    });

    it('leaves a value already claimed, and still fills a free email', () => {
        const { updates, collisions } = planContactNorms(
            [normRow({ mobile: '01712-345678', email: 'free@shop.com' })],
            new Set(['t1 mobile_norm +8801712345678']),
        );

        expect(updates).toEqual([{ id: 'c1', data: { email_norm: 'free@shop.com' } }]);
        expect(collisions).toBe(1);
    });

    it('is a no-op when every norm is already filled', () => {
        const { updates, collisions } = planContactNorms(
            [
                normRow({
                    mobile: '01712-345678',
                    email: 'a@shop.com',
                    linkedin_url: 'linkedin.com/in/jane-doe',
                    mobile_norm: '+8801712345678',
                    email_norm: 'a@shop.com',
                    linkedin_norm: 'linkedin.com/in/jane-doe',
                }),
            ],
            new Set(),
        );

        expect(updates).toEqual([]);
        expect(collisions).toBe(0);
    });
});

describe('planOrganizations', () => {
    it('makes one organization for spellings that share a name_norm', () => {
        const result = planOrganizations(
            [
                orgContact({
                    id: 'c1',
                    company: 'Karim Traders',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                orgContact({
                    id: 'c2',
                    company: ' karim traders ',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
                orgContact({
                    id: 'c3',
                    company: 'Karim Traders',
                    organization_id: 'org-existing',
                    created_at: '2020-03-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.inserts).toEqual([
            { tenant_id: 't1', name: 'Karim Traders', name_norm: 'karim traders' },
        ]);
        expect(result.links).toEqual([
            { contactId: 'c1', name_norm: 'karim traders' },
            { contactId: 'c2', name_norm: 'karim traders' },
        ]);
        for (const link of result.links) {
            expect(link).not.toHaveProperty('company');
        }
    });

    it('produces nothing for a blank company', () => {
        expect(
            planOrganizations(
                [
                    orgContact({ id: 'blank', company: '   ' }),
                    orgContact({ id: 'empty', company: '' }),
                    orgContact({ id: 'missing', company: null }),
                ],
                [],
            ),
        ).toEqual({ inserts: [], links: [] });
    });

    it('keeps the oldest contact spelling, even when it is not first in the list', () => {
        const result = planOrganizations(
            [
                orgContact({
                    id: 'newer',
                    company: ' karim traders ',
                    created_at: '2021-01-01T00:00:00.000Z',
                }),
                orgContact({
                    id: 'older',
                    company: ' Karim Traders ',
                    created_at: new Date('2020-01-01T00:00:00.000Z'),
                }),
            ],
            [],
        );

        expect(result.inserts).toEqual([
            { tenant_id: 't1', name: 'Karim Traders', name_norm: 'karim traders' },
        ]);
        expect(result.links).toEqual([
            { contactId: 'older', name_norm: 'karim traders' },
            { contactId: 'newer', name_norm: 'karim traders' },
        ]);
    });

    it('breaks an organization-name tie by contact id', () => {
        const result = planOrganizations(
            [
                orgContact({
                    id: 'b',
                    company: 'KARIM TRADERS',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                orgContact({
                    id: 'a',
                    company: 'Karim Traders',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.inserts).toEqual([
            { tenant_id: 't1', name: 'Karim Traders', name_norm: 'karim traders' },
        ]);
    });

    it('does not collapse a longer company name onto a shorter one', () => {
        const result = planOrganizations(
            [
                orgContact({ id: 'c1', company: 'Karim Traders', created_at: '2020-01-01T00:00:00.000Z' }),
                orgContact({
                    id: 'c2',
                    company: 'Karim Traders Ltd',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.inserts).toEqual([
            { tenant_id: 't1', name: 'Karim Traders', name_norm: 'karim traders' },
            { tenant_id: 't1', name: 'Karim Traders Ltd', name_norm: 'karim traders ltd' },
        ]);
        expect(result.links).toEqual([
            { contactId: 'c1', name_norm: 'karim traders' },
            { contactId: 'c2', name_norm: 'karim traders ltd' },
        ]);
    });

    it('does not insert an organization whose name_norm already exists', () => {
        const result = planOrganizations(
            [
                orgContact({ id: 'c1', company: 'Karim Traders' }),
                orgContact({
                    id: 'c2',
                    company: ' karim traders ',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [{ id: 'org-1', tenant_id: 't1', name_norm: 'karim traders' }],
        );

        expect(result.inserts).toEqual([]);
        expect(result.links).toEqual([
            { contactId: 'c1', name_norm: 'karim traders' },
            { contactId: 'c2', name_norm: 'karim traders' },
        ]);
    });

    it('keeps the same spelling in two tenants as two organizations', () => {
        const result = planOrganizations(
            [
                orgContact({ id: 'a', tenant_id: 't1', company: 'Karim Traders' }),
                orgContact({ id: 'b', tenant_id: 't2', company: 'karim traders' }),
            ],
            [],
        );

        expect(result.inserts).toEqual([
            { tenant_id: 't1', name: 'Karim Traders', name_norm: 'karim traders' },
            { tenant_id: 't2', name: 'karim traders', name_norm: 'karim traders' },
        ]);
        expect(result.links).toHaveLength(2);
    });
});

describe('planLeadLinks', () => {
    it('copies one contact from the oldest lead when two leads share a mobile', () => {
        // Newest lead is listed first. Its email must stay off the new contact.
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l-new',
                    name: 'Karim Uddin',
                    mobile: '+8801712345678',
                    email: 'other@shop.com',
                    address: 'Chittagong',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l-old',
                    name: 'Karim',
                    mobile: '01712-345678',
                    email: 'Karim@Shop.com',
                    address: 'Dhaka',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.contactInserts).toEqual([
            {
                key: 'lead:l-old',
                fromLeadId: 'l-old',
                tenant_id: 't1',
                name: 'Karim',
                mobile: '01712-345678',
                email: 'Karim@Shop.com',
                linkedin_url: null,
                address: 'Dhaka',
                mobile_norm: '+8801712345678',
                email_norm: 'karim@shop.com',
                linkedin_norm: null,
            },
        ]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l-old', contactKey: 'lead:l-old', organizationId: null },
            { leadId: 'l-new', contactKey: 'lead:l-old', organizationId: null },
        ]);
        expect(result.customerLinks).toEqual([]);
        expect(result.nameMismatches).toEqual([]);
    });

    it('uses lead id when created_at ties', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'b',
                    name: 'Newer',
                    mobile: '+8801712345678',
                    email: 'b@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'a',
                    name: 'Older',
                    mobile: '01712-345678',
                    email: 'a@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.contactInserts).toEqual([
            expect.objectContaining({ key: 'lead:a', fromLeadId: 'a', name: 'Older', email: 'a@shop.com' }),
        ]);
        expect(result.leadLinks.map((link) => link.leadId)).toEqual(['a', 'b']);
    });

    it('creates two contacts when leads share only an email', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Karim',
                    email: 'info@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    name: 'Rahim',
                    email: 'info@shop.com',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.contactInserts).toEqual([
            {
                key: 'lead:l1',
                fromLeadId: 'l1',
                tenant_id: 't1',
                name: 'Karim',
                mobile: null,
                email: 'info@shop.com',
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: 'info@shop.com',
                linkedin_norm: null,
            },
            {
                key: 'lead:l2',
                fromLeadId: 'l2',
                tenant_id: 't1',
                name: 'Rahim',
                mobile: null,
                email: 'info@shop.com',
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: 'info@shop.com',
                linkedin_norm: null,
            },
        ]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactKey: 'lead:l1', organizationId: null },
            { leadId: 'l2', contactKey: 'lead:l2', organizationId: null },
        ]);
        expect(result.nameMismatches).toEqual([]);
    });

    it('stores null for a mobile that does not normalize, and does not join those leads', () => {
        // `N/A`, `-`, `call`, and blanks are not a person. Postgres allows many
        // NULL mobiles but only one of any other raw string, so copying the junk
        // onto two new contacts would throw when the sync inserts them.
        const existing = contact({
            id: 'c-junk',
            name: 'Old Card',
            mobile: 'N/A',
            mobile_norm: null,
        });
        const before = { ...existing };
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Karim',
                    mobile: 'N/A',
                    email: 'karim@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    name: 'Rahim',
                    mobile: 'N/A',
                    email: 'rahim@shop.com',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l3',
                    name: 'Dash',
                    mobile: '-',
                    created_at: '2020-03-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l4',
                    name: 'Call',
                    mobile: 'call',
                    created_at: '2020-04-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l5',
                    name: 'Empty',
                    mobile: '',
                    created_at: '2020-05-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l6',
                    name: 'Spaces',
                    mobile: '   ',
                    created_at: '2020-06-01T00:00:00.000Z',
                }),
            ],
            [existing],
        );

        expect(existing).toEqual(before);
        expect(result.contactInserts).toEqual([
            {
                key: 'lead:l1',
                fromLeadId: 'l1',
                tenant_id: 't1',
                name: 'Karim',
                mobile: null,
                email: 'karim@shop.com',
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: 'karim@shop.com',
                linkedin_norm: null,
            },
            {
                key: 'lead:l2',
                fromLeadId: 'l2',
                tenant_id: 't1',
                name: 'Rahim',
                mobile: null,
                email: 'rahim@shop.com',
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: 'rahim@shop.com',
                linkedin_norm: null,
            },
            {
                key: 'lead:l3',
                fromLeadId: 'l3',
                tenant_id: 't1',
                name: 'Dash',
                mobile: null,
                email: null,
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: null,
                linkedin_norm: null,
            },
            {
                key: 'lead:l4',
                fromLeadId: 'l4',
                tenant_id: 't1',
                name: 'Call',
                mobile: null,
                email: null,
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: null,
                linkedin_norm: null,
            },
            {
                key: 'lead:l5',
                fromLeadId: 'l5',
                tenant_id: 't1',
                name: 'Empty',
                mobile: null,
                email: null,
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: null,
                linkedin_norm: null,
            },
            {
                key: 'lead:l6',
                fromLeadId: 'l6',
                tenant_id: 't1',
                name: 'Spaces',
                mobile: null,
                email: null,
                linkedin_url: null,
                address: null,
                mobile_norm: null,
                email_norm: null,
                linkedin_norm: null,
            },
        ]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactKey: 'lead:l1', organizationId: null },
            { leadId: 'l2', contactKey: 'lead:l2', organizationId: null },
            { leadId: 'l3', contactKey: 'lead:l3', organizationId: null },
            { leadId: 'l4', contactKey: 'lead:l4', organizationId: null },
            { leadId: 'l5', contactKey: 'lead:l5', organizationId: null },
            { leadId: 'l6', contactKey: 'lead:l6', organizationId: null },
        ]);
        expect(result.customerLinks).toEqual([]);
        expect(result.nameMismatches).toEqual([]);
    });

    it('does not match an existing contact by email alone', () => {
        const existing = contact({ id: 'c1', email: 'info@shop.com', name: 'Shop' });
        const result = planLeadLinks(
            [leadRow({ id: 'l1', name: 'Someone', email: 'info@shop.com' })],
            [existing],
        );

        expect(result.contactInserts).toHaveLength(1);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactKey: 'lead:l1', organizationId: null },
        ]);
        expect(result.nameMismatches).toEqual([]);
        expect(existing.email).toBe('info@shop.com');
    });

    it('links a lead to the raw mobile of a contact whose norm is null', () => {
        const existing = contact({
            id: 'c1',
            name: 'Karim',
            mobile: '+8801712345678',
            mobile_norm: null,
        });
        const before = { ...existing };
        const result = planLeadLinks(
            [leadRow({ id: 'l1', name: ' Karim ', mobile: '01712-345678' })],
            [existing],
        );

        expect(existing).toEqual(before);
        expect(result).toEqual({
            contactInserts: [],
            leadLinks: [{ leadId: 'l1', contactId: 'c1', organizationId: null }],
            customerLinks: [],
            nameMismatches: [],
        });
    });

    it('records a name mismatch and does not change the contact', () => {
        const existing = contact({
            id: 'c1',
            name: 'Karim',
            mobile: '+8801712345678',
            mobile_norm: null,
            email: 'old@shop.com',
            company: 'Karim Traders',
        });
        const before = { ...existing };
        const result = planLeadLinks(
            [leadRow({ id: 'l1', name: 'Rahim', mobile: '01712-345678', email: 'new@shop.com', status: 'NEW' })],
            [existing],
        );

        expect(existing).toEqual(before);
        expect(result).toEqual({
            contactInserts: [],
            leadLinks: [{ leadId: 'l1', contactId: 'c1', organizationId: null }],
            customerLinks: [],
            nameMismatches: [{ leadId: 'l1', contactId: 'c1' }],
        });
        expect(result.leadLinks[0]).not.toHaveProperty('name');
        expect(result.leadLinks[0]).not.toHaveProperty('email');
        expect(result.leadLinks[0]).not.toHaveProperty('mobile');
        expect(result.leadLinks[0]).not.toHaveProperty('company');
        expect(result.leadLinks[0]).not.toHaveProperty('status');
    });

    it('links to the oldest contact when two raw mobiles normalize together', () => {
        const result = planLeadLinks(
            [leadRow({ id: 'l1', mobile: '01712345678', name: 'Lead' })],
            [
                contact({
                    id: 'c-new',
                    name: 'Newer',
                    mobile: '+8801712345678',
                    mobile_norm: null,
                    created_at: '2021-01-01T00:00:00.000Z',
                }),
                contact({
                    id: 'c-old',
                    name: 'Lead',
                    mobile: '01712-345678',
                    mobile_norm: null,
                    created_at: '2019-01-01T00:00:00.000Z',
                }),
            ],
        );

        expect(result.contactInserts).toEqual([]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c-old', organizationId: null },
        ]);
        expect(result.nameMismatches).toEqual([]);
    });

    it('matches a stored mobile_norm when the raw mobile does not normalize to it', () => {
        const result = planLeadLinks(
            [leadRow({ id: 'l1', mobile: '01712-345678', name: 'Karim' })],
            [
                contact({
                    id: 'c1',
                    name: 'Karim',
                    mobile: '01999999999',
                    mobile_norm: '+8801712345678',
                }),
            ],
        );

        expect(result.contactInserts).toEqual([]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c1', organizationId: null },
        ]);
    });

    it('matches LinkedIn from the raw profile when the lead has no mobile', () => {
        const result = planLeadLinks(
            [leadRow({ id: 'l1', mobile: null, linkedin_url: 'linkedin.com/in/jane-doe', name: 'Jane Doe' })],
            [
                contact({
                    id: 'c1',
                    name: 'Jane Doe',
                    mobile: null,
                    linkedin_url: 'https://www.LinkedIn.com/in/Jane-Doe/?utm_source=x',
                    linkedin_norm: null,
                }),
            ],
        );

        expect(result).toEqual({
            contactInserts: [],
            leadLinks: [{ leadId: 'l1', contactId: 'c1', organizationId: null }],
            customerLinks: [],
            nameMismatches: [],
        });
    });

    it('reuses a planned contact for a later lead that shares its LinkedIn', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Jane',
                    mobile: '01712-345678',
                    linkedin_url: 'linkedin.com/in/jane-doe',
                    email: 'jane@shop.com',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    name: 'Jane Doe',
                    mobile: null,
                    linkedin_url: 'https://www.LinkedIn.com/in/Jane-Doe/',
                    email: 'other@shop.com',
                    created_at: '2020-03-01T00:00:00.000Z',
                }),
            ],
            [],
        );

        expect(result.contactInserts).toHaveLength(1);
        expect(result.contactInserts[0]).toEqual(
            expect.objectContaining({
                key: 'lead:l1',
                fromLeadId: 'l1',
                mobile: '01712-345678',
                linkedin_url: 'linkedin.com/in/jane-doe',
                mobile_norm: '+8801712345678',
                linkedin_norm: 'linkedin.com/in/jane-doe',
            }),
        );
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactKey: 'lead:l1', organizationId: null },
            { leadId: 'l2', contactKey: 'lead:l1', organizationId: null },
        ]);
    });

    it('prefers mobile over LinkedIn when they point at different contacts', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Mobile Person',
                    mobile: '01712-345678',
                    linkedin_url: 'linkedin.com/in/jane-doe',
                }),
            ],
            [
                contact({ id: 'by-mobile', name: 'Mobile Person', mobile: '+8801712345678' }),
                contact({
                    id: 'by-linkedin',
                    name: 'Jane',
                    mobile: null,
                    linkedin_url: 'linkedin.com/in/jane-doe',
                    created_at: '2018-01-01T00:00:00.000Z',
                }),
            ],
        );

        expect(result.contactInserts).toEqual([]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'by-mobile', organizationId: null },
        ]);
    });

    it('does not insert a second contact when the mobile is new but the LinkedIn is taken', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Jane Doe',
                    mobile: '01819-000000',
                    linkedin_url: 'linkedin.com/in/jane-doe',
                }),
            ],
            [
                contact({
                    id: 'c1',
                    name: 'Jane Doe',
                    mobile: null,
                    linkedin_url: 'https://linkedin.com/in/jane-doe',
                    linkedin_norm: null,
                }),
            ],
        );

        expect(result.contactInserts).toEqual([]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c1', organizationId: null },
        ]);
    });

    it('returns nothing for a lead that already has a contact', () => {
        const existing = contact({
            id: 'c1',
            name: 'Karim',
            mobile: '+8801712345678',
        });
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    name: 'Rahim',
                    mobile: '01712-345678',
                    email: 'rahim@shop.com',
                    contact_id: 'c1',
                    organization_id: null,
                    converted_customer_id: null,
                }),
            ],
            [existing],
        );

        expect(result).toEqual({
            contactInserts: [],
            leadLinks: [],
            customerLinks: [],
            nameMismatches: [],
        });
    });

    it('copies the contact organization only when the lead does not already have one', () => {
        const withOrg = planLeadLinks(
            [leadRow({ id: 'l1', mobile: '01712-345678', organization_id: null })],
            [contact({ id: 'c1', mobile: '+8801712345678', organization_id: 'org-1', name: 'Karim' })],
        );
        expect(withOrg.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c1', organizationId: 'org-1' },
        ]);

        const leadAlready = planLeadLinks(
            [leadRow({ id: 'l1', mobile: '01712-345678', organization_id: 'org-lead' })],
            [contact({ id: 'c1', mobile: '+8801712345678', organization_id: 'org-1', name: 'Karim' })],
        );
        expect(leadAlready.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c1', organizationId: null },
        ]);
    });

    it('does not link a lead to a contact in another tenant', () => {
        const result = planLeadLinks(
            [leadRow({ id: 'l1', tenant_id: 't2', mobile: '01712-345678' })],
            [contact({ id: 'c1', tenant_id: 't1', mobile: '+8801712345678', name: 'Karim' })],
        );

        expect(result.contactInserts).toEqual([
            expect.objectContaining({ key: 'lead:l1', tenant_id: 't2', fromLeadId: 'l1' }),
        ]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactKey: 'lead:l1', organizationId: null },
        ]);
    });

    it('sets no customer when converted leads name two customers', () => {
        const existing = contact({
            id: 'c1',
            mobile: '+8801712345678',
            customer_id: null,
            name: 'Karim',
        });
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    mobile: '01712-345678',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    mobile: '01712345678',
                    converted_customer_id: 'cust-b',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [existing],
        );

        expect(existing.customer_id).toBeNull();
        expect(result.contactInserts).toEqual([]);
        expect(result.customerLinks).toEqual([]);
        expect(result.leadLinks).toEqual([
            { leadId: 'l1', contactId: 'c1', organizationId: null },
            { leadId: 'l2', contactId: 'c1', organizationId: null },
        ]);
    });

    it('sets the customer when every converted lead names the same one', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    mobile: '01712-345678',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    mobile: '+8801712345678',
                    converted_customer_id: null,
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l3',
                    mobile: '01712345678',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-03-01T00:00:00.000Z',
                }),
            ],
            [contact({ id: 'c1', mobile: '+8801712345678', customer_id: null, name: 'Karim' })],
        );

        expect(result.customerLinks).toEqual([{ contactId: 'c1', customerId: 'cust-a' }]);
        expect(result.contactInserts).toEqual([]);
    });

    it('does not set a customer that is already on the contact', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    mobile: '01712-345678',
                    converted_customer_id: 'cust-a',
                }),
                leadRow({
                    id: 'l2',
                    mobile: '01712345678',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [contact({ id: 'c1', mobile: '+8801712345678', customer_id: 'cust-a', name: 'Karim' })],
        );

        expect(result.customerLinks).toEqual([]);
    });

    it('counts an already-linked lead when converted customers disagree', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'already',
                    contact_id: 'c1',
                    converted_customer_id: 'cust-a',
                    mobile: null,
                }),
                leadRow({
                    id: 'joining',
                    mobile: '01712-345678',
                    converted_customer_id: 'cust-b',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [contact({ id: 'c1', mobile: '+8801712345678', customer_id: null, name: 'Karim' })],
        );

        expect(result.leadLinks).toEqual([
            { leadId: 'joining', contactId: 'c1', organizationId: null },
        ]);
        expect(result.customerLinks).toEqual([]);
        expect(result.nameMismatches).toEqual([]);
    });

    it('still fills customer_id from leads that were linked on an earlier run', () => {
        const result = planLeadLinks(
            [
                leadRow({
                    id: 'l1',
                    contact_id: 'c1',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-01-01T00:00:00.000Z',
                }),
                leadRow({
                    id: 'l2',
                    contact_id: 'c1',
                    converted_customer_id: 'cust-a',
                    created_at: '2020-02-01T00:00:00.000Z',
                }),
            ],
            [contact({ id: 'c1', customer_id: null, name: 'Karim' })],
        );

        expect(result.leadLinks).toEqual([]);
        expect(result.contactInserts).toEqual([]);
        expect(result.nameMismatches).toEqual([]);
        expect(result.customerLinks).toEqual([{ contactId: 'c1', customerId: 'cust-a' }]);
    });
});
