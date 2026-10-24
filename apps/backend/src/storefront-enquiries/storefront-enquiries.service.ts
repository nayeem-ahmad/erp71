import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { leadIdentityOf, normalizeLeadMobile } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { coerceLegacySource } from '../crm-lead-taxonomy/lead-taxonomy.util';
import { computeLeadScore, DEFAULT_SOURCE_WEIGHT } from '../crm-leads/lead-scoring.util';
import { StorefrontEnquiryDto } from './storefront-enquiries.dto';

/**
 * The taxonomy code an enquiry off the shop's own website is filed under. A
 * tenant may have renamed the row — the code is the join key and does not
 * follow renames — but every tenant is seeded with it.
 */
const WEBSITE_SOURCE_CODE = 'WEBSITE';

/**
 * The conversation channel a web enquiry is logged on. There is no WEBSITE
 * channel in the seeded set (`CALL`, `SMS`, `WHATSAPP`, `EMAIL`, `VISIT`,
 * `ONLINE_MEETING`, `NOTE`) and inventing one per tenant from here would mean a
 * public endpoint writing to a tenant's CRM *settings*. NOTE is what the set
 * already has for "something was recorded that was not a call".
 */
const ENQUIRY_CHANNEL_CODE = 'NOTE';

const CONTACT_SELECT = {
    id: true,
    organization_id: true,
    mobile: true,
    mobile_norm: true,
    created_at: true,
} as const;

type EnquiryContact = {
    id: string;
    organization_id: string | null;
    mobile: string | null;
    mobile_norm: string | null;
    created_at: Date | string;
};

function compareCreatedAtThenId(a: EnquiryContact, b: EnquiryContact): number {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    if (at !== bt) return at - bt;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
}

/** A set norm wins. A null norm falls through to the raw value. */
function mobileMatches(row: { mobile: string | null; mobile_norm: string | null }, norm: string): boolean {
    if (row.mobile_norm) return row.mobile_norm === norm;
    return normalizeLeadMobile(row.mobile) === norm;
}

@Injectable()
export class StorefrontEnquiriesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
    ) {}

    /**
     * File an enquiry from a shop's public storefront against that shop's CRM.
     *
     * Match a person, not a lead. A normalized mobile selects the oldest contact
     * in the tenant with that `mobile_norm`, or with a null `mobile_norm` whose
     * raw mobile normalizes to the same number (`created_at`, then `id`). Two
     * spellings of one number are one person, and the email on the form is
     * ignored. When the mobile matches nobody, an email that matches exactly
     * one contact — the raw address, case-insensitive, or `email_norm` — is
     * that person. Two or more email matches are not a person we can name, so
     * the enquiry starts a new contact. Nothing matching does the same. The
     * new contact stores the enquiry email and norms, and stores the mobile
     * only when it normalizes.
     *
     * The message is logged on that contact's newest open lead. Open means
     * `status` is not CONVERTED or LOST; newest is `updated_at`, then `id`.
     * When none is open, a new lead is created pointing at the contact, and
     * `organization_id` is copied from the contact. An existing lead is not
     * updated, and neither is an existing contact.
     *
     * This does not call `CrmLeadsService.create`. That path files a deal the
     * way a member of staff would. A public enquiry has to land on the open
     * lead the matched person already has, or on a new lead for the contact,
     * and the response is `{ success: true }` either way. The sender is never
     * told which branch ran.
     */
    async submit(slug: string, dto: StorefrontEnquiryDto) {
        const email = dto.email?.trim() || undefined;
        const mobile = dto.mobile?.trim() || undefined;

        // One contact detail at minimum, or the enquiry reaches a shop that
        // cannot answer it. See the note on the DTO for why this is not a
        // decorator.
        if (!email && !mobile) {
            throw new BadRequestException('Leave an email address or a mobile number so we can reply.');
        }

        const tenant = await this.db.tenant.findFirst({
            where: { storefront_slug: slug, storefront_enabled: true, deleted_at: null },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Storefront not found or not available');

        const identity = leadIdentityOf({ mobile, email });
        // A number that does not normalize is not stored. `(tenant_id, mobile)`
        // is unique, so a second `---` would collide, and it is not a person.
        const storedMobile = identity.mobile_norm ? (mobile ?? null) : null;
        const person = await this.findPerson(tenant.id, identity, email);

        if (person) {
            const openLead = await this.findNewestOpenLead(tenant.id, person.id);
            if (openLead) {
                await this.logConversation(tenant.id, openLead.id, dto.name, dto.message);
                return { success: true as const };
            }

            await this.createLead(tenant.id, dto, {
                email,
                mobile: storedMobile,
                identity,
                contactId: person.id,
                organizationId: person.organization_id,
            });
            return { success: true as const };
        }

        const created = await this.db.crmContact.create({
            data: {
                tenant_id: tenant.id,
                name: dto.name,
                email: email ?? null,
                mobile: storedMobile,
                mobile_norm: identity.mobile_norm,
                email_norm: identity.email_norm,
                linkedin_norm: identity.linkedin_norm,
            },
            select: { id: true, organization_id: true },
        });

        await this.createLead(tenant.id, dto, {
            email,
            mobile: storedMobile,
            identity,
            contactId: created.id,
            organizationId: created.organization_id,
        });
        return { success: true as const };
    }

    /**
     * The person this enquiry is about, or null when we must start a new
     * contact. Null covers both "nobody" and "the email is shared", which
     * are the same write: do not log on either existing contact.
     */
    private async findPerson(
        tenantId: string,
        identity: ReturnType<typeof leadIdentityOf>,
        email: string | undefined,
    ): Promise<EnquiryContact | null> {
        if (identity.mobile_norm) {
            const rows = await this.db.crmContact.findMany({
                where: {
                    tenant_id: tenantId,
                    OR: [
                        { mobile_norm: identity.mobile_norm },
                        { mobile_norm: null, mobile: { not: null } },
                    ],
                },
                orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
                select: CONTACT_SELECT,
            });
            const match = rows
                .filter((row) => mobileMatches(row, identity.mobile_norm!))
                .sort(compareCreatedAtThenId)[0];
            if (match) return match;
        }

        if (!identity.email_norm || !email) return null;

        const rows = await this.db.crmContact.findMany({
            where: {
                tenant_id: tenantId,
                OR: [
                    { email: { equals: email, mode: 'insensitive' } },
                    { email_norm: identity.email_norm },
                ],
            },
            select: CONTACT_SELECT,
        });
        return rows.length === 1 ? rows[0] : null;
    }

    /** Newest open lead for this contact. Open means not CONVERTED or LOST. */
    private async findNewestOpenLead(tenantId: string, contactId: string) {
        return this.db.lead.findFirst({
            where: {
                tenant_id: tenantId,
                contact_id: contactId,
                status: { notIn: [LeadStatus.CONVERTED, LeadStatus.LOST] },
            },
            orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
            select: { id: true },
        });
    }

    /**
     * The enquiry text on a lead's timeline.
     *
     * INBOUND and `created_by: null` — the shop did not make this contact and no
     * member of staff recorded it, which is exactly what a null creator means
     * everywhere else a row is written by something other than a person.
     */
    private async logConversation(
        tenantId: string,
        leadId: string,
        name: string,
        message: string,
    ) {
        const channel = await this.db.conversationChannel.findFirst({
            where: { tenant_id: tenantId, code: ENQUIRY_CHANNEL_CODE },
            select: { id: true },
        });

        await this.db.leadConversation.create({
            data: {
                tenant_id: tenantId,
                lead_id: leadId,
                // `type` is NOT NULL and denormalises the channel's code, so it
                // is written from the constant even on a tenant whose seed never
                // ran and whose `channel_id` therefore stays null.
                type: ENQUIRY_CHANNEL_CODE,
                channel_id: channel?.id ?? null,
                direction: 'INBOUND',
                summary: `Website enquiry from ${name}:\n\n${message}`,
                created_by: null,
            },
        });
    }

    private async createLead(
        tenantId: string,
        dto: StorefrontEnquiryDto,
        contact: {
            email?: string;
            mobile: string | null;
            identity: ReturnType<typeof leadIdentityOf>;
            contactId: string;
            organizationId: string | null;
        },
    ) {
        const source =
            (await this.db.leadSourceOption.findFirst({
                where: { tenant_id: tenantId, code: WEBSITE_SOURCE_CODE },
            })) ?? (await this.taxonomy.fallbackSource(tenantId));

        const score = computeLeadScore(
            {
                status: LeadStatus.NEW,
                sourceWeight: source?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority: 'MEDIUM',
                last_contacted_at: null,
                next_step_date: null,
            },
            0,
        );

        // A tenant not yet synced has no stages; the boot sync fills status_id in.
        const newStage = await this.db.leadStatusOption.findFirst({
            where: { tenant_id: tenantId, code: LeadStatus.NEW },
            select: { id: true },
        });

        const lead = await this.db.lead.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                email: contact.email,
                mobile: contact.mobile,
                ...contact.identity,
                contact_id: contact.contactId,
                organization_id: contact.organizationId,
                source_id: source?.id ?? null,
                source: coerceLegacySource(source?.code),
                status: LeadStatus.NEW,
                status_id: newStage?.id ?? null,
                priority: 'MEDIUM',
                score,
                // Unassigned on purpose. Every other lead is owned by whoever
                // filed it, and nobody filed this one — handing it to an
                // arbitrary member would hide it from the rest of the team's
                // "my leads", which is worse than it sitting in the unassigned
                // queue the CRM already has a filter for.
                assigned_to: null,
                created_by: null,
            },
            select: { id: true },
        });

        // The message goes on the timeline rather than into `remarks`, so the
        // first enquiry and the fifth read the same way on the lead's history.
        await this.logConversation(tenantId, lead.id, dto.name, dto.message);
        return lead;
    }
}
