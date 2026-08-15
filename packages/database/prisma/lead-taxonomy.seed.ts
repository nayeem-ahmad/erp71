/**
 * Default CRM lookup lists provisioned for every tenant: lead sources, lead
 * categories and conversation channels.
 *
 * These replace the old `LeadSource` / `LeadCategory` Prisma enums and the
 * hardcoded `LeadConversationType` list. Tenants can rename, reorder, deactivate
 * and add to all three from CRM → Setup.
 *
 * `code` is the immutable join key and MUST NOT be edited once shipped:
 *   - the backfill in `sync-lead-taxonomy.ts` maps the legacy enum columns onto
 *     these rows by `code`, and
 *   - the CSV importer matches spreadsheet values against `code` before `name`.
 * `name` is the display label and is freely editable by the tenant.
 *
 * The six codes that mirror the old enum members exist in every tenant so the
 * backfill can never orphan a lead. Codes beyond those six (WHATSAPP,
 * INSTAGRAM, MARKETPLACE) have no enum counterpart — a lead assigned to one of
 * them writes `OTHER` into the legacy `Lead.source` column during the expand
 * phase. See `coerceLegacySource` in
 * apps/backend/src/crm-lead-taxonomy/lead-taxonomy.util.ts.
 */

/** Codes that exist as members of the legacy `LeadSource` enum. */
export const LEGACY_LEAD_SOURCE_CODES = [
    'WALK_IN',
    'PHONE',
    'FACEBOOK',
    'REFERRAL',
    'WEBSITE',
    'OTHER',
] as const;

/** Codes that exist as members of the legacy `LeadCategory` enum. */
export const LEGACY_LEAD_CATEGORY_CODES = [
    'RETAIL',
    'WHOLESALE',
    'CORPORATE',
    'INDIVIDUAL',
    'PARTNER',
    'OTHER',
] as const;

/**
 * The code every tenant is guaranteed to have. Lead creation, the CSV importer
 * and the backfill all fall back to it, so it can be renamed but never deleted
 * or deactivated.
 */
export const FALLBACK_SOURCE_CODE = 'OTHER';

/**
 * `score_weight` values for the six legacy codes are carried over verbatim from
 * the hardcoded SOURCE_WEIGHT map they replace, so existing lead scores do not
 * shift when the FK goes live.
 */
export const DEFAULT_LEAD_SOURCES: {
    code: string;
    name: string;
    score_weight: number;
    sort_order: number;
}[] = [
    { code: 'WALK_IN', name: 'Walk-in', score_weight: 15, sort_order: 1 },
    { code: 'PHONE', name: 'Phone Call', score_weight: 10, sort_order: 2 },
    { code: 'FACEBOOK', name: 'Facebook', score_weight: 15, sort_order: 3 },
    { code: 'WHATSAPP', name: 'WhatsApp', score_weight: 15, sort_order: 4 },
    { code: 'INSTAGRAM', name: 'Instagram', score_weight: 15, sort_order: 5 },
    { code: 'MARKETPLACE', name: 'Marketplace (Daraz/Bikroy)', score_weight: 10, sort_order: 6 },
    { code: 'REFERRAL', name: 'Referral', score_weight: 25, sort_order: 7 },
    { code: 'WEBSITE', name: 'Website', score_weight: 20, sort_order: 8 },
    { code: 'OTHER', name: 'Other', score_weight: 5, sort_order: 9 },
];

export const DEFAULT_LEAD_CATEGORIES: {
    code: string;
    name: string;
    sort_order: number;
}[] = [
    { code: 'RETAIL', name: 'Retail', sort_order: 1 },
    { code: 'WHOLESALE', name: 'Wholesale', sort_order: 2 },
    { code: 'CORPORATE', name: 'Corporate', sort_order: 3 },
    { code: 'INDIVIDUAL', name: 'Individual', sort_order: 4 },
    { code: 'PARTNER', name: 'Partner / Reseller', sort_order: 5 },
    { code: 'OTHER', name: 'Other', sort_order: 6 },
];

/**
 * Communication channels a lead conversation can be logged under.
 *
 * The seven codes mirror the members of the old `LeadConversationType` enum, so
 * every `LeadConversation.type` value written before these rows existed still
 * resolves to a channel by `code`. `icon` carries the emoji the conversation
 * lists used to hardcode.
 */
export const DEFAULT_CONVERSATION_CHANNELS: {
    code: string;
    name: string;
    icon: string;
    sort_order: number;
}[] = [
    { code: 'CALL', name: 'Call', icon: '📞', sort_order: 1 },
    { code: 'SMS', name: 'SMS', icon: '💬', sort_order: 2 },
    { code: 'WHATSAPP', name: 'WhatsApp', icon: '🟢', sort_order: 3 },
    { code: 'EMAIL', name: 'Email', icon: '📧', sort_order: 4 },
    { code: 'VISIT', name: 'Visit', icon: '🏪', sort_order: 5 },
    { code: 'ONLINE_MEETING', name: 'Online Meeting', icon: '💻', sort_order: 6 },
    { code: 'NOTE', name: 'Note', icon: '📝', sort_order: 7 },
];

/**
 * Why an activity exists, as opposed to how it is delivered (that is
 * ConversationChannel). The four codes mirror the members of CrmFollowUp.type,
 * so backfilled follow-ups resolve to a purpose by `code`.
 */
export const DEFAULT_ACTIVITY_PURPOSES: {
    code: string;
    name: string;
    icon: string;
    sort_order: number;
}[] = [
    { code: 'GENERAL', name: 'General', icon: '📌', sort_order: 1 },
    { code: 'COLLECTION', name: 'Collection', icon: '💰', sort_order: 2 },
    { code: 'BIRTHDAY', name: 'Birthday', icon: '🎂', sort_order: 3 },
    { code: 'REORDER_REMINDER', name: 'Reorder Reminder', icon: '🔁', sort_order: 4 },
];

/**
 * Idempotent: safe to call for an existing tenant. `skipDuplicates` honours
 * @@unique([tenant_id, code]), so a tenant that renamed "Facebook" to
 * "Meta Ads" keeps its label instead of having a second row created.
 *
 * Note this seeds unconditionally rather than bootstrap-if-empty, so a tenant
 * that deleted a default and then hits this path gets it back. The settings UI
 * deactivates system rows rather than deleting them precisely so that a tenant's
 * intent to hide a source survives this call.
 */
export async function seedDefaultLeadTaxonomy(tx: any, tenantId: string) {
    await tx.leadSourceOption.createMany({
        data: DEFAULT_LEAD_SOURCES.map((s) => ({
            tenant_id: tenantId,
            code: s.code,
            name: s.name,
            score_weight: s.score_weight,
            sort_order: s.sort_order,
            is_system: true,
            is_active: true,
        })),
        skipDuplicates: true,
    });

    await tx.leadCategoryOption.createMany({
        data: DEFAULT_LEAD_CATEGORIES.map((c) => ({
            tenant_id: tenantId,
            code: c.code,
            name: c.name,
            sort_order: c.sort_order,
            is_system: true,
            is_active: true,
        })),
        skipDuplicates: true,
    });

    await tx.conversationChannel.createMany({
        data: DEFAULT_CONVERSATION_CHANNELS.map((c) => ({
            tenant_id: tenantId,
            code: c.code,
            name: c.name,
            icon: c.icon,
            sort_order: c.sort_order,
            is_system: true,
            is_active: true,
        })),
        skipDuplicates: true,
    });

    await tx.crmActivityPurpose.createMany({
        data: DEFAULT_ACTIVITY_PURPOSES.map((p) => ({
            tenant_id: tenantId,
            code: p.code,
            name: p.name,
            icon: p.icon,
            sort_order: p.sort_order,
            is_system: true,
            is_active: true,
        })),
        skipDuplicates: true,
    });
}
