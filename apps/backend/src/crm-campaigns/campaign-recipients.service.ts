import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ValidCampaignRow } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

interface ResolvedParty {
    customer_id: string | null;
    lead_id: string | null;
    contact_id: string | null;
    name: string;
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

        // Whatever matched nothing becomes a contact. Ids are minted here so
        // the recipient rows can point at them without reading the inserts back.
        const newContacts = new Map<string, { id: string; name: string }>();
        for (const row of rows) {
            if (parties.has(row.email) || newContacts.has(row.email)) continue;
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
            const party: ResolvedParty = parties.get(row.email) ?? {
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
                name: party.name,
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
     * The addresses arrive already lower-cased by validateCampaignRows, so this
     * is an exact `in` on an indexed column rather than a per-row ILIKE, which
     * no btree index can serve. The stored side is lower-cased in JS when the
     * map is keyed, so casing differences in what Postgres returns still fold
     * together.
     */
    private async resolveParties(
        tenantId: string,
        emails: string[],
        client: Client,
    ): Promise<Map<string, ResolvedParty>> {
        const [customers, leads, contacts] = await Promise.all([
            client.customer.findMany({
                where: { tenant_id: tenantId, deleted_at: null, email: { in: emails } },
                select: { id: true, name: true, phone: true, email: true },
            }),
            client.lead.findMany({
                where: { tenant_id: tenantId, email: { in: emails } },
                select: { id: true, name: true, mobile: true, email: true },
            }),
            client.crmContact.findMany({
                where: { tenant_id: tenantId, email: { in: emails } },
                select: { id: true, name: true, mobile: true, email: true },
            }),
        ]);

        // Precedence is customer → lead → contact. Filling the map weakest
        // first lets each stronger match simply overwrite the weaker one.
        const byEmail = new Map<string, ResolvedParty>();
        const key = (email: string | null) => (email ?? '').toLowerCase();

        for (const c of contacts) {
            byEmail.set(key(c.email), {
                customer_id: null,
                lead_id: null,
                contact_id: c.id,
                name: c.name,
                phone: c.mobile ?? null,
            });
        }
        for (const l of leads) {
            byEmail.set(key(l.email), {
                customer_id: null,
                lead_id: l.id,
                contact_id: null,
                name: l.name,
                phone: l.mobile ?? null,
            });
        }
        for (const c of customers) {
            byEmail.set(key(c.email), {
                customer_id: c.id,
                lead_id: null,
                contact_id: null,
                name: c.name,
                phone: c.phone ?? null,
            });
        }

        return byEmail;
    }
}
