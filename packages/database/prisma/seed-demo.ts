import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { bootstrapDefaultAccountingForTenant } from './bootstrap-accounting';
import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@erp71/shared-types';

export const DEMO_ACCOUNT_EMAIL = 'demo@erp71.com';
export const DEMO_ACCOUNT_PASSWORD = 'demo123456';

const PRODUCTS = [
    { name: 'Miniket Rice (5 kg)', sku: 'RICE-5KG-MNK', price: 420, stock: 200, reorder: 30 },
    { name: 'Soybean Oil (1 L)', sku: 'OIL-SOY-1L', price: 185, stock: 150, reorder: 25 },
    { name: 'Wheel Detergent Powder (500 g)', sku: 'DET-WHE-500G', price: 75, stock: 120, reorder: 20 },
    { name: 'Lifebuoy Soap (100 g)', sku: 'SOAP-LFB-100G', price: 40, stock: 250, reorder: 40 },
    { name: 'Arla Full Cream Milk Powder (500 g)', sku: 'MILK-ARL-500G', price: 480, stock: 80, reorder: 15 },
    { name: 'Walton iFlex Data Cable (USB-C)', sku: 'MOB-CBL-USBC', price: 250, stock: 60, reorder: 10 },
    { name: 'Symphony Mobile Cover (Universal)', sku: 'MOB-CVR-UNI', price: 150, stock: 90, reorder: 15 },
    { name: 'Screen Protector (Tempered Glass)', sku: 'MOB-SCRN-TMP', price: 120, stock: 75, reorder: 10 },
    { name: 'Fresh Sugar (1 kg)', sku: 'SUG-FRS-1KG', price: 130, stock: 180, reorder: 30 },
    { name: 'Lal Teer Mustard Oil (500 ml)', sku: 'OIL-MST-500ML', price: 165, stock: 100, reorder: 20 },
] as const;

const CUSTOMERS = [
    { name: 'Rahim Uddin', phone: '01711001001', code: 'CUST-0001' },
    { name: 'Nasrin Akter', phone: '01812002002', code: 'CUST-0002' },
    { name: 'Kamal Hossain', phone: '01913003003', code: 'CUST-0003' },
    { name: 'Farida Begum', phone: '01614004004', code: 'CUST-0004' },
    { name: 'Shafiqul Islam', phone: '01715005005', code: 'CUST-0005' },
] as const;

/** Idempotent sandbox tenant for public demo login (POST /auth/demo). */
export async function seedDemoAccount(prisma: PrismaClient) {
    const passwordHash = await bcrypt.hash(DEMO_ACCOUNT_PASSWORD, 10);
    const user = await prisma.user.upsert({
        where: { email: DEMO_ACCOUNT_EMAIL },
        update: { name: 'Demo User', email_verified_at: new Date() },
        create: {
            email: DEMO_ACCOUNT_EMAIL,
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

    await prisma.userStoreAccess.upsert({
        where: { user_id_store_id: { user_id: user.id, store_id: store.id } },
        update: { access_level: 'MULTI_STORE_CAPABLE' },
        create: {
            user_id: user.id,
            store_id: store.id,
            tenant_id: tenant.id,
            access_level: 'MULTI_STORE_CAPABLE',
        },
    });

    for (const permission of ROLE_DEFAULT_PERMISSIONS[UserRole.OWNER]) {
        await prisma.userStorePermission.upsert({
            where: {
                user_id_store_id_permission: {
                    user_id: user.id,
                    store_id: store.id,
                    permission,
                },
            },
            update: {},
            create: {
                user_id: user.id,
                store_id: store.id,
                tenant_id: tenant.id,
                permission,
                granted_by: user.id,
            },
        });
    }

    const inventoryReasonDefs = [
        { type: 'DISCREPANCY', code: 'COUNT_ERROR', label: 'Count Error' },
        { type: 'DISCREPANCY', code: 'RECONCILIATION', label: 'Reconciliation Adjustment' },
    ] as const;

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

    const createdProducts: Array<{ id: string; price: number }> = [];
    for (const productDef of PRODUCTS) {
        const product = await prisma.product.upsert({
            where: { tenant_id_sku: { tenant_id: tenant.id, sku: productDef.sku } },
            update: {
                name: productDef.name,
                price: productDef.price,
                reorder_level: productDef.reorder,
            },
            create: {
                tenant_id: tenant.id,
                name: productDef.name,
                sku: productDef.sku,
                price: productDef.price,
                reorder_level: productDef.reorder,
                unit_type: 'none',
            },
        });

        await prisma.productStock.upsert({
            where: {
                tenant_id_product_id_warehouse_id: {
                    tenant_id: tenant.id,
                    product_id: product.id,
                    warehouse_id: warehouse.id,
                },
            },
            update: { quantity: productDef.stock },
            create: {
                tenant_id: tenant.id,
                product_id: product.id,
                warehouse_id: warehouse.id,
                quantity: productDef.stock,
            },
        });

        createdProducts.push({ id: product.id, price: productDef.price });
    }

    const createdCustomers: Array<{ id: string }> = [];
    for (const customerDef of CUSTOMERS) {
        const customer = await prisma.customer.upsert({
            where: { tenant_id_phone: { tenant_id: tenant.id, phone: customerDef.phone } },
            update: { name: customerDef.name, customer_code: customerDef.code },
            create: {
                tenant_id: tenant.id,
                customer_code: customerDef.code,
                name: customerDef.name,
                phone: customerDef.phone,
                customer_type: 'INDIVIDUAL',
            },
        });
        createdCustomers.push(customer);
    }

    const sampleSales = [
        {
            serial: 'DEMO-SALE-0001',
            customerId: createdCustomers[0].id,
            items: [{ productIdx: 0, qty: 2 }, { productIdx: 1, qty: 1 }],
        },
        {
            serial: 'DEMO-SALE-0002',
            customerId: createdCustomers[1].id,
            items: [{ productIdx: 5, qty: 1 }, { productIdx: 6, qty: 2 }, { productIdx: 7, qty: 1 }],
        },
        {
            serial: 'DEMO-SALE-0003',
            customerId: createdCustomers[2].id,
            items: [{ productIdx: 3, qty: 5 }, { productIdx: 8, qty: 3 }, { productIdx: 9, qty: 2 }],
        },
    ] as const;

    for (const saleDef of sampleSales) {
        const existing = await prisma.sale.findUnique({
            where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: saleDef.serial } },
        });
        if (existing) continue;

        const totalAmount = saleDef.items.reduce(
            (sum, item) => sum + item.qty * createdProducts[item.productIdx].price,
            0,
        );

        await prisma.sale.create({
            data: {
                tenant_id: tenant.id,
                store_id: store.id,
                serial_number: saleDef.serial,
                total_amount: totalAmount,
                amount_paid: totalAmount,
                status: 'COMPLETED',
                customer_id: saleDef.customerId,
                items: {
                    create: saleDef.items.map((item) => ({
                        product_id: createdProducts[item.productIdx].id,
                        quantity: item.qty,
                        price_at_sale: createdProducts[item.productIdx].price,
                    })),
                },
            },
        });
    }

    return {
        userId: user.id,
        tenantId: tenant.id,
        storeId: store.id,
        productCount: createdProducts.length,
        customerCount: createdCustomers.length,
    };
}