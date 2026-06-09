import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { bootstrapDefaultAccountingForTenant } from './bootstrap-accounting';
import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@retail-saas/shared-types';

const prisma = new PrismaClient();

async function main() {
    const passwordHash = await bcrypt.hash('password123', 10);

    const upsertPlan = (data: {
        code: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
        name: string;
        description: string;
        monthly_price: number;
        yearly_price: number;
        features_json: Record<string, unknown>;
    }) =>
        prisma.subscriptionPlan.upsert({
            where: { code: data.code },
            update: {
                name: data.name,
                description: data.description,
                monthly_price: data.monthly_price,
                yearly_price: data.yearly_price,
                is_active: true,
                features_json: data.features_json,
            },
            create: {
                code: data.code,
                name: data.name,
                description: data.description,
                monthly_price: data.monthly_price,
                yearly_price: data.yearly_price,
                is_active: true,
                features_json: data.features_json,
            },
        });

    await upsertPlan({
        code: 'FREE',
        name: 'Free',
        description: 'Starter plan for single-user onboarding and light usage',
        monthly_price: 0,
        yearly_price: 0,
        features_json: {
            maxStores: 1,
            maxUsers: 1,
            maxSkus: 100,
            premiumAccounting: false,
            premiumInventoryReports: false,
            multiStore: false,
        },
    });

    await upsertPlan({
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
            multiStore: false,
        },
    });

    await upsertPlan({
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
            multiStore: true,
        },
    });

    const premiumPlan = await upsertPlan({
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
            multiStore: true,
            apiAccess: true,
        },
    });

    // ── 1. Users ────────────────────────────────────────────────────────────
    const adminUser = await prisma.user.upsert({
        where: { email: 'nayeem.ahmad@gmail.com' },
        update: { name: 'Nayeem Ahmad', passwordHash },
        create: { email: 'nayeem.ahmad@gmail.com', name: 'Nayeem Ahmad', passwordHash },
    });

    const managerUser = await prisma.user.upsert({
        where: { email: 'manager@retailsaas.com' },
        update: {},
        create: { email: 'manager@retailsaas.com', name: 'Rafiq Islam', passwordHash },
    });

    const cashierUser = await prisma.user.upsert({
        where: { email: 'cashier@retailsaas.com' },
        update: {},
        create: { email: 'cashier@retailsaas.com', name: 'Sumaiya Khatun', passwordHash },
    });

    // ── 2. Tenant ────────────────────────────────────────────────────────────
    let tenant = await prisma.tenant.findFirst({ where: { owner_id: adminUser.id } });
    if (!tenant) {
        tenant = await prisma.tenant.create({
            data: { name: 'Dhaka Retail Co.', owner_id: adminUser.id },
        });
    }

    await prisma.tenantSubscription.upsert({
        where: { tenant_id: tenant.id },
        update: {
            plan_id: premiumPlan.id,
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            cancel_at_period_end: false,
            provider_name: 'seed',
        },
        create: {
            tenant_id: tenant.id,
            plan_id: premiumPlan.id,
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            cancel_at_period_end: false,
            provider_name: 'seed',
        },
    });

    // ── 3. Tenant memberships ────────────────────────────────────────────────
    await prisma.tenantUser.upsert({
        where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: adminUser.id } },
        update: {},
        create: { tenant_id: tenant.id, user_id: adminUser.id, role: 'OWNER' },
    });
    await prisma.tenantUser.upsert({
        where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: managerUser.id } },
        update: {},
        create: { tenant_id: tenant.id, user_id: managerUser.id, role: 'MANAGER' },
    });
    await prisma.tenantUser.upsert({
        where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: cashierUser.id } },
        update: {},
        create: { tenant_id: tenant.id, user_id: cashierUser.id, role: 'CASHIER' },
    });

    // ── 4. Store ─────────────────────────────────────────────────────────────
    let store = await prisma.store.findFirst({ where: { tenant_id: tenant.id } });
    if (!store) {
        store = await prisma.store.create({
            data: { tenant_id: tenant.id, name: 'Gulshan Branch', address: '12 Gulshan Ave, Dhaka 1212' },
        });
    }

    const warehouseCode = `WH-${store.id.slice(0, 8).toUpperCase()}`;
    let defaultWarehouse = await prisma.warehouse.findFirst({
        where: { tenant_id: tenant.id, store_id: store.id, is_default: true },
    });
    if (!defaultWarehouse) {
        defaultWarehouse = await prisma.warehouse.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                name: `${store.name} Main Warehouse`,
                code: warehouseCode,
                is_default: true,
                is_active: true,
            },
        });
    }

    await prisma.inventorySettings.upsert({
        where: { tenant_id: tenant.id },
        update: {
            default_product_warehouse_id: defaultWarehouse.id,
            default_purchase_warehouse_id: defaultWarehouse.id,
            default_sales_warehouse_id: defaultWarehouse.id,
            default_shrinkage_warehouse_id: defaultWarehouse.id,
            default_transfer_source_warehouse_id: defaultWarehouse.id,
            default_transfer_destination_warehouse_id: defaultWarehouse.id,
        },
        create: {
            tenant_id: tenant.id,
            default_product_warehouse_id: defaultWarehouse.id,
            default_purchase_warehouse_id: defaultWarehouse.id,
            default_sales_warehouse_id: defaultWarehouse.id,
            default_shrinkage_warehouse_id: defaultWarehouse.id,
            default_transfer_source_warehouse_id: defaultWarehouse.id,
            default_transfer_destination_warehouse_id: defaultWarehouse.id,
        },
    });

    // ── 4b. Second Store (Banani Branch) ────────────────────────────────────
    let store2 = await prisma.store.findFirst({
        where: { tenant_id: tenant.id, name: 'Banani Branch' },
    });
    if (!store2) {
        store2 = await prisma.store.create({
            data: { tenant_id: tenant.id, name: 'Banani Branch', address: '45 Banani Road, Dhaka 1213' },
        });
    }

    const warehouseCode2 = `WH-${store2.id.slice(0, 8).toUpperCase()}`;
    let warehouse2 = await prisma.warehouse.findFirst({
        where: { tenant_id: tenant.id, store_id: store2.id, is_default: true },
    });
    if (!warehouse2) {
        warehouse2 = await prisma.warehouse.create({
            data: {
                tenant_id: tenant.id,
                store_id: store2.id,
                name: `${store2.name} Main Warehouse`,
                code: warehouseCode2,
                is_default: true,
                is_active: true,
            },
        });
    }

    // ── 4c. UserStoreAccess seeding ─────────────────────────────────────────
    // Admin (OWNER): multi-store capable, access to both stores
    // Manager: single-store (Gulshan only)
    // Cashier: multi-store capable (covers weekends at Banani too)
    const storeAccessEntries = [
        { user_id: adminUser.id, store_id: store.id,  access_level: 'MULTI_STORE_CAPABLE' },
        { user_id: adminUser.id, store_id: store2.id, access_level: 'MULTI_STORE_CAPABLE' },
        { user_id: managerUser.id, store_id: store.id, access_level: 'STORE_ONLY' },
        { user_id: cashierUser.id, store_id: store.id,  access_level: 'MULTI_STORE_CAPABLE' },
        { user_id: cashierUser.id, store_id: store2.id, access_level: 'MULTI_STORE_CAPABLE' },
    ];

    for (const entry of storeAccessEntries) {
        await prisma.userStoreAccess.upsert({
            where: { user_id_store_id: { user_id: entry.user_id, store_id: entry.store_id } },
            update: { access_level: entry.access_level },
            create: { ...entry, tenant_id: tenant.id },
        });
    }

    // ── 4d. UserStorePermission seeding ────────────────────────────────────
    type PermEntry = { user_id: string; store_id: string; role: UserRole };
    const permEntries: PermEntry[] = [
        { user_id: adminUser.id,   store_id: store.id,  role: UserRole.OWNER },
        { user_id: adminUser.id,   store_id: store2.id, role: UserRole.OWNER },
        { user_id: managerUser.id, store_id: store.id,  role: UserRole.MANAGER },
        { user_id: cashierUser.id, store_id: store.id,  role: UserRole.CASHIER },
        { user_id: cashierUser.id, store_id: store2.id, role: UserRole.CASHIER },
    ];

    for (const entry of permEntries) {
        const perms = ROLE_DEFAULT_PERMISSIONS[entry.role];
        for (const permission of perms) {
            await prisma.userStorePermission.upsert({
                where: {
                    user_id_store_id_permission: {
                        user_id: entry.user_id,
                        store_id: entry.store_id,
                        permission,
                    },
                },
                update: {},
                create: {
                    user_id: entry.user_id,
                    store_id: entry.store_id,
                    tenant_id: tenant.id,
                    permission,
                    granted_by: adminUser.id,
                },
            });
        }
    }

    const inventoryReasonDefs = [
        { type: 'SHRINKAGE', code: 'THEFT', label: 'Theft' },
        { type: 'SHRINKAGE', code: 'DAMAGE', label: 'Damage' },
        { type: 'SHRINKAGE', code: 'EXPIRATION', label: 'Expiration' },
        { type: 'SHRINKAGE', code: 'UNKNOWN', label: 'Unknown Loss' },
        { type: 'DISCREPANCY', code: 'COUNT_ERROR', label: 'Count Error' },
        { type: 'DISCREPANCY', code: 'RECONCILIATION', label: 'Reconciliation Adjustment' },
    ];

    for (const [index, def] of inventoryReasonDefs.entries()) {
        await prisma.inventoryReason.upsert({
            where: { tenant_id_type_code: { tenant_id: tenant.id, type: def.type, code: def.code } },
            update: { label: def.label, is_active: true, is_system: true, display_order: index },
            create: {
                tenant_id: tenant.id,
                type: def.type,
                code: def.code,
                label: def.label,
                is_active: true,
                is_system: true,
                display_order: index,
            },
        });
    }

    await bootstrapDefaultAccountingForTenant(prisma, tenant.id);

    const productGroupDefs = [
        {
            name: 'Beverages',
            description: 'Coffee, tea, water, and drinks',
            image_url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&h=800&fit=crop',
            subgroups: ['Coffee', 'Tea', 'Drinks'],
        },
        {
            name: 'Groceries',
            description: 'Daily pantry and dry goods',
            image_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&h=800&fit=crop',
            subgroups: ['Grains', 'Spices', 'Dairy'],
        },
        {
            name: 'Snacks & Bakery',
            description: 'Snacks, chocolate, and bakery items',
            image_url: 'https://images.unsplash.com/photo-1483695028939-5bb13f8648b0?w=1200&h=800&fit=crop',
            subgroups: ['Snacks', 'Bakery'],
        },
        {
            name: 'Accessories',
            description: 'Consumables and accessories',
            image_url: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?w=1200&h=800&fit=crop',
            subgroups: ['Supplies'],
        },
    ];

    const productGroups = new Map<string, any>();
    const productSubgroups = new Map<string, any>();

    for (const def of productGroupDefs) {
        const group = await prisma.productGroup.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: def.name } },
            update: { description: def.description, image_url: def.image_url },
            create: {
                tenant_id: tenant.id,
                name: def.name,
                description: def.description,
                image_url: def.image_url,
            },
        });
        productGroups.set(def.name, group);

        for (const subgroupName of def.subgroups) {
            const subgroup = await prisma.productSubgroup.upsert({
                where: { group_id_name: { group_id: group.id, name: subgroupName } },
                update: {},
                create: {
                    tenant_id: tenant.id,
                    group_id: group.id,
                    name: subgroupName,
                },
            });
            productSubgroups.set(`${def.name}:${subgroupName}`, subgroup);
        }
    }

    // ── 5. Products ──────────────────────────────────────────────────────────
    const productDefs = [
        { name: 'Arabica Coffee Beans (250g)', sku: 'COF-001', price: 320, stock: 120, group: 'Beverages', subgroup: 'Coffee', image_url: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=400&h=400&fit=crop' },
        { name: 'Cold Brew Coffee (500ml)', sku: 'COF-002', price: 180, stock: 80, group: 'Beverages', subgroup: 'Coffee', image_url: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&h=400&fit=crop' },
        { name: 'Green Tea Bags (25 pack)', sku: 'TEA-001', price: 95, stock: 200, group: 'Beverages', subgroup: 'Tea', image_url: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400&h=400&fit=crop' },
        { name: 'Masala Chai Mix (200g)', sku: 'TEA-002', price: 140, stock: 150, group: 'Beverages', subgroup: 'Tea', image_url: 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400&h=400&fit=crop' },
        { name: 'Mineral Water (1L)', sku: 'DRK-001', price: 35, stock: 500, group: 'Beverages', subgroup: 'Drinks', image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&h=400&fit=crop' },
        { name: 'Orange Juice (1L)', sku: 'DRK-002', price: 120, stock: 60, group: 'Beverages', subgroup: 'Drinks', image_url: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&h=400&fit=crop' },
        { name: 'Basmati Rice (1kg)', sku: 'GRN-001', price: 110, stock: 300, group: 'Groceries', subgroup: 'Grains', image_url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=400&fit=crop' },
        { name: 'Chickpeas (500g)', sku: 'GRN-002', price: 75, stock: 180, group: 'Groceries', subgroup: 'Grains', image_url: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=400&fit=crop' },
        { name: 'Lentils (500g)', sku: 'GRN-003', price: 65, stock: 220, group: 'Groceries', subgroup: 'Grains', image_url: 'https://images.unsplash.com/photo-1609250283786-571e234b7a0a?w=400&h=400&fit=crop' },
        { name: 'Sunflower Oil (1L)', sku: 'OIL-001', price: 190, stock: 90, group: 'Groceries', subgroup: 'Grains', image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=400&fit=crop' },
        { name: 'Turmeric Powder (100g)', sku: 'SPC-001', price: 55, stock: 400, group: 'Groceries', subgroup: 'Spices', image_url: 'https://images.unsplash.com/photo-1615485500704-8e3b3e23f1dc?w=400&h=400&fit=crop' },
        { name: 'Cumin Seeds (100g)', sku: 'SPC-002', price: 45, stock: 350, group: 'Groceries', subgroup: 'Spices', image_url: 'https://images.unsplash.com/photo-1599909533731-d24d78f59eb1?w=400&h=400&fit=crop' },
        { name: 'Dark Chocolate Bar (100g)', sku: 'SNK-001', price: 150, stock: 70, group: 'Snacks & Bakery', subgroup: 'Snacks', image_url: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=400&h=400&fit=crop' },
        { name: 'Mixed Nuts (200g)', sku: 'SNK-002', price: 280, stock: 50, group: 'Snacks & Bakery', subgroup: 'Snacks', image_url: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=400&h=400&fit=crop' },
        { name: 'Potato Chips (150g)', sku: 'SNK-003', price: 80, stock: 110, group: 'Snacks & Bakery', subgroup: 'Snacks', image_url: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&h=400&fit=crop' },
        { name: 'Whole Wheat Bread (loaf)', sku: 'BKY-001', price: 60, stock: 40, group: 'Snacks & Bakery', subgroup: 'Bakery', image_url: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=400&h=400&fit=crop' },
        { name: 'Butter (200g)', sku: 'DRY-001', price: 130, stock: 85, group: 'Groceries', subgroup: 'Dairy', image_url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&h=400&fit=crop' },
        { name: 'Cheddar Cheese (200g)', sku: 'DRY-002', price: 220, stock: 45, group: 'Groceries', subgroup: 'Dairy', image_url: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=400&h=400&fit=crop' },
        { name: 'Espresso Machine Cleaner (250g)', sku: 'ACC-001', price: 195, stock: 30, group: 'Accessories', subgroup: 'Supplies', image_url: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=400&h=400&fit=crop' },
        { name: 'Reusable Shopping Bag', sku: 'ACC-002', price: 50, stock: 200, group: 'Accessories', subgroup: 'Supplies', image_url: 'https://images.unsplash.com/photo-1584308972272-9e4e7685e80f?w=400&h=400&fit=crop' },
    ];

    const products: any[] = [];
    for (const def of productDefs) {
        const existing = await prisma.product.findUnique({
            where: { tenant_id_sku: { tenant_id: tenant.id, sku: def.sku } },
        });
        if (existing) {
            await prisma.product.update({
                where: { id: existing.id },
                data: {
                    group_id: productGroups.get(def.group)?.id,
                    subgroup_id: productSubgroups.get(`${def.group}:${def.subgroup}`)?.id,
                    image_url: def.image_url,
                },
            });
            await prisma.productStock.upsert({
                where: {
                    tenant_id_product_id_warehouse_id: {
                        tenant_id: tenant.id,
                        product_id: existing.id,
                        warehouse_id: defaultWarehouse.id,
                    },
                },
                update: {},
                create: {
                    tenant_id: tenant.id,
                    product_id: existing.id,
                    warehouse_id: defaultWarehouse.id,
                    quantity: def.stock,
                },
            });
            products.push(existing);
        } else {
            const p = await prisma.product.create({
                data: {
                    tenant_id: tenant.id,
                    name: def.name,
                    sku: def.sku,
                    price: def.price,
                    image_url: def.image_url,
                    group_id: productGroups.get(def.group)?.id,
                    subgroup_id: productSubgroups.get(`${def.group}:${def.subgroup}`)?.id,
                    stocks: { create: { tenant_id: tenant.id, warehouse_id: defaultWarehouse.id, quantity: def.stock } },
                },
            });
            products.push(p);
        }
    }

    // ── 5b. Customer Groups ─────────────────────────────────────────────────
    const groupDefs = [
        { name: 'Retail',    description: 'Walk-in retail customers',    default_discount_pct: 0 },
        { name: 'Wholesale', description: 'Bulk buyers with discounts',  default_discount_pct: 10 },
        { name: 'VIP Members', description: 'Premium loyalty members',   default_discount_pct: 15 },
    ];

    const groups: any[] = [];
    for (const def of groupDefs) {
        const g = await prisma.customerGroup.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: def.name } },
            update: {},
            create: { tenant_id: tenant.id, ...def },
        });
        groups.push(g);
    }

    // ── 5c. Territories ──────────────────────────────────────────────────────
    const findOrCreateTerritory = async (name: string, parentId?: string, description?: string) => {
        const existing = await prisma.territory.findFirst({
            where: { tenant_id: tenant.id, name, parent_id: parentId ?? null },
        });
        if (existing) return existing;
        return prisma.territory.create({
            data: { tenant_id: tenant.id, name, parent_id: parentId ?? undefined, description },
        });
    };

    const dhakaRoot = await findOrCreateTerritory('Dhaka', undefined, 'Dhaka Division');
    const chittagongRoot = await findOrCreateTerritory('Chittagong', undefined, 'Chittagong Division');

    const subTerritoryDefs = [
        { name: 'Gulshan',    parent_id: dhakaRoot.id },
        { name: 'Dhanmondi',  parent_id: dhakaRoot.id },
        { name: 'Mirpur',     parent_id: dhakaRoot.id },
        { name: 'Uttara',     parent_id: dhakaRoot.id },
        { name: 'Banani',     parent_id: dhakaRoot.id },
    ];

    const subTerritories: any[] = [];
    for (const def of subTerritoryDefs) {
        const t = await findOrCreateTerritory(def.name, def.parent_id);
        subTerritories.push(t);
    }

    // ── 6. Customers ─────────────────────────────────────────────────────────
    const customerDefs = [
        { name: 'Rahim Chowdhury',  phone: '+8801711000001', email: 'rahim@gmail.com',    address: 'Mirpur-10, Dhaka',    code: 'CUST-00001', group: groups[0], territory: subTerritories[2], type: 'INDIVIDUAL' as const },
        { name: 'Fatema Begum',     phone: '+8801812000002', email: 'fatema@yahoo.com',   address: 'Dhanmondi, Dhaka',    code: 'CUST-00002', group: groups[0], territory: subTerritories[1], type: 'INDIVIDUAL' as const },
        { name: 'Karim Hossain',    phone: '+8801913000003', email: null,                  address: 'Uttara, Dhaka',       code: 'CUST-00003', group: groups[1], territory: subTerritories[3], type: 'INDIVIDUAL' as const },
        { name: 'Sabina Akter',     phone: '+8801714000004', email: 'sabina@gmail.com',   address: 'Mohakhali, Dhaka',    code: 'CUST-00004', group: groups[0], territory: subTerritories[4], type: 'INDIVIDUAL' as const },
        { name: 'Jahangir Alam',    phone: '+8801815000005', email: null,                  address: 'Tejgaon, Dhaka',      code: 'CUST-00005', group: groups[1], territory: subTerritories[1], type: 'ORGANIZATION' as const },
        { name: 'Nasrin Sultana',   phone: '+8801916000006', email: 'nasrin@hotmail.com', address: 'Banani, Dhaka',       code: 'CUST-00006', group: groups[2], territory: subTerritories[4], type: 'INDIVIDUAL' as const },
        { name: 'Mizanur Rahman',   phone: '+8801717000007', email: null,                  address: 'Bashundhara, Dhaka',  code: 'CUST-00007', group: groups[1], territory: subTerritories[3], type: 'ORGANIZATION' as const },
        { name: 'Roksana Parvin',   phone: '+8801818000008', email: 'roksana@gmail.com',  address: 'Gulshan, Dhaka',      code: 'CUST-00008', group: groups[2], territory: subTerritories[0], type: 'INDIVIDUAL' as const },
        { name: 'Motiur Rahman',    phone: '+8801919000009', email: null,                  address: 'Wari, Dhaka',         code: 'CUST-00009', group: groups[0], territory: subTerritories[2], type: 'INDIVIDUAL' as const },
        { name: 'Taslima Khanam',   phone: '+8801720000010', email: 'taslima@gmail.com',  address: 'Shyamoli, Dhaka',     code: 'CUST-00010', group: groups[2], territory: subTerritories[1], type: 'INDIVIDUAL' as const },
        { name: 'Anwar Hossain',    phone: '+8801821000011', email: null,                  address: 'Rampura, Dhaka',      code: 'CUST-00011', group: groups[0], territory: subTerritories[2], type: 'INDIVIDUAL' as const },
        { name: 'Halima Khatun',    phone: '+8801922000012', email: 'halima@gmail.com',   address: 'Khilgaon, Dhaka',     code: 'CUST-00012', group: groups[0], territory: subTerritories[1], type: 'INDIVIDUAL' as const },
    ];

    const customers: any[] = [];
    for (const def of customerDefs) {
        const c = await prisma.customer.upsert({
            where: { tenant_id_phone: { tenant_id: tenant.id, phone: def.phone } },
            update: {
                customer_code: def.code,
                customer_type: def.type,
                customer_group_id: def.group.id,
                territory_id: def.territory.id,
            },
            create: {
                tenant_id: tenant.id,
                customer_code: def.code,
                name: def.name,
                phone: def.phone,
                email: def.email ?? undefined,
                address: def.address,
                customer_type: def.type,
                customer_group_id: def.group.id,
                territory_id: def.territory.id,
            },
        });
        customers.push(c);
    }

    // ── 7. Sales (historical) ────────────────────────────────────────────────
    const salesDefs = [
        {
            customer: customers[0], note: 'Regular weekly order',
            items: [{ p: products[0], qty: 2 }, { p: products[4], qty: 6 }],
            payments: [{ method: 'CASH', amount: 850 }],
        },
        {
            customer: customers[1], note: null,
            items: [{ p: products[2], qty: 3 }, { p: products[3], qty: 1 }, { p: products[14], qty: 2 }],
            payments: [{ method: 'BKASH', amount: 585 }],
        },
        {
            customer: customers[2], note: 'Bulk spices',
            items: [{ p: products[10], qty: 5 }, { p: products[11], qty: 5 }],
            payments: [{ method: 'CASH', amount: 300 }, { method: 'BKASH', amount: 200 }],
        },
        {
            customer: customers[3], note: null,
            items: [{ p: products[12], qty: 2 }, { p: products[13], qty: 1 }],
            payments: [{ method: 'CARD', amount: 580 }],
        },
        {
            customer: customers[4], note: 'Office supplies',
            items: [{ p: products[6], qty: 5 }, { p: products[8], qty: 4 }, { p: products[9], qty: 2 }],
            payments: [{ method: 'CASH', amount: 1190 }],
        },
        {
            customer: customers[5], note: null,
            items: [{ p: products[1], qty: 2 }, { p: products[16], qty: 1 }, { p: products[17], qty: 1 }],
            payments: [{ method: 'BKASH', amount: 700 }],
        },
        {
            customer: customers[6], note: 'Catering order',
            items: [{ p: products[4], qty: 20 }, { p: products[6], qty: 10 }, { p: products[7], qty: 6 }],
            payments: [{ method: 'CASH', amount: 2000 }, { method: 'BKASH', amount: 750 }],
        },
        {
            customer: customers[7], note: null,
            items: [{ p: products[15], qty: 2 }, { p: products[16], qty: 2 }, { p: products[5], qty: 1 }],
            payments: [{ method: 'CARD', amount: 490 }],
        },
        {
            customer: customers[8], note: null,
            items: [{ p: products[18], qty: 1 }, { p: products[0], qty: 1 }],
            payments: [{ method: 'CASH', amount: 515 }],
        },
        {
            customer: customers[9], note: 'Birthday party snacks',
            items: [{ p: products[12], qty: 5 }, { p: products[13], qty: 2 }, { p: products[14], qty: 4 }],
            payments: [{ method: 'BKASH', amount: 1330 }],
        },
        {
            customer: customers[10], note: null,
            items: [{ p: products[4], qty: 12 }, { p: products[19], qty: 3 }],
            payments: [{ method: 'CASH', amount: 570 }],
        },
        {
            customer: customers[11], note: null,
            items: [{ p: products[2], qty: 4 }, { p: products[3], qty: 2 }, { p: products[11], qty: 3 }],
            payments: [{ method: 'CARD', amount: 755 }],
        },
        // Walk-in sales (no customer)
        {
            customer: null, note: 'Walk-in',
            items: [{ p: products[14], qty: 3 }, { p: products[4], qty: 2 }],
            payments: [{ method: 'CASH', amount: 310 }],
        },
        {
            customer: null, note: null,
            items: [{ p: products[0], qty: 1 }, { p: products[2], qty: 2 }],
            payments: [{ method: 'BKASH', amount: 510 }],
        },
        {
            customer: null, note: 'Quick sale',
            items: [{ p: products[15], qty: 1 }, { p: products[16], qty: 1 }],
            payments: [{ method: 'CASH', amount: 190 }],
        },
    ];

    let saleIndex = 0;
    for (const def of salesDefs) {
        saleIndex++;
        const serialNumber = `SL-SEED-${String(saleIndex).padStart(4, '0')}`;
        const existing = await prisma.sale.findUnique({
            where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: serialNumber } },
        });
        if (existing) continue;

        const totalAmount = def.items.reduce(
            (sum, i) => sum + Number(i.p.price) * i.qty, 0
        );
        const amountPaid = def.payments.reduce((sum, p) => sum + p.amount, 0);

        const sale = await prisma.sale.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                customer_id: def.customer?.id ?? null,
                serial_number: serialNumber,
                total_amount: totalAmount,
                amount_paid: amountPaid,
                status: 'COMPLETED',
                note: def.note ?? null,
                items: {
                    create: def.items.map(i => ({
                        product_id: i.p.id,
                        quantity: i.qty,
                        price_at_sale: Number(i.p.price),
                    })),
                },
                payments: {
                    create: def.payments.map(p => ({
                        payment_method: p.method,
                        amount: p.amount,
                    })),
                },
            },
        });

        // Update customer total_spent
        if (def.customer) {
            await prisma.customer.update({
                where: { id: def.customer.id },
                data: { total_spent: { increment: totalAmount } },
            });
        }
    }

    // ── 8. Additional Warehouse ──────────────────────────────────────────────
    let backupWarehouse = await prisma.warehouse.findFirst({
        where: { tenant_id: tenant.id, store_id: store.id, name: 'Gulshan Back Storage' },
    });
    if (!backupWarehouse) {
        backupWarehouse = await prisma.warehouse.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                name: 'Gulshan Back Storage',
                code: `WH-${store.id.slice(0, 6).toUpperCase()}-BCK`,
                is_default: false,
                is_active: true,
            },
        });
    }

    // ── 9. Additional Accounts ────────────────────────────────────────────────
    const currentAssetsGroup = await prisma.accountGroup.findFirst({
        where: { tenant_id: tenant.id, name: 'Current Assets' },
    });
    const expensesGroup = await prisma.accountGroup.findFirst({
        where: { tenant_id: tenant.id, name: 'Operating Expenses' },
    });
    const cashBankSubgroup = currentAssetsGroup
        ? await prisma.accountSubgroup.findFirst({ where: { group_id: currentAssetsGroup.id, name: 'Cash and Bank' } })
        : null;

    if (currentAssetsGroup && cashBankSubgroup) {
        // Mobile wallet accounts
        for (const [name, code] of [['bKash Account', '1015'], ['Nagad Account', '1016'], ['Rocket Account', '1017']] as [string, string][]) {
            await prisma.account.upsert({
                where: { tenant_id_name: { tenant_id: tenant.id, name } },
                update: {},
                create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, subgroup_id: cashBankSubgroup.id, name, code, type: 'asset', category: 'cash' },
            });
        }
    }

    if (currentAssetsGroup) {
        const receivablesSubgroup = await prisma.accountSubgroup.upsert({
            where: { group_id_name: { group_id: currentAssetsGroup.id, name: 'Receivables' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, name: 'Receivables' },
        });
        await prisma.account.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: 'Accounts Receivable' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, subgroup_id: receivablesSubgroup.id, name: 'Accounts Receivable', code: '1030', type: 'asset', category: 'general' },
        });

        const inventorySubgroup = await prisma.accountSubgroup.upsert({
            where: { group_id_name: { group_id: currentAssetsGroup.id, name: 'Inventory' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, name: 'Inventory' },
        });
        await prisma.account.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: 'Stock on Hand' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, subgroup_id: inventorySubgroup.id, name: 'Stock on Hand', code: '1040', type: 'asset', category: 'general' },
        });
        await prisma.account.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: 'Goods in Transit' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: currentAssetsGroup.id, subgroup_id: inventorySubgroup.id, name: 'Goods in Transit', code: '1041', type: 'asset', category: 'general' },
        });
    }

    if (expensesGroup) {
        const cogsSubgroup = await prisma.accountSubgroup.upsert({
            where: { group_id_name: { group_id: expensesGroup.id, name: 'Cost of Goods Sold' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: expensesGroup.id, name: 'Cost of Goods Sold' },
        });
        await prisma.account.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: 'Cost of Goods Sold' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: expensesGroup.id, subgroup_id: cogsSubgroup.id, name: 'Cost of Goods Sold', code: '5020', type: 'expense', category: 'general' },
        });

        const overheadSubgroup = await prisma.accountSubgroup.upsert({
            where: { group_id_name: { group_id: expensesGroup.id, name: 'Overhead' } },
            update: {},
            create: { tenant_id: tenant.id, group_id: expensesGroup.id, name: 'Overhead' },
        });
        for (const [name, code] of [['Rent Expense', '5030'], ['Staff Salaries', '5040'], ['Utilities Expense', '5050'], ['Marketing Expense', '5060']] as [string, string][]) {
            await prisma.account.upsert({
                where: { tenant_id_name: { tenant_id: tenant.id, name } },
                update: {},
                create: { tenant_id: tenant.id, group_id: expensesGroup.id, subgroup_id: overheadSubgroup.id, name, code, type: 'expense', category: 'general' },
            });
        }
    }

    // ── 9b. Additional Posting Rules (demo) ──────────────────────────────────
    // The bootstrap covers the basic cases. These rules handle credit sales,
    // mobile-wallet payments, and the specific condition keys used by the
    // stock-take and warehouse-transfer modules (which bootstrap leaves
    // unmatched, causing those events to be skipped).
    {
        const allAccounts = await prisma.account.findMany({
            where: { tenant_id: tenant.id },
            select: { id: true, name: true },
        });
        const acctByName = new Map(allAccounts.map((a) => [a.name, a.id]));

        const extraRules: Array<{
            event_type: 'sale' | 'sale_return' | 'purchase' | 'purchase_return' | 'inventory_adjustment' | 'fund_movement';
            condition_key: 'payment_mode' | 'reason_type' | 'transfer_scope' | 'none';
            condition_value: string | null;
            debit_account: string;
            credit_account: string;
            priority: number;
        }> = [
            // ── Sales: credit (on-account) ──────────────────────────────────
            { event_type: 'sale',        condition_key: 'payment_mode',  condition_value: 'credit',      debit_account: 'Accounts Receivable', credit_account: 'Sales Revenue',          priority: 30 },
            // ── Sales: mobile wallets ───────────────────────────────────────
            { event_type: 'sale',        condition_key: 'payment_mode',  condition_value: 'bkash',       debit_account: 'bKash Account',       credit_account: 'Sales Revenue',          priority: 40 },
            { event_type: 'sale',        condition_key: 'payment_mode',  condition_value: 'nagad',       debit_account: 'Nagad Account',       credit_account: 'Sales Revenue',          priority: 50 },
            { event_type: 'sale',        condition_key: 'payment_mode',  condition_value: 'rocket',      debit_account: 'Rocket Account',      credit_account: 'Sales Revenue',          priority: 60 },
            // ── Sales returns: credit (on-account) ─────────────────────────
            { event_type: 'sale_return', condition_key: 'payment_mode',  condition_value: 'credit',      debit_account: 'Sales Revenue',       credit_account: 'Accounts Receivable',    priority: 30 },
            // ── Sales returns: mobile wallets ───────────────────────────────
            { event_type: 'sale_return', condition_key: 'payment_mode',  condition_value: 'bkash',       debit_account: 'Sales Revenue',       credit_account: 'bKash Account',          priority: 40 },
            { event_type: 'sale_return', condition_key: 'payment_mode',  condition_value: 'nagad',       debit_account: 'Sales Revenue',       credit_account: 'Nagad Account',          priority: 50 },
            // ── Inventory adjustment: stock-take discrepancy ────────────────
            // Specific rule wins over the generic 'none' fallback in bootstrap.
            { event_type: 'inventory_adjustment', condition_key: 'reason_type', condition_value: 'DISCREPANCY', debit_account: 'Cost of Goods Sold', credit_account: 'Stock on Hand', priority: 10 },
            // ── Warehouse transfers: inter-store (cross-branch) ─────────────
            // Goods leave source stock and enter transit.
            { event_type: 'fund_movement', condition_key: 'transfer_scope', condition_value: 'inter_store', debit_account: 'Goods in Transit', credit_account: 'Stock on Hand', priority: 10 },
            // ── Warehouse transfers: intra-store (same branch) ──────────────
            // Immediate receipt: goods move straight from transit/staging to stock.
            { event_type: 'fund_movement', condition_key: 'transfer_scope', condition_value: 'intra_store', debit_account: 'Stock on Hand', credit_account: 'Goods in Transit', priority: 20 },
        ];

        for (const rule of extraRules) {
            const debitId  = acctByName.get(rule.debit_account);
            const creditId = acctByName.get(rule.credit_account);
            if (!debitId || !creditId) continue;

            const exists = await prisma.postingRule.findFirst({
                where: {
                    tenant_id:       tenant.id,
                    event_type:      rule.event_type,
                    condition_key:   rule.condition_key,
                    condition_value: rule.condition_value,
                },
                select: { id: true },
            });
            if (exists) continue;

            await prisma.postingRule.create({
                data: {
                    tenant_id:        tenant.id,
                    event_type:       rule.event_type,
                    condition_key:    rule.condition_key,
                    condition_value:  rule.condition_value,
                    debit_account_id: debitId,
                    credit_account_id: creditId,
                    priority:         rule.priority,
                    is_active:        true,
                },
            });
        }
    }

    // ── 10. Suppliers ─────────────────────────────────────────────────────────
    const supplierDefs = [
        { name: 'Agro Fresh Ltd.',        phone: '+880-2-9876543',  email: 'info@agrofresh.bd',    address: 'Tejgaon Industrial Area, Dhaka' },
        { name: 'Dhaka Beverages Co.',    phone: '+8801900111222',  email: 'sales@dhakabev.bd',    address: 'Narayanganj, Dhaka' },
        { name: 'Pran-RFL Group',         phone: '+880-2-8812345',  email: 'orders@pran.com.bd',   address: 'Maona, Gazipur' },
        { name: 'Square Food & Beverage', phone: '+880-2-9967890',  email: 'trade@square-bd.com',  address: 'Manikganj, Dhaka' },
        { name: 'Bengal Grains Ltd.',     phone: '+8801711555666',  email: 'supply@bengalgrains.bd', address: 'Gopalganj' },
        { name: 'Chittagong Spice House', phone: '+88031-888777',   email: 'spices@ctgspice.bd',   address: 'Agrabad, Chittagong' },
    ];

    const suppliers: any[] = [];
    for (const def of supplierDefs) {
        const s = await prisma.supplier.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: def.name } },
            update: {},
            create: { tenant_id: tenant.id, ...def },
        });
        suppliers.push(s);
    }

    // ── 11. Purchases ─────────────────────────────────────────────────────────
    const purchaseDefs = [
        {
            supplier: suppliers[0], number: 'PO-SEED-0001', notes: 'Monthly grocery restock',
            items: [
                { p: products[6],  qty: 50, cost: 90  },   // Basmati Rice
                { p: products[7],  qty: 30, cost: 60  },   // Chickpeas
                { p: products[8],  qty: 40, cost: 50  },   // Lentils
                { p: products[9],  qty: 20, cost: 155 },   // Sunflower Oil
            ],
        },
        {
            supplier: suppliers[1], number: 'PO-SEED-0002', notes: 'Beverage stock top-up',
            items: [
                { p: products[0],  qty: 30, cost: 260 },   // Arabica Coffee
                { p: products[1],  qty: 20, cost: 140 },   // Cold Brew
                { p: products[4],  qty: 100, cost: 25 },   // Mineral Water
                { p: products[5],  qty: 20, cost: 90  },   // Orange Juice
            ],
        },
        {
            supplier: suppliers[2], number: 'PO-SEED-0003', notes: null,
            items: [
                { p: products[2],  qty: 50, cost: 72  },   // Green Tea
                { p: products[3],  qty: 40, cost: 110 },   // Masala Chai
                { p: products[12], qty: 20, cost: 110 },   // Dark Chocolate
                { p: products[13], qty: 15, cost: 220 },   // Mixed Nuts
                { p: products[14], qty: 25, cost: 60  },   // Potato Chips
            ],
        },
        {
            supplier: suppliers[4], number: 'PO-SEED-0004', notes: 'Quarterly grains purchase',
            items: [
                { p: products[6],  qty: 100, cost: 88 },   // Basmati Rice
                { p: products[7],  qty: 50, cost: 58  },   // Chickpeas
                { p: products[8],  qty: 60, cost: 48  },   // Lentils
            ],
        },
        {
            supplier: suppliers[5], number: 'PO-SEED-0005', notes: 'Spice restocking',
            items: [
                { p: products[10], qty: 60, cost: 40  },   // Turmeric
                { p: products[11], qty: 60, cost: 32  },   // Cumin Seeds
            ],
        },
        {
            supplier: suppliers[3], number: 'PO-SEED-0006', notes: 'Bakery & dairy supplies',
            items: [
                { p: products[15], qty: 20, cost: 45  },   // Whole Wheat Bread
                { p: products[16], qty: 30, cost: 100 },   // Butter
                { p: products[17], qty: 20, cost: 175 },   // Cheddar Cheese
            ],
        },
    ];

    for (const def of purchaseDefs) {
        const existing = await prisma.purchase.findUnique({
            where: { tenant_id_purchase_number: { tenant_id: tenant.id, purchase_number: def.number } },
        });
        if (existing) continue;

        const subtotal = def.items.reduce((s, i) => s + i.qty * i.cost, 0);
        await prisma.purchase.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                supplier_id: def.supplier.id,
                purchase_number: def.number,
                subtotal_amount: subtotal,
                total_amount: subtotal,
                notes: def.notes ?? null,
                items: {
                    create: def.items.map(i => ({
                        product_id: i.p.id,
                        quantity: i.qty,
                        unit_cost: i.cost,
                        line_total: i.qty * i.cost,
                    })),
                },
            },
        });
    }

    // ── 12. Sales Returns ─────────────────────────────────────────────────────
    const returnSources = await Promise.all([
        prisma.sale.findUnique({ where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: 'SL-SEED-0001' } }, include: { items: true } }),
        prisma.sale.findUnique({ where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: 'SL-SEED-0003' } }, include: { items: true } }),
        prisma.sale.findUnique({ where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: 'SL-SEED-0007' } }, include: { items: true } }),
        prisma.sale.findUnique({ where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: 'SL-SEED-0010' } }, include: { items: true } }),
    ]);

    type ReturnDef = {
        sale: typeof returnSources[0];
        number: string;
        reason: string;
        returnItems: (items: { id: string; product_id: string; price_at_sale: any }[]) => { id: string; product_id: string; price_at_sale: any; qty: number }[];
    };

    const salesReturnDefs: ReturnDef[] = [
        {
            sale: returnSources[0],
            number: 'SR-SEED-0001',
            reason: 'Product damaged on delivery',
            returnItems: (items) => {
                const item = items.find(i => i.product_id === products[0].id);
                return item ? [{ ...item, qty: 1 }] : [];
            },
        },
        {
            sale: returnSources[1],
            number: 'SR-SEED-0002',
            reason: 'Customer changed mind',
            returnItems: (items) => {
                const item = items.find(i => i.product_id === products[10].id);
                return item ? [{ ...item, qty: 2 }] : [];
            },
        },
        {
            sale: returnSources[2],
            number: 'SR-SEED-0003',
            reason: 'Expiry concern raised by customer',
            returnItems: (items) => {
                const item = items.find(i => i.product_id === products[4].id);
                return item ? [{ ...item, qty: 5 }] : [];
            },
        },
        {
            sale: returnSources[3],
            number: 'SR-SEED-0004',
            reason: 'Wrong item delivered',
            returnItems: (items) => {
                const item = items.find(i => i.product_id === products[12].id);
                return item ? [{ ...item, qty: 1 }] : [];
            },
        },
    ];

    for (const def of salesReturnDefs) {
        if (!def.sale) continue;
        const existing = await prisma.salesReturn.findUnique({
            where: { tenant_id_return_number: { tenant_id: tenant.id, return_number: def.number } },
        });
        if (existing) continue;

        const itemsToReturn = def.returnItems(def.sale.items);
        if (!itemsToReturn.length) continue;

        const totalRefund = itemsToReturn.reduce((s, ri) => s + Number(ri.price_at_sale) * ri.qty, 0);
        await prisma.salesReturn.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                sale_id: def.sale.id,
                return_number: def.number,
                total_refund: totalRefund,
                reason: def.reason,
                status: 'COMPLETED',
                items: {
                    create: itemsToReturn.map(ri => ({
                        sale_item_id: ri.id,
                        product_id: ri.product_id,
                        quantity: ri.qty,
                        refund_amount: Number(ri.price_at_sale) * ri.qty,
                    })),
                },
            },
        });
    }

    // ── 13. HR seed data ─────────────────────────────────────────────────────
    const deptDefs = ['Sales', 'Operations', 'Finance', 'IT'];
    const deptMap = new Map<string, string>();
    for (const name of deptDefs) {
        const dept = await prisma.department.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name } },
            update: {},
            create: { tenant_id: tenant.id, name },
        });
        deptMap.set(name, dept.id);
    }

    const desgDefs = ['Manager', 'Cashier', 'Sales Associate', 'Accountant'];
    const desgMap = new Map<string, string>();
    for (const name of desgDefs) {
        const desg = await prisma.designation.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name } },
            update: {},
            create: { tenant_id: tenant.id, name },
        });
        desgMap.set(name, desg.id);
    }

    const empDefs = [
        { name: 'Rafiq Islam',    phone: '+8801811111101', email: 'manager@retailsaas.com', dept: 'Operations', desg: 'Manager',       doj: '2023-01-15', user_id: managerUser.id },
        { name: 'Sumaiya Khatun', phone: '+8801811111102', email: 'cashier@retailsaas.com', dept: 'Sales',      desg: 'Cashier',       doj: '2023-03-01', user_id: cashierUser.id },
        { name: 'Karim Ahmed',    phone: '+8801811111103', email: null,                      dept: 'Finance',    desg: 'Accountant',    doj: '2024-06-01', user_id: null },
        { name: 'Fatema Begum',   phone: '+8801811111104', email: null,                      dept: 'Sales',      desg: 'Sales Associate', doj: '2024-09-10', user_id: null },
    ];

    let empCodeCounter = 1;
    for (const e of empDefs) {
        const existingEmp = await prisma.employee.findFirst({
            where: { tenant_id: tenant.id, phone: e.phone },
        });
        if (!existingEmp) {
            const code = `EMP-${String(empCodeCounter).padStart(5, '0')}`;
            await prisma.employee.create({
                data: {
                    tenant_id: tenant.id,
                    employee_code: code,
                    name: e.name,
                    phone: e.phone,
                    ...(e.email ? { email: e.email } : {}),
                    date_of_joining: new Date(e.doj),
                    department_id: deptMap.get(e.dept) ?? null,
                    designation_id: desgMap.get(e.desg) ?? null,
                    ...(e.user_id ? { user_id: e.user_id } : {}),
                    status: 'ACTIVE',
                },
            });
        }
        empCodeCounter++;
    }

    // ── 14. Leave types (HR seed) ─────────────────────────────────────────────
    const leaveTypeData = [
        { name: 'Annual Leave', days_per_year: 15 },
        { name: 'Sick Leave', days_per_year: 10 },
        { name: 'Casual Leave', days_per_year: 7 },
        { name: 'Unpaid Leave', days_per_year: 0 },
    ];

    for (const lt of leaveTypeData) {
        await prisma.leaveType.upsert({
            where: { tenant_id_name: { tenant_id: tenant.id, name: lt.name } },
            update: { days_per_year: lt.days_per_year },
            create: { tenant_id: tenant.id, name: lt.name, days_per_year: lt.days_per_year },
        });
    }

    // ── 15. Summary ──────────────────────────────────────────────────────────
    const productCount    = await prisma.product.count({ where: { tenant_id: tenant.id } });
    const customerCount    = await prisma.customer.count({ where: { tenant_id: tenant.id } });
    const saleCount        = await prisma.sale.count({ where: { tenant_id: tenant.id } });
    const returnCount      = await prisma.salesReturn.count({ where: { tenant_id: tenant.id } });
    const groupCount       = await prisma.customerGroup.count({ where: { tenant_id: tenant.id } });
    const territoryCount   = await prisma.territory.count({ where: { tenant_id: tenant.id } });
    const storeAccessCount = await prisma.userStoreAccess.count({ where: { tenant_id: tenant.id } });
    const permCount        = await prisma.userStorePermission.count({ where: { tenant_id: tenant.id } });
    const supplierCount    = await prisma.supplier.count({ where: { tenant_id: tenant.id } });
    const purchaseCount    = await prisma.purchase.count({ where: { tenant_id: tenant.id } });
    const accountCount     = await prisma.account.count({ where: { tenant_id: tenant.id } });
    const warehouseCount   = await prisma.warehouse.count({ where: { tenant_id: tenant.id } });
    const postingRuleCount = await prisma.postingRule.count({ where: { tenant_id: tenant.id } });

    console.log('\n✅  Seed complete');
    console.log('─────────────────────────────────────');
    console.log(`👤  Users:           admin / manager / cashier  (password: password123)`);
    console.log(`🏪  Tenant:          ${tenant.name}`);
    console.log(`🏬  Stores:          ${store.name} + ${store2.name}`);
    console.log(`🏭  Warehouses:      ${warehouseCount}`);
    console.log(`📦  Products:        ${productCount}`);
    console.log(`🏷️   Suppliers:       ${supplierCount}`);
    console.log(`👥  Customers:       ${customerCount}`);
    console.log(`📂  Customer Groups: ${groupCount}`);
    console.log(`🗺️   Territories:     ${territoryCount}`);
    console.log(`🧾  Sales:           ${saleCount}`);
    console.log(`↩️   Sales Returns:   ${returnCount}`);
    console.log(`🛒  Purchases:       ${purchaseCount}`);
    console.log(`📒  Accounts (CoA):  ${accountCount}`);
    console.log(`📐  Posting Rules:   ${postingRuleCount}`);
    console.log(`🔑  Store Access:    ${storeAccessCount} entries`);
    console.log(`🛡️   Permissions:     ${permCount} entries`);
    console.log('─────────────────────────────────────');
    console.log('Login → http://localhost:3000');
    console.log('Email: nayeem.ahmad@gmail.com  |  Password: password123');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
