import { Prisma } from '@prisma/client';
import { seedDefaultLeadTaxonomy } from '@erp71/database';
import { leadIdentityOf } from '@erp71/shared-types';
import type { DemoWorld } from './context';
import { businessName, personName, phoneNumber } from './people';
import { money } from './write';

type Tx = Prisma.TransactionClient;

/** Phone-number sequence offsets, so leads and contacts never collide with customers. */
const LEAD_PHONE_OFFSET = 20000;
const CONTACT_PHONE_OFFSET = 30000;

const CUSTOMER_GROUPS = [
    { name: 'Retail', discount: 0, priceList: null },
    { name: 'Wholesale', discount: 8, priceList: 'Wholesale Price List' },
    { name: 'Corporate', discount: 5, priceList: 'Corporate Price List' },
    { name: 'VIP', discount: 12, priceList: null },
] as const;

const TERRITORIES = ['Dhaka North', 'Dhaka South', 'Chattogram', 'Sylhet', 'Khulna'];

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;
const LEAD_SOURCE_CODES = ['WALK_IN', 'PHONE', 'FACEBOOK', 'WHATSAPP', 'REFERRAL', 'WEBSITE', 'MARKETPLACE'];
const LEAD_CATEGORY_CODES = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'INDIVIDUAL', 'PARTNER'];

const INTERACTION_SUMMARIES = [
    'Called about the outstanding balance',
    'Sent this month’s price list over WhatsApp',
    'Walk-in enquiry about bulk pricing',
    'Followed up on a delayed delivery',
    'Courtesy call after a large order',
];

const ACTIVITY_SUBJECTS = [
    'Reorder reminder',
    'Collection call',
    'Quote follow-up',
    'New product introduction',
    'Post-delivery check-in',
];

/**
 * Everything the CRM module shows: the customer segmentation a shop actually
 * prices against (groups, price lists, territories, discount codes), the lead
 * funnel, and the day-to-day record of talking to people — interactions,
 * activities, follow-ups and campaigns.
 *
 * The funnel is generated with its outcome already decided rather than a lead
 * being marched through statuses day by day: a demo needs a pipeline with leads
 * at every stage on the day you open it, not a pile that all converted at once.
 */
export class CrmWriter {
    private leadSourceIds = new Map<string, string>();
    private leadCategoryIds = new Map<string, string>();
    private channelIds = new Map<string, string>();
    private purposeIds = new Map<string, string>();
    private leadIds: string[] = [];

    constructor(private readonly world: DemoWorld) {}

    private get counts() {
        return this.world.counts;
    }

    /* ---------------------------------------------------------------- */
    /*  Master data                                                      */
    /* ---------------------------------------------------------------- */

    async ensureMasterData(tx: Tx): Promise<void> {
        const { tenantId, rng } = this.world;

        // Idempotent, and the tenant may predate the taxonomy — without these
        // rows a lead has no source and an activity has no channel.
        await seedDefaultLeadTaxonomy(tx, tenantId);

        for (const row of await tx.leadSourceOption.findMany({ where: { tenant_id: tenantId }, select: { id: true, code: true } })) {
            this.leadSourceIds.set(row.code, row.id);
        }
        for (const row of await tx.leadCategoryOption.findMany({ where: { tenant_id: tenantId }, select: { id: true, code: true } })) {
            this.leadCategoryIds.set(row.code, row.id);
        }
        for (const row of await tx.conversationChannel.findMany({ where: { tenant_id: tenantId }, select: { id: true, code: true } })) {
            this.channelIds.set(row.code, row.id);
        }
        for (const row of await tx.crmActivityPurpose.findMany({ where: { tenant_id: tenantId }, select: { id: true, code: true } })) {
            this.purposeIds.set(row.code, row.id);
        }

        // Price lists first — a customer group can point at one.
        const priceListIds = new Map<string, string>();
        for (const name of ['Wholesale Price List', 'Corporate Price List']) {
            const discount = name.startsWith('Wholesale') ? 10 : 6;
            const priceList = await tx.priceList.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                update: {},
                create: {
                    tenant_id: tenantId, name,
                    description: `${name} — ${discount}% off list across the catalogue`,
                    is_active: true,
                    overall_discount_type: 'PERCENTAGE',
                    overall_discount_value: discount,
                },
            });
            priceListIds.set(name, priceList.id);
            this.counts.priceLists++;

            // Named prices on the fastest-moving lines, so the list is not just
            // a blanket percentage.
            const featured = [...this.world.products]
                .sort((a, b) => b.popularityWeight - a.popularityWeight)
                .slice(0, 12);
            for (const product of featured) {
                await tx.priceListItem.upsert({
                    where: { price_list_id_product_id: { price_list_id: priceList.id, product_id: product.id } },
                    update: {},
                    create: {
                        price_list_id: priceList.id,
                        product_id: product.id,
                        selling_price: money(product.sellPrice * (1 - discount / 100)),
                    },
                });
            }
        }

        const groupIds: string[] = [];
        for (const group of CUSTOMER_GROUPS) {
            const row = await tx.customerGroup.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name: group.name } },
                update: {},
                create: {
                    tenant_id: tenantId,
                    name: group.name,
                    description: `${group.name} customers`,
                    default_discount_pct: group.discount || null,
                    price_list_id: group.priceList ? priceListIds.get(group.priceList) ?? null : null,
                },
            });
            groupIds.push(row.id);
            this.counts.customerGroups++;
        }

        const territoryIds: string[] = [];
        for (const name of TERRITORIES) {
            const existing = await tx.territory.findFirst({ where: { tenant_id: tenantId, name, parent_id: null } });
            const row = existing ?? await tx.territory.create({ data: { tenant_id: tenantId, name } });
            territoryIds.push(row.id);
            this.counts.territories++;
        }

        // Spread the customers across groups and territories, and give a few of
        // them birthdays so the birthday-reminder follow-ups have a reason.
        for (const [index, customer] of this.world.customers.entries()) {
            const segment = this.world.rng.weighted(['Regular', 'VIP', 'New', 'At-Risk'], [55, 15, 20, 10]);
            await tx.customer.update({
                where: { id: customer.id },
                data: {
                    customer_group_id: groupIds[index % groupIds.length],
                    territory_id: territoryIds[index % territoryIds.length],
                    segment_category: segment,
                    preferred_channel: this.world.rng.pick(['PHONE', 'WHATSAPP', 'SMS', 'EMAIL']),
                    birthday: index % 4 === 0
                        ? new Date(Date.UTC(1985 + (index % 15), index % 12, 1 + (index % 27)))
                        : null,
                },
            });
        }

        for (const spec of [
            { code: 'EID25', name: 'Eid special', type: 'PERCENTAGE', value: 10, min: 1000, max: 500, limit: 200 },
            { code: 'NEWCUST', name: 'First purchase', type: 'FIXED', value: 100, min: 500, max: null, limit: null },
            { code: 'BULK500', name: 'Bulk order discount', type: 'PERCENTAGE', value: 5, min: 10000, max: 2000, limit: 50 },
            { code: 'PUJA24', name: 'Puja offer (expired)', type: 'PERCENTAGE', value: 15, min: 2000, max: 1000, limit: 100 },
        ]) {
            const expired = spec.code === 'PUJA24';
            await tx.discountCode.upsert({
                where: { tenantId_code: { tenantId, code: spec.code } },
                update: {},
                create: {
                    tenantId, code: spec.code, name: spec.name, type: spec.type,
                    value: spec.value, min_purchase: spec.min, max_discount: spec.max,
                    usage_limit: spec.limit, used_count: rng.int(0, spec.limit ?? 40),
                    valid_from: this.world.start,
                    valid_until: expired ? new Date(this.world.start.getTime() + 45 * 86400000) : this.world.end,
                    is_active: !expired,
                    created_at: this.world.start,
                },
            });
            this.counts.discountCodes++;
        }
    }

    /** Business contacts collected from cards and calls, outside the lead funnel. */
    async writeContacts(tx: Tx, count: number): Promise<void> {
        const { rng, tenantId, batchNumber } = this.world;
        for (let i = 0; i < count; i++) {
            const created = new Date(this.world.start.getTime() + rng.int(0, 20) * 86400000);
            await tx.crmContact.create({
                data: {
                    tenant_id: tenantId,
                    name: personName(rng),
                    company: businessName(rng),
                    designation: rng.pick(['Proprietor', 'Purchase Manager', 'Accounts Officer', 'Director', 'Sales Executive']),
                    mobile: phoneNumber(rng, batchNumber * 100000 + CONTACT_PHONE_OFFSET + i),
                    email: null,
                    capture_source: rng.weighted(['MANUAL', 'BUSINESS_CARD', 'IMPORT'], [50, 35, 15]),
                    created_by: this.world.userId,
                    created_at: created,
                    updated_at: created,
                },
            });
            this.counts.crmContacts++;
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Lead funnel                                                      */
    /* ---------------------------------------------------------------- */

    /**
     * One lead, with its outcome already settled. Older leads have had time to
     * convert or go cold; a lead raised yesterday is still NEW.
     */
    async writeLead(tx: Tx, date: Date, dayIndex: number, totalDays: number): Promise<void> {
        const { rng, tenantId, batchNumber } = this.world;
        const age = totalDays - dayIndex;
        const status = age > 30
            ? rng.weighted(LEAD_STATUSES, [5, 15, 20, 30, 30])
            : age > 7
                ? rng.weighted(LEAD_STATUSES, [15, 35, 30, 12, 8])
                : rng.weighted(LEAD_STATUSES, [55, 30, 12, 2, 1]);

        const sourceCode = rng.pick(LEAD_SOURCE_CODES);
        const categoryCode = rng.pick(LEAD_CATEGORY_CODES);
        const closed = status === 'CONVERTED' || status === 'LOST';
        const mobile = phoneNumber(rng, batchNumber * 100000 + LEAD_PHONE_OFFSET + this.leadIds.length);
        const converted = status === 'CONVERTED' && this.world.customers.length > 0
            ? rng.pick(this.world.customers)
            : null;

        const lead = await tx.lead.create({
            data: {
                tenant_id: tenantId,
                store_id: this.world.mainStore.storeId,
                name: rng.chance(0.5) ? personName(rng) : businessName(rng),
                mobile,
                ...leadIdentityOf({ mobile }),
                // The legacy enum columns still drive some filters; the FK rows
                // are the source of truth, so keep the pair consistent.
                source: (LEAD_SOURCE_CODES.includes(sourceCode) && ['WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE'].includes(sourceCode)
                    ? sourceCode
                    : 'OTHER') as never,
                source_id: this.leadSourceIds.get(sourceCode) ?? null,
                category: categoryCode as never,
                category_id: this.leadCategoryIds.get(categoryCode) ?? null,
                priority: rng.weighted(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], [20, 45, 25, 10]) as never,
                status: status as never,
                score: rng.int(5, 95),
                remarks: rng.pick([
                    'Asked for a wholesale rate card',
                    'Wants monthly credit terms',
                    'Comparing prices with the next market',
                    'Bulk order for a corporate office',
                ]),
                lost_reason: status === 'LOST' ? rng.pick(['Price too high', 'Bought elsewhere', 'No longer responding']) : null,
                next_step: closed ? null : rng.pick(['Send quotation', 'Call back next week', 'Arrange a shop visit']),
                next_step_date: closed ? null : new Date(date.getTime() + rng.int(1, 10) * 86400000),
                assigned_to: this.world.userId,
                created_by: this.world.userId,
                last_contacted_at: status === 'NEW' ? null : date,
                last_activity_at: date,
                closed_at: closed ? this.world.clampToWindow(new Date(date.getTime() + rng.int(1, 20) * 86400000)) : null,
                converted_customer_id: converted?.id ?? null,
                created_at: date,
                updated_at: date,
            },
        });
        this.leadIds.push(lead.id);
        this.counts.leads++;

        // Anything past NEW has been spoken to at least once.
        if (status !== 'NEW') {
            const channelCode = rng.pick(['CALL', 'WHATSAPP', 'VISIT', 'SMS']);
            await tx.leadConversation.create({
                data: {
                    tenant_id: tenantId,
                    store_id: this.world.mainStore.storeId,
                    lead_id: lead.id,
                    type: channelCode,
                    channel_id: this.channelIds.get(channelCode) ?? null,
                    direction: rng.chance(0.7) ? 'OUTBOUND' : 'INBOUND',
                    summary: rng.pick(INTERACTION_SUMMARIES),
                    outcome: status === 'LOST' ? 'Not interested' : 'Interested, will follow up',
                    created_by: this.world.userId,
                    created_at: date,
                },
            });
            this.counts.leadConversations++;
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Day-to-day CRM work                                              */
    /* ---------------------------------------------------------------- */

    /** A logged conversation with an existing customer. */
    async maybeInteraction(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.customers.length === 0 || !rng.chance(0.5)) return;
        const customer = rng.pick(this.world.customers);
        await tx.customerInteraction.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: this.world.mainStore.storeId,
                customer_id: customer.id,
                type: rng.pick(['CALL', 'SMS', 'WHATSAPP', 'VISIT', 'NOTE']),
                direction: rng.chance(0.65) ? 'OUTBOUND' : 'INBOUND',
                summary: rng.pick(INTERACTION_SUMMARIES),
                outcome: rng.pick(['Will visit this week', 'Paid on the spot', 'Asked for a call back', null]),
                created_by: this.world.userId,
                created_at: date,
            },
        });
        this.counts.customerInteractions++;
    }

    /**
     * A planned or completed activity against a customer or a lead. Roughly a
     * third are still PLANNED — a CRM with nothing due tomorrow demos badly.
     */
    async maybeActivity(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (!rng.chance(0.6)) return;

        const againstLead = this.leadIds.length > 0 && rng.chance(0.45);
        const done = rng.chance(0.65);
        const purposeCode = rng.weighted(['GENERAL', 'COLLECTION', 'REORDER_REMINDER', 'BIRTHDAY'], [40, 30, 20, 10]);
        const channelCode = rng.pick(['CALL', 'WHATSAPP', 'SMS', 'VISIT', 'EMAIL']);
        const dueAt = done ? date : this.world.clampToWindow(new Date(date.getTime() + rng.int(1, 12) * 86400000));

        await tx.crmActivity.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: this.world.mainStore.storeId,
                lead_id: againstLead ? rng.pick(this.leadIds) : null,
                customer_id: againstLead ? null : (this.world.customers.length > 0 ? rng.pick(this.world.customers).id : null),
                purpose_id: this.purposeIds.get(purposeCode) ?? null,
                channel_id: this.channelIds.get(channelCode) ?? null,
                channel_code: channelCode,
                subject: rng.pick(ACTIVITY_SUBJECTS),
                status: done ? 'DONE' : 'PLANNED',
                due_at: dueAt,
                completed_at: done ? date : null,
                summary: done ? rng.pick(INTERACTION_SUMMARIES) : null,
                outcome: done ? rng.pick(['Reached', 'No answer', 'Promised to pay', 'Order placed']) : null,
                direction: 'OUTBOUND',
                // Reviewed activities are the ones already carried out; what is
                // still planned is what a manager has yet to sign off.
                is_approved: done,
                approved_by: done ? this.world.userId : null,
                approved_at: done ? date : null,
                assigned_to: this.world.userId,
                created_by: this.world.userId,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.crmActivities++;
    }

    /** A dated reminder — usually a collection chase on an overdue balance. */
    async maybeFollowUp(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.customers.length === 0 || !rng.chance(0.35)) return;

        // Prefer someone who actually owes money; fall back to anyone.
        const owing = this.world.customers.filter((c) => c.due > 500);
        const customer = owing.length > 0 && rng.chance(0.7) ? rng.pick(owing) : rng.pick(this.world.customers);
        const completed = rng.chance(0.55);
        const dueAt = this.world.clampToWindow(new Date(date.getTime() + rng.int(1, 14) * 86400000));

        await tx.crmFollowUp.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: this.world.mainStore.storeId,
                customer_id: customer.id,
                type: owing.includes(customer) ? 'COLLECTION' : rng.pick(['GENERAL', 'REORDER_REMINDER', 'BIRTHDAY']),
                title: owing.includes(customer)
                    ? `Collect ৳${customer.due.toFixed(0)} from ${customer.name}`
                    : `Check in with ${customer.name}`,
                due_at: dueAt,
                completed_at: completed ? date : null,
                status: completed ? 'COMPLETED' : 'PENDING',
                assigned_to: this.world.userId,
                created_by: this.world.userId,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.crmFollowUps++;
    }

    /** A monthly blast to a segment, with per-recipient delivery outcomes. */
    async writeCampaign(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.customers.length === 0) return;

        const channel = rng.weighted(['SMS', 'WHATSAPP', 'EMAIL'], [55, 30, 15]);
        const segment = rng.pick(['ALL', 'VIP', 'At-Risk', 'Regular']);
        const recipients = rng.shuffle(this.world.customers).slice(0, Math.min(25, this.world.customers.length));
        const failed = Math.max(0, Math.round(recipients.length * rng.range(0, 0.12)));
        const delivered = recipients.length - failed;

        const campaign = await tx.crmCampaign.create({
            data: {
                tenant_id: this.world.tenantId,
                name: `${rng.pick(['Eid', 'Winter', 'Ramadan', 'New stock', 'Weekend'])} offer — ${date.toISOString().slice(0, 7)}`,
                description: 'Demo campaign to a customer segment',
                status: 'SENT',
                channel,
                recipient_source: 'SEGMENT',
                target_segment: segment,
                subject: channel === 'EMAIL' ? 'This month at our shop' : null,
                message: 'New stock has arrived — visit us this week for special prices.',
                scheduled_at: date,
                sent_at: date,
                recipient_count: recipients.length,
                delivered_count: delivered,
                failed_count: failed,
                attributed_revenue: money(delivered * rng.range(150, 900)),
                attributed_orders: Math.round(delivered * rng.range(0.05, 0.25)),
                created_by: this.world.userId,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.crmCampaigns++;

        for (const [index, customer] of recipients.entries()) {
            await tx.crmCampaignRecipient.create({
                data: {
                    campaign_id: campaign.id,
                    customer_id: customer.id,
                    name: customer.name,
                    message: 'New stock has arrived — visit us this week for special prices.',
                    status: index < failed ? 'FAILED' : 'SENT',
                    error: index < failed ? 'Handset unreachable' : null,
                    sent_at: index < failed ? null : date,
                },
            });
        }
    }
}
