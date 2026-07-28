// CommonJS runtime counterpart of lead-taxonomy.seed.ts — keep the two in sync.
// This is the copy the backend actually loads: package.json `main` points at
// index.js, so a symbol missing here is `undefined` at runtime even though the
// TypeScript build is green.
//
// `code` is the immutable join key used by the backfill and the CSV importer and
// must never be edited once shipped; `name` is the tenant-editable label.
const LEGACY_LEAD_SOURCE_CODES = ['WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE', 'OTHER'];

const LEGACY_LEAD_CATEGORY_CODES = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'INDIVIDUAL', 'PARTNER', 'OTHER'];

const FALLBACK_SOURCE_CODE = 'OTHER';

// Weights for the six legacy codes are carried over verbatim from the hardcoded
// SOURCE_WEIGHT map they replace, so existing lead scores do not shift.
const DEFAULT_LEAD_SOURCES = [
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

const DEFAULT_LEAD_CATEGORIES = [
    { code: 'RETAIL', name: 'Retail', sort_order: 1 },
    { code: 'WHOLESALE', name: 'Wholesale', sort_order: 2 },
    { code: 'CORPORATE', name: 'Corporate', sort_order: 3 },
    { code: 'INDIVIDUAL', name: 'Individual', sort_order: 4 },
    { code: 'PARTNER', name: 'Partner / Reseller', sort_order: 5 },
    { code: 'OTHER', name: 'Other', sort_order: 6 },
];

// Idempotent: `skipDuplicates` honours @@unique([tenant_id, code]), so a tenant
// that renamed a default keeps its label instead of gaining a second row.
async function seedDefaultLeadTaxonomy(tx, tenantId) {
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
}

module.exports = {
    seedDefaultLeadTaxonomy,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_LEAD_CATEGORIES,
    LEGACY_LEAD_SOURCE_CODES,
    LEGACY_LEAD_CATEGORY_CODES,
    FALLBACK_SOURCE_CODE,
};
