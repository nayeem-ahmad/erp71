/**
 * Links every lead to a contact, inserting one when mobile and LinkedIn match
 * nobody, and fills null `CrmContact.customer_id` when converted leads agree.
 *
 * Why this exists
 * ---------------
 * A lead may have a null `contact_id` only before this backfill has seen it.
 * After it, every existing lead points at a person: the oldest contact with
 * that normalized mobile, otherwise that LinkedIn profile, otherwise a new
 * contact copied from the lead. Email is not a key. Two leads that share only
 * an email become two contacts.
 *
 * What a write may contain
 * ------------------------
 * A new contact is inserted with the planner's copy (name, mobile, email,
 * LinkedIn, address) and its three norms in that same insert. A mobile the
 * planner set to null stays null, so `N/A` and blanks do not collide on the
 * raw mobile unique. A lead update is only `{ contact_id, organization_id? }`.
 * `organization_id` is omitted when the planner passed null — the lead already
 * has one, or the contact has none — and null is never written over a column
 * that is already set. A contact update is only `{ customer_id }`.
 *
 * `planLeadLinks` emits `customerLinks` only for contacts it was given. After
 * the inserts, this script calls it again with those new ids and the leads'
 * `contact_id` set in memory, then applies that second list. A converted lead's
 * new contact does not wait for the next boot to receive `customer_id`.
 *
 * The source lead's `contact_id` commits in the same transaction as the insert.
 * A contact with no mobile and no LinkedIn cannot be found on a re-run, so an
 * insert that survived without that link would be orphaned and the next
 * prepare would insert another. Sibling leads that share a mobile are updated
 * afterwards: the next prepare can still find that contact.
 *
 * Rows are read oldest-`created_at`-then-`id`, in pages, then planned together.
 * Oldest-wins, and "two converted customers means leave `customer_id` null",
 * are not visible inside one page.
 *
 * Usage:
 *   npx tsx prisma/sync-lead-contacts.ts --dry-run
 *   npx tsx prisma/sync-lead-contacts.ts --tenant=<uuid>
 *   npx tsx prisma/sync-lead-contacts.ts
 */

import { PrismaClient } from '@prisma/client';
import { planLeadLinks, type ContactLinkRow, type LeadLinkRow } from './crm-identity-plan';

const prisma = new PrismaClient();

const PAGE_SIZE = 2000;

type LeadPlan = ReturnType<typeof planLeadLinks>;
type ContactInsert = LeadPlan['contactInserts'][number];
type LeadLink = LeadPlan['leadLinks'][number];

function scriptOptions(argv: string[]) {
    const dryRun = argv.includes('--dry-run');
    const tenantId = argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
    const where = tenantId ? { tenant_id: tenantId } : {};
    return { dryRun, where };
}

async function loadPages<T extends { id: string }>(
    load: (cursor: string | undefined) => Promise<T[]>,
): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page = await load(cursor);
        if (page.length === 0) break;
        rows.push(...page);
        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

/**
 * `organizationId` null means write nothing. The lead already has an
 * organization, or the contact has none. Never write null over either.
 */
export function leadLinkData(
    contactId: string,
    organizationId: string | null,
): { contact_id: string; organization_id?: string } {
    const data: { contact_id: string; organization_id?: string } = { contact_id: contactId };
    if (organizationId != null) data.organization_id = organizationId;
    return data;
}

function contactInsertData(insert: ContactInsert) {
    return {
        tenant_id: insert.tenant_id,
        name: insert.name,
        mobile: insert.mobile,
        email: insert.email,
        linkedin_url: insert.linkedin_url,
        address: insert.address,
        mobile_norm: insert.mobile_norm,
        email_norm: insert.email_norm,
        linkedin_norm: insert.linkedin_norm,
    };
}

function linksByContactKey(links: LeadLink[]): Map<string, LeadLink[]> {
    const byKey = new Map<string, LeadLink[]>();
    for (const link of links) {
        if (!link.contactKey) continue;
        const list = byKey.get(link.contactKey);
        if (list) list.push(link);
        else byKey.set(link.contactKey, [link]);
    }
    return byKey;
}

/** Refuse a plan we cannot apply, before any insert, so a bad link does not orphan a row. */
export function assertPlanIsApplicable(plan: LeadPlan) {
    const byKey = linksByContactKey(plan.leadLinks);
    const insertKeys = new Set(plan.contactInserts.map((insert) => insert.key));

    for (const insert of plan.contactInserts) {
        const links = byKey.get(insert.key) ?? [];
        if (!links.some((link) => link.leadId === insert.fromLeadId)) {
            throw new Error(
                `sync-lead-contacts: insert ${insert.key} does not link lead ${insert.fromLeadId}`,
            );
        }
    }
    for (const link of plan.leadLinks) {
        if (link.contactId) continue;
        if (!link.contactKey || !insertKeys.has(link.contactKey)) {
            throw new Error(`sync-lead-contacts: lead ${link.leadId} does not resolve to a contact`);
        }
    }
}

async function writeLeadLinks(plan: LeadPlan): Promise<Map<string, string>> {
    const contactIds = new Map<string, string>();
    const byKey = linksByContactKey(plan.leadLinks);

    for (const insert of plan.contactInserts) {
        const links = byKey.get(insert.key) ?? [];
        const source = links.find((link) => link.leadId === insert.fromLeadId);
        if (!source) {
            throw new Error(
                `sync-lead-contacts: insert ${insert.key} does not link lead ${insert.fromLeadId}`,
            );
        }

        const createdId = await prisma.$transaction(
            async (tx) => {
                const created = await tx.crmContact.create({
                    data: contactInsertData(insert),
                    select: { id: true },
                });
                await tx.lead.update({
                    where: { id: source.leadId },
                    data: leadLinkData(created.id, source.organizationId),
                });
                return created.id;
            },
            { maxWait: 10_000, timeout: 120_000 },
        );
        contactIds.set(insert.key, createdId);

        for (const link of links) {
            if (link.leadId === source.leadId) continue;
            await prisma.lead.update({
                where: { id: link.leadId },
                data: leadLinkData(createdId, link.organizationId),
            });
        }
    }

    for (const link of plan.leadLinks) {
        // A contactKey link was written with the insert above. Only an existing
        // contact id remains. One link is never both.
        if (!link.contactId || link.contactKey) continue;
        await prisma.lead.update({
            where: { id: link.leadId },
            data: leadLinkData(link.contactId, link.organizationId),
        });
    }

    return contactIds;
}

export function rememberLinks(
    leads: LeadLinkRow[],
    contacts: ContactLinkRow[],
    plan: LeadPlan,
    contactIds: Map<string, string>,
) {
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    for (const link of plan.leadLinks) {
        const contactId = link.contactId ?? (link.contactKey ? contactIds.get(link.contactKey) : undefined);
        if (!contactId) {
            throw new Error(`sync-lead-contacts: no contact for lead ${link.leadId}`);
        }
        const lead = leadById.get(link.leadId);
        if (!lead) throw new Error(`sync-lead-contacts: lead ${link.leadId} was not loaded`);
        lead.contact_id = contactId;
    }

    for (const insert of plan.contactInserts) {
        const id = contactIds.get(insert.key);
        if (!id) throw new Error(`sync-lead-contacts: insert ${insert.key} has no id`);
        contacts.push({
            id,
            tenant_id: insert.tenant_id,
            name: insert.name,
            mobile: insert.mobile,
            email: insert.email,
            linkedin_url: insert.linkedin_url,
            address: insert.address,
            mobile_norm: insert.mobile_norm,
            email_norm: insert.email_norm,
            linkedin_norm: insert.linkedin_norm,
            organization_id: null,
            customer_id: null,
            created_at: leadById.get(insert.fromLeadId)?.created_at ?? null,
        });
    }
}

async function main() {
    const { dryRun, where } = scriptOptions(process.argv.slice(2));

    const leads = await loadPages<LeadLinkRow>((cursor) =>
        prisma.lead.findMany({
            where,
            select: {
                id: true,
                tenant_id: true,
                name: true,
                mobile: true,
                email: true,
                linkedin_url: true,
                address: true,
                contact_id: true,
                organization_id: true,
                converted_customer_id: true,
                created_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        }),
    );
    const contacts = await loadPages<ContactLinkRow>((cursor) =>
        prisma.crmContact.findMany({
            where,
            select: {
                id: true,
                tenant_id: true,
                name: true,
                mobile: true,
                email: true,
                linkedin_url: true,
                address: true,
                mobile_norm: true,
                email_norm: true,
                linkedin_norm: true,
                organization_id: true,
                customer_id: true,
                created_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        }),
    );

    const scannedContacts = contacts.length;
    const first = planLeadLinks(leads, contacts);
    assertPlanIsApplicable(first);
    const contactIds = dryRun ? new Map<string, string>() : await writeLeadLinks(first);
    if (dryRun) {
        for (const insert of first.contactInserts) {
            // In-memory only, so the second plan can name the contact. Not written.
            contactIds.set(insert.key, `dry-run:${insert.key}`);
        }
    }

    rememberLinks(leads, contacts, first, contactIds);
    // customerLinks from the first call cannot name a contact inserted above.
    const second = planLeadLinks(leads, contacts);
    if (second.contactInserts.length > 0 || second.leadLinks.length > 0) {
        throw new Error(
            `sync-lead-contacts: second plan still has ${second.contactInserts.length} insert(s) ` +
                `and ${second.leadLinks.length} lead link(s)`,
        );
    }

    if (!dryRun) {
        for (const link of second.customerLinks) {
            await prisma.crmContact.update({
                where: { id: link.contactId },
                data: { customer_id: link.customerId },
            });
        }
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-lead-contacts: scanned ${leads.length} lead(s) and ${scannedContacts} contact(s), ` +
            `planned ${first.contactInserts.length} contact insert(s), ` +
            `planned ${first.leadLinks.length} lead link(s), ` +
            `planned ${second.customerLinks.length} customer link(s), ` +
            `noted ${first.nameMismatches.length} name mismatch(es).`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('sync-lead-contacts failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
