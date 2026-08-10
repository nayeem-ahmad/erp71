import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { ValidCampaignRow } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

interface ResolvedParty {
    customer_id: string | null;
    lead_id: string | null;
    contact_id: string | null;
    name: string;
    phone: string | null;
}

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
     */
    async writeUploadedRecipients(
        tenantId: string,
        campaignId: string,
        rows: ValidCampaignRow[],
        userId: string | null,
    ): Promise<number> {
        const data = [];
        for (const row of rows) {
            const party = await this.resolveParty(tenantId, row, userId);
            data.push({
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
            });
        }

        const result = await this.db.crmCampaignRecipient.createMany({ data, skipDuplicates: true });
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
    ): Promise<number> {
        const customers = await this.resolveTargetCustomers(tenantId, targetSegment, targetGroupId);
        if (customers.length === 0) return 0;

        const result = await this.db.crmCampaignRecipient.createMany({
            data: customers.map((c) => ({
                id: randomUUID(),
                campaign_id: campaignId,
                customer_id: c.id,
                lead_id: null,
                contact_id: null,
                phone: c.phone,
                email: c.email,
                name: c.name,
                subject: null,
                message: null,
                status: 'PENDING',
            })),
            skipDuplicates: true,
        });
        return result.count;
    }

    private async resolveParty(
        tenantId: string,
        row: ValidCampaignRow,
        userId: string | null,
    ): Promise<ResolvedParty> {
        const email = { equals: row.email, mode: 'insensitive' as const };

        const customer = await this.db.customer.findFirst({
            where: { tenant_id: tenantId, deleted_at: null, email },
            select: { id: true, name: true, phone: true },
        });
        if (customer) {
            return {
                customer_id: customer.id,
                lead_id: null,
                contact_id: null,
                name: customer.name,
                phone: customer.phone ?? null,
            };
        }

        const lead = await this.db.lead.findFirst({
            where: { tenant_id: tenantId, email },
            select: { id: true, name: true, mobile: true },
        });
        if (lead) {
            return {
                customer_id: null,
                lead_id: lead.id,
                contact_id: null,
                name: lead.name,
                phone: lead.mobile ?? null,
            };
        }

        const contact = await this.db.crmContact.findFirst({
            where: { tenant_id: tenantId, email },
            select: { id: true, name: true, mobile: true },
        });
        if (contact) {
            return {
                customer_id: null,
                lead_id: null,
                contact_id: contact.id,
                name: contact.name,
                phone: contact.mobile ?? null,
            };
        }

        const created = await this.db.crmContact.create({
            data: {
                tenant_id: tenantId,
                name: row.name,
                email: row.email,
                capture_source: 'IMPORT',
                created_by: userId,
            },
        });
        return {
            customer_id: null,
            lead_id: null,
            contact_id: created.id,
            name: row.name,
            phone: null,
        };
    }
}
