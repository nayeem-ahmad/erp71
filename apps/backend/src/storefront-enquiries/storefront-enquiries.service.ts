import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { identityMatchArms, leadIdentityOf } from '@erp71/shared-types';
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

@Injectable()
export class StorefrontEnquiriesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
    ) {}

    /**
     * File an enquiry from a shop's public storefront against that shop's CRM.
     *
     * Two paths, and which one runs is never disclosed to the sender:
     *
     *  - **Nobody we know** — a new `Lead`, source WEBSITE, status NEW, with the
     *    message on the timeline.
     *  - **Somebody we already have** — a `LeadConversation` on the lead that
     *    already carries this email or mobile, and nothing else touched.
     *
     * The second path is the whole reason this does not call
     * `CrmLeadsService.create`. That method's `assertIdentityFree` answers a
     * repeat enquirer with `400 A lead with this email already exists.` — an
     * accurate sentence about the tenant's CRM, and one no shop wants shown to a
     * customer asking a second question. It would also leak which addresses a
     * shop already holds to anyone willing to probe the form.
     *
     * Nothing about an existing lead is rewritten — not its status, not its
     * owner, not its priority. A rep who has worked a lead to NEGOTIATION does
     * not want it dragged back to NEW because the customer used the web form
     * instead of replying to an email; the enquiry is new information on the
     * timeline, not a new beginning.
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
        const existing = await this.findExistingLead(tenant.id, identity);

        if (existing) {
            await this.logConversation(tenant.id, existing.id, dto.name, dto.message);
            return { success: true as const };
        }

        await this.createLead(tenant.id, dto, { email, mobile, identity });
        return { success: true as const };
    }

    /** The lead already holding this mobile or email, if the shop has one. */
    private async findExistingLead(
        tenantId: string,
        identity: ReturnType<typeof leadIdentityOf>,
    ) {
        const arms = identityMatchArms(identity);
        // `submit` refuses an enquiry with neither, so this is belt and braces:
        // `OR: []` matches no rows, which would read as "nobody we know" and
        // create a lead per submission.
        if (!arms.length) return null;

        return this.db.lead.findFirst({
            where: { tenant_id: tenantId, OR: arms },
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
            mobile?: string;
            identity: ReturnType<typeof leadIdentityOf>;
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

        const lead = await this.db.lead.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                email: contact.email,
                mobile: contact.mobile,
                ...contact.identity,
                source_id: source?.id ?? null,
                source: coerceLegacySource(source?.code),
                status: LeadStatus.NEW,
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
