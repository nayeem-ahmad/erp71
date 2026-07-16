"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_ACCOUNT_PASSWORD = exports.DEMO_ACCOUNT_EMAIL = void 0;
exports.seedDemoAccount = seedDemoAccount;
const bcrypt = __importStar(require("bcrypt"));
const bootstrap_accounting_1 = require("./bootstrap-accounting");
const shared_types_1 = require("@erp71/shared-types");
exports.DEMO_ACCOUNT_EMAIL = 'demo@erp71.com';
exports.DEMO_ACCOUNT_PASSWORD = 'demo123456';
/**
 * Idempotent sandbox scaffolding for the public demo login (POST /auth/demo).
 *
 * This creates *only* the scaffolding a tenant needs to exist — user, tenant,
 * subscription, two stores, warehouses, inventory settings, store permissions,
 * inventory reasons, and the default accounting chart. It deliberately seeds NO
 * products, customers, or sales: transaction history comes from the six-month
 * demo-data generator in `apps/backend/src/demo-data`, which drives the real
 * inventory + accounting primitives with backdated dates. The CLI (`npm run
 * seed:demo`) calls this, then runs that generator against the returned tenant.
 */
async function seedDemoAccount(prisma) {
    const passwordHash = await bcrypt.hash(exports.DEMO_ACCOUNT_PASSWORD, 10);
    const user = await prisma.user.upsert({
        where: { email: exports.DEMO_ACCOUNT_EMAIL },
        update: { name: 'Demo User', email_verified_at: new Date() },
        create: {
            email: exports.DEMO_ACCOUNT_EMAIL,
            passwordHash,
            name: 'Demo User',
            email_verified_at: new Date(),
        },
    });
    let tenant = await prisma.tenant.findFirst({
        where: { owner_id: user.id, name: 'Demo Store' },
    });
    if (!tenant) {
        tenant = await prisma.tenant.create({
            data: { name: 'Demo Store', owner_id: user.id },
        });
    }
    await prisma.tenantUser.upsert({
        where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: user.id } },
        update: { role: 'OWNER' },
        create: { tenant_id: tenant.id, user_id: user.id, role: 'OWNER' },
    });
    const standardPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'STANDARD' } });
    if (!standardPlan) {
        throw new Error('STANDARD subscription plan not found. Run database seed first.');
    }
    await prisma.tenantSubscription.upsert({
        where: { tenant_id: tenant.id },
        update: {
            plan_id: standardPlan.id,
            status: 'ACTIVE',
            current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        create: {
            tenant_id: tenant.id,
            plan_id: standardPlan.id,
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            provider_name: 'demo',
        },
    });
    let store = await prisma.store.findFirst({
        where: { tenant_id: tenant.id, name: 'Main Branch' },
    });
    if (!store) {
        store = await prisma.store.create({
            data: {
                tenant_id: tenant.id,
                name: 'Main Branch',
                address: 'Gulshan, Dhaka, Bangladesh',
            },
        });
    }
    let secondStore = await prisma.store.findFirst({
        where: { tenant_id: tenant.id, name: 'Banani Branch' },
    });
    if (!secondStore) {
        secondStore = await prisma.store.create({
            data: {
                tenant_id: tenant.id,
                name: 'Banani Branch',
                address: 'Banani, Dhaka, Bangladesh',
            },
        });
    }
    const demoStores = [store, secondStore];
    const warehouseCode = `WH-DEMO-${store.id.slice(0, 6).toUpperCase()}`;
    let warehouse = await prisma.warehouse.findFirst({
        where: { tenant_id: tenant.id, store_id: store.id, is_default: true },
    });
    if (!warehouse) {
        warehouse = await prisma.warehouse.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                name: 'Main Branch Warehouse',
                code: warehouseCode,
                is_default: true,
                is_active: true,
            },
        });
    }
    await prisma.inventorySettings.upsert({
        where: { tenant_id: tenant.id },
        update: {
            default_product_warehouse_id: warehouse.id,
            default_purchase_warehouse_id: warehouse.id,
            default_sales_warehouse_id: warehouse.id,
            default_shrinkage_warehouse_id: warehouse.id,
            default_transfer_source_warehouse_id: warehouse.id,
            default_transfer_destination_warehouse_id: warehouse.id,
        },
        create: {
            tenant_id: tenant.id,
            default_product_warehouse_id: warehouse.id,
            default_purchase_warehouse_id: warehouse.id,
            default_sales_warehouse_id: warehouse.id,
            default_shrinkage_warehouse_id: warehouse.id,
            default_transfer_source_warehouse_id: warehouse.id,
            default_transfer_destination_warehouse_id: warehouse.id,
        },
    });
    for (const demoStore of demoStores) {
        await prisma.userStoreAccess.upsert({
            where: { user_id_store_id: { user_id: user.id, store_id: demoStore.id } },
            update: { access_level: 'MULTI_STORE_CAPABLE' },
            create: {
                user_id: user.id,
                store_id: demoStore.id,
                tenant_id: tenant.id,
                access_level: 'MULTI_STORE_CAPABLE',
            },
        });
        for (const permission of shared_types_1.ROLE_DEFAULT_PERMISSIONS[shared_types_1.UserRole.OWNER]) {
            await prisma.userStorePermission.upsert({
                where: {
                    user_id_store_id_permission: {
                        user_id: user.id,
                        store_id: demoStore.id,
                        permission,
                    },
                },
                update: {},
                create: {
                    user_id: user.id,
                    store_id: demoStore.id,
                    tenant_id: tenant.id,
                    permission,
                    granted_by: user.id,
                },
            });
        }
    }
    const secondWarehouseCode = `WH-DEMO-${secondStore.id.slice(0, 6).toUpperCase()}`;
    let secondWarehouse = await prisma.warehouse.findFirst({
        where: { tenant_id: tenant.id, store_id: secondStore.id, is_default: true },
    });
    if (!secondWarehouse) {
        secondWarehouse = await prisma.warehouse.create({
            data: {
                tenant_id: tenant.id,
                store_id: secondStore.id,
                name: 'Banani Branch Warehouse',
                code: secondWarehouseCode,
                is_default: true,
                is_active: true,
            },
        });
    }
    // Both DISCREPANCY (stock-take) and SHRINKAGE (write-off) reasons — the
    // generator exercises shrinkage, which looks reasons up by id and throws if
    // the SHRINKAGE rows are missing.
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
    await (0, bootstrap_accounting_1.bootstrapDefaultAccountingForTenant)(prisma, tenant.id);
    return {
        userId: user.id,
        tenantId: tenant.id,
        storeId: store.id,
        secondStoreId: secondStore.id,
        warehouseId: warehouse.id,
        secondWarehouseId: secondWarehouse.id,
    };
}
