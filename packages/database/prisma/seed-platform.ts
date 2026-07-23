import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient, SubscriptionPlan } from '@prisma/client';

/**
 * Platform reference data — the catalog rows the application itself is defined by.
 *
 * These are rows, but they are not business data: `auth.service.ts`,
 * `billing.service.ts`, `billing-scheduler.service.ts` and
 * `admin-tenants.service.ts` all read `subscriptionPlan` at runtime, and
 * `addon-modules.service.ts` reads `addonModule`. An empty catalog is a broken
 * deployment, and a plan added in code has to reach production without anyone
 * hand-inserting a row.
 *
 * So this file — and ONLY this file — is safe to run automatically on every
 * production deploy. It is pure idempotent upserts of version-controlled
 * definitions and never touches tenants, users, or anything a customer created.
 *
 * Demo and development fixtures live in `seed.ts`, which must never run against
 * production. See the header comment there.
 */

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

export async function seedPlatformReferenceData(
    prisma: PrismaClient,
): Promise<Record<PlanCode, SubscriptionPlan>> {
    const upsertPlan = (data: {
        code: PlanCode;
        name: string;
        description: string;
        monthly_price: number;
        yearly_price: number;
        is_active?: boolean;
        features_json: Record<string, unknown>;
        marketing_features_json?: string[];
    }) => {
        const isActive = data.is_active ?? true;

        return prisma.subscriptionPlan.upsert({
            where: { code: data.code },
            update: {
                name: data.name,
                description: data.description,
                monthly_price: data.monthly_price,
                yearly_price: data.yearly_price,
                is_active: isActive,
                features_json: data.features_json,
                marketing_features_json: data.marketing_features_json ?? [],
            },
            create: {
                code: data.code,
                name: data.name,
                description: data.description,
                monthly_price: data.monthly_price,
                yearly_price: data.yearly_price,
                is_active: isActive,
                features_json: data.features_json,
                marketing_features_json: data.marketing_features_json ?? [],
            },
        });
    };

    const free = await upsertPlan({
        code: 'FREE',
        name: 'Free',
        description: 'Legacy fallback plan — not offered for new signups',
        monthly_price: 0,
        yearly_price: 0,
        is_active: false,
        features_json: {
            maxStores: 1,
            maxUsers: 1,
            maxSkus: 100,
            premiumAccounting: false,
            premiumInventoryReports: false,
            premiumCrm: false,
            multiStore: false,
            apiAccess: false,
            accountingOnly: false,
            premiumAccountingAdvanced: false,
            premiumAi: false,
            premiumVoice: false,
            planRank: 0,
            aiCreditsMonthly: 0,
        },
        marketing_features_json: [
            'Basic POS terminal',
            '1 user account',
            '1 store location',
            'Up to 100 products',
            'Community support',
        ],
    });

    const basic = await upsertPlan({
        code: 'BASIC',
        name: 'Basic',
        description: 'Core retail operations for growing single-branch businesses',
        monthly_price: 499,
        yearly_price: 4990,
        features_json: {
            maxStores: 1,
            maxUsers: 3,
            maxSkus: 2000,
            premiumAccounting: false,
            premiumInventoryReports: false,
            premiumCrm: false,
            multiStore: false,
            apiAccess: false,
            accountingOnly: false,
            premiumAccountingAdvanced: false,
            premiumAi: false,
            premiumVoice: false,
            planRank: 1,
            aiCreditsMonthly: 100,
        },
        marketing_features_json: [
            'Full POS terminal',
            'Inventory management',
            'Purchase orders',
            '3 user accounts',
            '1 store location',
            'Up to 2,000 products',
            'Email support',
        ],
    });

    const accounting = await upsertPlan({
        code: 'ACCOUNTING',
        name: 'Accounting',
        description: 'Focused pack for bookkeeping: full accounting module, financial reports, expenses, and fund management',
        monthly_price: 749,
        yearly_price: 7490,
        features_json: {
            maxStores: 1,
            maxUsers: 5,
            maxSkus: 5000,
            premiumAccounting: true,
            premiumInventoryReports: false,
            premiumCrm: false,
            multiStore: false,
            apiAccess: false,
            accountingOnly: true,
            premiumAccountingAdvanced: true,
            premiumAi: false,
            premiumVoice: false,
            planRank: 0,
            aiCreditsMonthly: 0,
        },
        marketing_features_json: [
            'Full accounting module',
            'Financial reports (P&L, balance sheet, cashbook)',
            'Expense & fund management',
            'Loan tracking',
            '5 user accounts',
            '1 store location',
            'Email support',
        ],
    });

    const standard = await upsertPlan({
        code: 'STANDARD',
        name: 'Standard',
        description: 'Advanced retail operations with multi-branch and analytics support',
        monthly_price: 999,
        yearly_price: 9990,
        features_json: {
            maxStores: 3,
            maxUsers: 10,
            maxSkus: 20000,
            premiumAccounting: true,
            premiumInventoryReports: true,
            premiumCrm: true,
            multiStore: true,
            apiAccess: false,
            accountingOnly: false,
            premiumAccountingAdvanced: false,
            premiumAi: false,
            premiumVoice: false,
            planRank: 2,
            aiCreditsMonthly: 0,
        },
        marketing_features_json: [
            'Everything in BASIC',
            'Accounting module',
            'Financial reports',
            'Sales orders',
            'Customer management',
            'Supplier management',
            'E-commerce storefront',
            '3 store locations',
            '10 user accounts',
            'Priority email support',
        ],
    });

    const premium = await upsertPlan({
        code: 'PREMIUM',
        name: 'Premium',
        description: 'Full retail suite with advanced automation, accounting, and integrations',
        monthly_price: 1499,
        yearly_price: 14990,
        features_json: {
            maxStores: 10,
            maxUsers: 30,
            maxSkus: -1,
            premiumAccounting: true,
            premiumInventoryReports: true,
            premiumCrm: true,
            multiStore: true,
            apiAccess: true,
            accountingOnly: false,
            premiumAccountingAdvanced: true,
            premiumManufacturing: true,
            premiumAi: true,
            premiumVoice: true,
            planRank: 3,
            aiCreditsMonthly: 2000,
        },
        marketing_features_json: [
            'Everything in STANDARD',
            'Manufacturing / BOM',
            'White-label branding',
            'Public API access',
            '10 store locations',
            '30 user accounts',
            'Unlimited products',
            'Priority phone & chat support',
        ],
    });

    // ── Add-on module catalog ───────────────────────────────────────────────
    // Storefront and Book Publishing are intentionally not seeded here yet —
    // storefront needs a grandfathering decision before it can be paywalled,
    // and Book Publishing has no backend module yet (see TODO.md).
    const upsertAddon = (data: {
        code: string;
        name: string;
        description: string;
        category: string;
        monthly_price: number;
        yearly_price: number;
        sort_order: number;
        features_json: Record<string, unknown>;
    }) => prisma.addonModule.upsert({
        where: { code: data.code },
        update: {
            name: data.name,
            description: data.description,
            category: data.category,
            monthly_price: data.monthly_price,
            yearly_price: data.yearly_price,
            sort_order: data.sort_order,
            features_json: data.features_json,
        },
        create: {
            code: data.code,
            name: data.name,
            description: data.description,
            category: data.category,
            monthly_price: data.monthly_price,
            yearly_price: data.yearly_price,
            sort_order: data.sort_order,
            features_json: data.features_json,
        },
    });

    await upsertAddon({
        code: 'MANUFACTURING',
        name: 'Manufacturing',
        description: 'BOM, production jobs, wastage recording, and production cost/yield analytics — buy standalone on any plan instead of upgrading to Premium.',
        category: 'operations',
        monthly_price: 999,
        yearly_price: 9990,
        sort_order: 10,
        features_json: { premiumManufacturing: true },
    });

    await upsertAddon({
        code: 'ADVANCED_ACCOUNTING',
        name: 'Advanced Accounting',
        description: 'Comparative P&L, budget vs actual, cash flow, and financial ratios for tenants on plans below PREMIUM.',
        category: 'accounting',
        monthly_price: 599,
        yearly_price: 5990,
        sort_order: 20,
        features_json: { premiumAccountingAdvanced: true },
    });

    return { FREE: free, BASIC: basic, ACCOUNTING: accounting, STANDARD: standard, PREMIUM: premium };
}

// Standalone entry point: `npm run db:seed:platform`. This is what production
// deploys run — see apps/backend/Dockerfile and scripts/deploy-erp71.sh.
if (require.main === module) {
    const prisma = new PrismaClient();

    seedPlatformReferenceData(prisma)
        .then(() => {
            console.log('✅  Platform reference data synced (subscription plans + addon modules)');
        })
        .catch((e) => {
            console.error(e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
