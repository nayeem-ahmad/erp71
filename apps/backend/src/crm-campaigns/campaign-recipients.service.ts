import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ValidCampaignRow } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

interface ResolvedParty {
    customer_id: string | null;
    lead_id: string | null;
    contact_id: string | null;
    /** Null when no single party was chosen, so the upload row's own name is used. */
    name: string | null;
    phone: string | null;
}

/** Either a plain connection or an open transaction — both satisfy the writes below. */
type Client = DatabaseService | Prisma.TransactionClient;

@Injectable()
export class CampaignRecipientsService {
    constructor(private db: DatabaseService) {}

    /**
     * Writes one PENDING recipient per uploaded row.
     *
     * Each address is resolved against customers, then leads, then contacts;
     * the first match wins and lends its real name. Nothing matching creates a
     * contact, so the list the user uploaded ends up in the address book —
     * and a second upload of the same file matches those contacts rather than
     * duplicating them, which matters because contacts dedupe on mobile and
     * these have none.
     *
     * The whole upload is resolved in a fixed number of queries — three lookups
     * and two inserts — rather than per row. A 1,000-row list used to cost
     * ~3,000 tenant-wide scans plus 1,000 inserts inside one HTTP request.
     */
    async writeUploadedRecipients(
        tenantId: string,
        campaignId: string,
        rows: ValidCampaignRow[],
        userId: string | null,
        client: Client = this.db,
    ): Promise<number> {
        if (rows.length === 0) return 0;

        const emails = [...new Set(rows.map((r) => r.email))];
        const parties = await this.resolveParties(tenantId, emails, client);
        const addressKey = (email: string) => email.toLowerCase();

        // Whatever matched nothing becomes a contact. Ids are minted here so
        // the recipient rows can point at them without reading the inserts back.
        // An address that matched several rows is already in `parties` with a
        // null id — it must not mint another contact.
        const newContacts = new Map<string, { id: string; name: string }>();
        for (const row of rows) {
            if (parties.has(addressKey(row.email)) || newContacts.has(row.email)) continue;
            newContacts.set(row.email, { id: randomUUID(), name: row.name });
        }
        if (newContacts.size > 0) {
            await client.crmContact.createMany({
                data: [...newContacts].map(([email, contact]) => ({
                    id: contact.id,
                    tenant_id: tenantId,
                    name: contact.name,
                    email,
                    capture_source: 'IMPORT',
                    created_by: userId,
                })),
            });
        }

        const data = rows.map((row) => {
            const created = newContacts.get(row.email);
            const party: ResolvedParty = parties.get(addressKey(row.email)) ?? {
                customer_id: null,
                lead_id: null,
                contact_id: created?.id ?? null,
                name: created?.name ?? row.name,
                phone: null,
            };
            return {
                id: randomUUID(),
                campaign_id: campaignId,
                customer_id: party.customer_id,
                lead_id: party.lead_id,
                contact_id: party.contact_id,
                phone: party.phone,
                email: row.email,
                name: party.name ?? row.name,
                subject: row.subject,
                message: row.message,
                status: 'PENDING',
            };
        });

        const result = await client.crmCampaignRecipient.createMany({ data, skipDuplicates: true });
        return result.count;
    }

    /** The customers a SEGMENT campaign targets. Used for the pre-send preview too. */
    async resolveTargetCustomers(tenantId: string, targetSegment: string | null, targetGroupId: string | null) {
        // Every segment channel reaches people by phone, so customers without
        // one are never eligible, whatever the channel.
        const where: any = { tenant_id: tenantId, deleted_at: null, phone: { not: null } };
        if (targetSegment && targetSegment !== 'ALL') where.segment_category = targetSegment;
        if (targetGroupId) where.customer_group_id = targetGroupId;

        return this.db.customer.findMany({
            where,
            select: { id: true, name: true, phone: true, email: true },
        });
    }

    async writeSegmentRecipients(
        tenantId: string,
        campaignId: string,
        targetSegment: string | null,
        targetGroupId: string | null,
        channel: string,
    ): Promise<number> {
        const customers = await this.resolveTargetCustomers(tenantId, targetSegment, targetGroupId);
        if (customers.length === 0) return 0;

        // Customer.email is not unique per tenant — only indexed — but a
        // recipient row is: @@unique([campaign_id, email]). Two customers
        // sharing an address (a household, or a shop's info@ used for every
        // walk-in) would collide and skipDuplicates would drop the second
        // silently, so an SMS or WhatsApp campaign would skip a customer with a
        // perfectly good phone number. Those channels never read the address,
        // so it is simply not stored. On an EMAIL segment campaign the
        // collision is still reachable and is left alone deliberately: the same
        // address cannot usefully be emailed the same campaign twice.
        const storeEmail = channel === 'EMAIL';

        const result = await this.db.crmCampaignRecipient.createMany({
            data: customers.map((c) => ({
                id: randomUUID(),
                campaign_id: campaignId,
                customer_id: c.id,
                lead_id: null,
                contact_id: null,
                phone: c.phone,
                email: storeEmail ? c.email : null,
                name: c.name,
                subject: null,
                message: null,
                status: 'PENDING',
            })),
            skipDuplicates: true,
        });
        return result.count;
    }

    /**
     * Looks a whole batch of addresses up across customers, leads and contacts.
     *
     * One query per table for the whole upload, not three per row. Matching
     * stays case-insensitive on the raw email. Leads and contacts also store
     * `email_norm`; customers do not. A stored `Rahim@Example.com` must still
     * match an uploaded `rahim@example.com`, or every upload mints a duplicate
     * contact for it — precisely what the resolution order exists to prevent.
     * `lead_id` and `contact_id` are set only when exactly one row in that
     * table has the address. Two customers leave `customer_id` null and do
     * not fall through to a lead.
     *
     * The cost of that is a scan: `mode: 'insensitive'` on an `in` compiles to
     * `LOWER(email) IN (…)`, and no plain btree index on email can serve a
     * function of the column. It is a hash probe per row rather than a pattern
     * match, so the scan is cheap — and the `in` set is bounded by the
     * 1,000-row upload cap, making this three sequential scans per upload
     * however large the list, where the 3N it replaced was not acceptable. A
     * `LOWER(email)` functional index would make it index-backed with no
     * change here, if these tables ever grow enough to care.
     */
    private async resolveParties(
        tenantId: string,
        emails: string[],
        client: Client,
    ): Promise<Map<string, ResolvedParty>> {
        const email = { in: emails, mode: 'insensitive' as const };

        const [customers, leads, contacts] = await Promise.all([
            client.customer.findMany({
                where: { tenant_id: tenantId, deleted_at: null, email },
                select: { id: true, name: true, phone: true, email: true },
            }),
            client.lead.findMany({
                where: { tenant_id: tenantId, email },
                select: { id: true, name: true, mobile: true, email: true },
            }),
            client.crmContact.findMany({
                where: { tenant_id: tenantId, email },
                select: { id: true, name: true, mobile: true, email: true },
            }),
        ]);

        // Group by the lowercased address first. Last-write-wins used to pick
        // whichever row the query returned last when two leads shared an email.
        const key = (email: string | null) => (email ?? '').toLowerCase();
        type Bucket = { customers: typeof customers; leads: typeof leads; contacts: typeof contacts };
        const buckets = new Map<string, Bucket>();
        const bucketFor = (email: string | null): Bucket => {
            const id = key(email);
            let bucket = buckets.get(id);
            if (!bucket) {
                bucket = { customers: [], leads: [], contacts: [] };
                buckets.set(id, bucket);
            }
            return bucket;
        };
        for (const row of customers) bucketFor(row.email).customers.push(row);
        for (const row of leads) bucketFor(row.email).leads.push(row);
        for (const row of contacts) bucketFor(row.email).contacts.push(row);

        const byEmail = new Map<string, ResolvedParty>();
        for (const [id, bucket] of buckets) {
            if (bucket.customers.length === 1) {
                const customer = bucket.customers[0];
                byEmail.set(id, {
                    customer_id: customer.id,
                    lead_id: null,
                    contact_id: null,
                    name: customer.name,
                    phone: customer.phone ?? null,
                });
                continue;
            }
            if (bucket.customers.length > 1) {
                byEmail.set(id, {
                    customer_id: null,
                    lead_id: null,
                    contact_id: null,
                    name: null,
                    phone: null,
                });
                continue;
            }

            const contact = bucket.contacts.length === 1 ? bucket.contacts[0] : null;
            if (bucket.leads.length === 1) {
                const lead = bucket.leads[0];
                byEmail.set(id, {
                    customer_id: null,
                    lead_id: lead.id,
                    contact_id: null,
                    name: lead.name,
                    phone: lead.mobile ?? null,
                });
                continue;
            }
            if (bucket.leads.length > 1) {
                byEmail.set(id, {
                    customer_id: null,
                    lead_id: null,
                    contact_id: contact?.id ?? null,
                    name: contact?.name ?? null,
                    phone: contact?.mobile ?? null,
                });
                continue;
            }

            if (contact) {
                byEmail.set(id, {
                    customer_id: null,
                    lead_id: null,
                    contact_id: contact.id,
                    name: contact.name,
                    phone: contact.mobile ?? null,
                });
                continue;
            }
            if (bucket.contacts.length > 1) {
                byEmail.set(id, {
                    customer_id: null,
                    lead_id: null,
                    contact_id: null,
                    name: null,
                    phone: null,
                });
            }
        }

        return byEmail;
    }
}
