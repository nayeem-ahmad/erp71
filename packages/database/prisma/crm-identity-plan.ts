/**
 * Pure decisions for the CRM contact-identity backfill. Sync scripts apply the
 * result; nothing here touches Prisma or an existing row's display columns.
 *
 * Mobile and LinkedIn identify a person. Email never does. `mobile_norm` and
 * `linkedin_norm` are unique per tenant, so a contested value stays on the
 * oldest contact and the later one keeps a null norm. `email_norm` is not
 * unique and is filled on every contact that has an email.
 *
 * Callers pass rows oldest-first or not; ordering is `created_at`, then `id`.
 * `claimed` is mutated. Seed it with norms already stored, including pages
 * already walked, the same way `planBackfill` does (`${tenant} ${field} ${value}`).
 */

import { normalizeLeadEmail, normalizeLeadMobile, normalizeProfileUrl } from '@erp71/shared-types';

export interface ContactNormRow {
    id: string;
    tenant_id: string;
    mobile?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    mobile_norm?: string | null;
    email_norm?: string | null;
    linkedin_norm?: string | null;
    created_at?: string | Date | null;
}

export interface OrganizationContactRow {
    id: string;
    tenant_id: string;
    company?: string | null;
    organization_id?: string | null;
    created_at?: string | Date | null;
}

export interface ExistingOrganization {
    id: string;
    tenant_id: string;
    name_norm: string;
}

export interface LeadLinkRow {
    id: string;
    tenant_id: string;
    name: string;
    mobile?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    address?: string | null;
    contact_id?: string | null;
    organization_id?: string | null;
    converted_customer_id?: string | null;
    created_at?: string | Date | null;
}

export interface ContactLinkRow {
    id: string;
    tenant_id: string;
    name: string;
    mobile?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    address?: string | null;
    mobile_norm?: string | null;
    email_norm?: string | null;
    linkedin_norm?: string | null;
    organization_id?: string | null;
    customer_id?: string | null;
    created_at?: string | Date | null;
}

type NormField = 'mobile_norm' | 'email_norm' | 'linkedin_norm';

const NORM_FIELDS: NormField[] = ['mobile_norm', 'email_norm', 'linkedin_norm'];
const UNIQUE_NORM_FIELDS: Exclude<NormField, 'email_norm'>[] = ['mobile_norm', 'linkedin_norm'];

interface AgeSortable {
    id: string;
    created_at?: string | Date | null;
}

interface ContactInsert {
    key: string;
    fromLeadId: string;
    tenant_id: string;
    name: string;
    mobile: string | null;
    email: string | null;
    linkedin_url: string | null;
    address: string | null;
    mobile_norm: string | null;
    email_norm: string | null;
    linkedin_norm: string | null;
}

interface Candidate {
    id: string;
    name: string;
    created_at?: string | Date | null;
    organization_id: string | null;
    contactId?: string;
    contactKey?: string;
}

/** Trim, lowercase, and collapse internal whitespace to one space. */
export function organizationNameNorm(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function createdAtMillis(value: string | Date | null | undefined): number {
    if (value == null) return Number.POSITIVE_INFINITY;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareCreatedAtThenId(a: AgeSortable, b: AgeSortable): number {
    const byTime = createdAtMillis(a.created_at) - createdAtMillis(b.created_at);
    if (byTime !== 0) return byTime;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
}

function claimKey(tenantId: string, field: NormField, value: string): string {
    return `${tenantId} ${field} ${value}`;
}

function derivedNorms(row: {
    mobile?: unknown;
    email?: unknown;
    linkedin_url?: unknown;
}): Record<NormField, string | null> {
    return {
        mobile_norm: normalizeLeadMobile(row.mobile),
        email_norm: normalizeLeadEmail(row.email),
        linkedin_norm: normalizeProfileUrl(row.linkedin_url),
    };
}

/**
 * Fills null contact norm columns. A mobile or LinkedIn value already in
 * `claimed` — or already stored on any row — is not written again.
 */
export function planContactNorms(rows: ContactNormRow[], claimed: Set<string>) {
    for (const row of rows) {
        for (const field of UNIQUE_NORM_FIELDS) {
            const stored = row[field];
            if (stored != null && stored !== '') claimed.add(claimKey(row.tenant_id, field, stored));
        }
    }

    const updates: { id: string; data: Partial<Record<NormField, string>> }[] = [];
    let collisions = 0;

    for (const row of [...rows].sort(compareCreatedAtThenId)) {
        const derived = derivedNorms(row);
        const data: Partial<Record<NormField, string>> = {};

        for (const field of NORM_FIELDS) {
            if (row[field] != null && row[field] !== '') continue;

            const value = derived[field];
            if (value == null) continue;

            // Shared inboxes are allowed. Only mobile and LinkedIn take a slot.
            if (field === 'email_norm') {
                data.email_norm = value;
                continue;
            }

            const key = claimKey(row.tenant_id, field, value);
            if (claimed.has(key)) {
                collisions++;
                continue;
            }
            claimed.add(key);
            data[field] = value;
        }

        if (Object.keys(data).length) updates.push({ id: row.id, data });
    }

    return { updates, collisions };
}

function companyNorm(company: string | null | undefined): string | null {
    if (company == null) return null;
    const norm = organizationNameNorm(company);
    return norm || null;
}

/**
 * One organization per tenant plus `name_norm`. `name` keeps the oldest
 * contact's trimmed `company` spelling. Links never carry `company`, and a
 * contact that already has `organization_id` is left alone.
 */
export function planOrganizations(contacts: OrganizationContactRow[], existing: ExistingOrganization[]) {
    const have = new Set(existing.map((org) => `${org.tenant_id}\0${org.name_norm}`));
    const ordered = [...contacts].sort(compareCreatedAtThenId);

    const groups = new Map<string, { tenant_id: string; name: string; name_norm: string }>();
    for (const row of ordered) {
        const nameNorm = companyNorm(row.company);
        if (!nameNorm) continue;
        const key = `${row.tenant_id}\0${nameNorm}`;
        if (groups.has(key)) continue;
        groups.set(key, { tenant_id: row.tenant_id, name: row.company!.trim(), name_norm: nameNorm });
    }

    const inserts: { tenant_id: string; name: string; name_norm: string }[] = [];
    for (const [key, group] of groups) {
        if (have.has(key)) continue;
        inserts.push(group);
    }

    const links: { contactId: string; name_norm: string }[] = [];
    for (const row of ordered) {
        const nameNorm = companyNorm(row.company);
        if (!nameNorm) continue;
        if (row.organization_id != null && row.organization_id !== '') continue;
        links.push({ contactId: row.id, name_norm: nameNorm });
    }

    return { inserts, links };
}

function bucketKey(tenantId: string, value: string): string {
    return `${tenantId}\0${value}`;
}

function addCandidate(index: Map<string, Candidate[]>, key: string, candidate: Candidate) {
    const list = index.get(key);
    if (list) list.push(candidate);
    else index.set(key, [candidate]);
}

function indexMobile(
    index: Map<string, Candidate[]>,
    candidate: Candidate,
    tenantId: string,
    mobile: string | null | undefined,
    mobileNorm: string | null | undefined,
) {
    const values = new Set<string>();
    if (mobileNorm) values.add(mobileNorm);
    const derived = normalizeLeadMobile(mobile);
    if (derived) values.add(derived);
    for (const value of values) addCandidate(index, bucketKey(tenantId, value), candidate);
}

function indexLinkedin(
    index: Map<string, Candidate[]>,
    candidate: Candidate,
    tenantId: string,
    linkedinUrl: string | null | undefined,
    linkedinNorm: string | null | undefined,
) {
    const values = new Set<string>();
    if (linkedinNorm) values.add(linkedinNorm);
    const derived = normalizeProfileUrl(linkedinUrl);
    if (derived) values.add(derived);
    for (const value of values) addCandidate(index, bucketKey(tenantId, value), candidate);
}

function oldestCandidate(list: Candidate[] | undefined): Candidate | null {
    if (!list || list.length === 0) return null;
    return list.reduce((best, candidate) =>
        compareCreatedAtThenId(candidate, best) < 0 ? candidate : best,
    );
}

function findPerson(
    lead: LeadLinkRow,
    byMobile: Map<string, Candidate[]>,
    byLinkedin: Map<string, Candidate[]>,
): Candidate | null {
    const mobileNorm = normalizeLeadMobile(lead.mobile);
    const linkedinNorm = normalizeProfileUrl(lead.linkedin_url);

    // Mobile wins when both are present, including a contact inserted earlier
    // in this run. LinkedIn is the fallback so a taken profile is not inserted again.
    if (mobileNorm) {
        const found = oldestCandidate(byMobile.get(bucketKey(lead.tenant_id, mobileNorm)));
        if (found) return found;
    }
    if (linkedinNorm) {
        const found = oldestCandidate(byLinkedin.get(bucketKey(lead.tenant_id, linkedinNorm)));
        if (found) return found;
    }
    return null;
}

function namesDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a ?? '').trim() !== (b ?? '').trim();
}

/**
 * `organizationId` null means "write nothing": the lead already has one, or
 * the contact has none. A new contact has none; organization sync runs apart.
 */
function organizationIdFor(lead: LeadLinkRow, organizationId: string | null): string | null {
    if (lead.organization_id != null && lead.organization_id !== '') return null;
    return organizationId;
}

function noteCustomer(
    byContact: Map<string, Set<string>>,
    contactId: string | null | undefined,
    customerId: string | null | undefined,
) {
    if (contactId == null || contactId === '' || customerId == null || customerId === '') return;
    const ids = byContact.get(contactId);
    if (ids) ids.add(customerId);
    else byContact.set(contactId, new Set([customerId]));
}

/**
 * Links each lead that has no `contact_id` to the oldest contact with the same
 * normalized mobile, otherwise the same LinkedIn profile. Email is not a key.
 * Otherwise one contact is copied from that lead and is visible to later leads
 * in this run. Nothing here updates an existing contact's name, email, mobile,
 * or company — a trimmed name difference is only recorded.
 */
export function planLeadLinks(leads: LeadLinkRow[], contacts: ContactLinkRow[]) {
    const byMobile = new Map<string, Candidate[]>();
    const byLinkedin = new Map<string, Candidate[]>();

    for (const row of contacts) {
        const candidate: Candidate = {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
            organization_id: row.organization_id || null,
            contactId: row.id,
        };
        indexMobile(byMobile, candidate, row.tenant_id, row.mobile, row.mobile_norm);
        indexLinkedin(byLinkedin, candidate, row.tenant_id, row.linkedin_url, row.linkedin_norm);
    }

    const contactInserts: ContactInsert[] = [];
    const leadLinks: {
        leadId: string;
        contactId?: string;
        contactKey?: string;
        organizationId: string | null;
    }[] = [];
    const nameMismatches: { leadId: string; contactId: string }[] = [];
    const customersByContact = new Map<string, Set<string>>();

    for (const row of leads) {
        if (row.contact_id) noteCustomer(customersByContact, row.contact_id, row.converted_customer_id);
    }

    for (const row of [...leads].sort(compareCreatedAtThenId)) {
        if (row.contact_id) continue;

        const found = findPerson(row, byMobile, byLinkedin);
        if (found) {
            if (found.contactId) {
                leadLinks.push({
                    leadId: row.id,
                    contactId: found.contactId,
                    organizationId: organizationIdFor(row, found.organization_id),
                });
                if (namesDiffer(row.name, found.name)) {
                    nameMismatches.push({ leadId: row.id, contactId: found.contactId });
                }
                noteCustomer(customersByContact, found.contactId, row.converted_customer_id);
            } else if (found.contactKey) {
                leadLinks.push({
                    leadId: row.id,
                    contactKey: found.contactKey,
                    organizationId: organizationIdFor(row, null),
                });
            }
            continue;
        }

        const mobileNorm = normalizeLeadMobile(row.mobile);
        const emailNorm = normalizeLeadEmail(row.email);
        const linkedinNorm = normalizeProfileUrl(row.linkedin_url);
        const key = `lead:${row.id}`;
        const insert: ContactInsert = {
            key,
            fromLeadId: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            mobile: row.mobile ?? null,
            email: row.email ?? null,
            linkedin_url: row.linkedin_url ?? null,
            address: row.address ?? null,
            mobile_norm: mobileNorm,
            email_norm: emailNorm,
            linkedin_norm: linkedinNorm,
        };
        contactInserts.push(insert);

        const candidate: Candidate = {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
            organization_id: null,
            contactKey: key,
        };
        indexMobile(byMobile, candidate, row.tenant_id, row.mobile, mobileNorm);
        indexLinkedin(byLinkedin, candidate, row.tenant_id, row.linkedin_url, linkedinNorm);
        leadLinks.push({
            leadId: row.id,
            contactKey: key,
            organizationId: organizationIdFor(row, null),
        });
    }

    const customerLinks: { contactId: string; customerId: string }[] = [];
    for (const row of [...contacts].sort(compareCreatedAtThenId)) {
        if (row.customer_id != null && row.customer_id !== '') continue;
        const ids = customersByContact.get(row.id);
        if (!ids || ids.size !== 1) continue;
        customerLinks.push({ contactId: row.id, customerId: [...ids][0] });
    }

    return { contactInserts, leadLinks, customerLinks, nameMismatches };
}
