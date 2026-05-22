// Idempotent demo seeder — safe to run multiple times
// Usage: npx ts-node -r tsconfig-paths/register scripts/seed-demo.ts
// Or: npm run seed:demo (add to backend package.json scripts)

import { PrismaClient } from '@retail-saas/database';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@retailsaas.app';
const DEMO_PASSWORD = 'demo123456';

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
];

const CUSTOMERS = [
    { name: 'Rahim Uddin', phone: '01711001001', code: 'CUST-0001' },
    { name: 'Nasrin Akter', phone: '01812002002', code: 'CUST-0002' },
    { name: 'Kamal Hossain', phone: '01913003003', code: 'CUST-0003' },
    { name: 'Farida Begum', phone: '01614004004', code: 'CUST-0004' },
    { name: 'Shafiqul Islam', phone: '01715005005', code: 'CUST-0005' },
];

async function main() {
    console.log('Seeding demo account...');

    // 1. Upsert demo user
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const user = await prisma.user.upsert({
        where: { email: DEMO_EMAIL },
        update: {},
        create: {
            email: DEMO_EMAIL,
            passwordHash,
            name: 'Demo User',
            email_verified_at: new Date(),
        },
    });
    console.log(`  User: ${user.id} (${user.email})`);

    // 2. Find or create demo tenant
    let tenant = await prisma.tenant.findFirst({
        where: { owner_id: user.id, name: 'Demo Store' },
    });
    if (!tenant) {
        tenant = await prisma.tenant.create({
            data: {
                name: 'Demo Store',
                owner_id: user.id,
            },
        });
    }
    console.log(`  Tenant: ${tenant.id} (${tenant.name})`);

    // 3. Upsert TenantUser membership (OWNER role)
    await prisma.tenantUser.upsert({
        where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: user.id } },
        update: {},
        create: {
            tenant_id: tenant.id,
            user_id: user.id,
            role: 'OWNER',
        },
    });

    // 4. Upsert BASIC subscription (1 year from now)
    const basicPlan = await prisma.subscriptionPlan.findUnique({
        where: { code: 'BASIC' },
    });
    if (!basicPlan) {
        throw new Error('BASIC subscription plan not found. Run database migrations/seeders first.');
    }
    await prisma.tenantSubscription.upsert({
        where: { tenant_id: tenant.id },
        update: {},
        create: {
            tenant_id: tenant.id,
            plan_id: basicPlan.id,
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            provider_name: 'demo',
        },
    });
    console.log('  Subscription: BASIC / ACTIVE (1-year period)');

    // 5. Create store (idempotent by name within tenant)
    let store = await prisma.store.findFirst({
        where: { tenant_id: tenant.id, name: 'Main Branch' },
    });
    if (!store) {
        store = await prisma.store.create({
            data: {
                tenant_id: tenant.id,
                name: 'Main Branch',
                address: 'Dhaka, Bangladesh',
            },
        });
    }
    console.log(`  Store: ${store.id} (${store.name})`);

    // 5b. Upsert UserStoreAccess for the demo user
    await prisma.userStoreAccess.upsert({
        where: { user_id_store_id: { user_id: user.id, store_id: store.id } },
        update: {},
        create: {
            user_id: user.id,
            store_id: store.id,
            tenant_id: tenant.id,
            access_level: 'MULTI_STORE_CAPABLE',
        },
    });

    // 6. Upsert 10 sample products
    const createdProducts: any[] = [];
    for (const p of PRODUCTS) {
        const product = await prisma.product.upsert({
            where: { tenant_id_sku: { tenant_id: tenant.id, sku: p.sku } },
            update: {},
            create: {
                tenant_id: tenant.id,
                name: p.name,
                sku: p.sku,
                price: p.price,
                reorder_level: p.reorder,
                unit_type: 'none',
            },
        });
        createdProducts.push({ product, stockQty: p.stock });
    }
    console.log(`  Products: ${createdProducts.length} upserted`);

    // 7. Upsert 5 sample customers
    const createdCustomers: any[] = [];
    for (const c of CUSTOMERS) {
        const customer = await prisma.customer.upsert({
            where: { tenant_id_phone: { tenant_id: tenant.id, phone: c.phone } },
            update: {},
            create: {
                tenant_id: tenant.id,
                customer_code: c.code,
                name: c.name,
                phone: c.phone,
                customer_type: 'INDIVIDUAL',
            },
        });
        createdCustomers.push(customer);
    }
    console.log(`  Customers: ${createdCustomers.length} upserted`);

    // 8. Create 3 sample sales (idempotent by serial_number)
    const sampleSales = [
        {
            serial: 'DEMO-SALE-0001',
            customerId: createdCustomers[0].id,
            items: [
                { productIdx: 0, qty: 2, price: 420 },
                { productIdx: 1, qty: 1, price: 185 },
            ],
        },
        {
            serial: 'DEMO-SALE-0002',
            customerId: createdCustomers[1].id,
            items: [
                { productIdx: 5, qty: 1, price: 250 },
                { productIdx: 6, qty: 2, price: 150 },
                { productIdx: 7, qty: 1, price: 120 },
            ],
        },
        {
            serial: 'DEMO-SALE-0003',
            customerId: createdCustomers[2].id,
            items: [
                { productIdx: 3, qty: 5, price: 40 },
                { productIdx: 8, qty: 3, price: 130 },
                { productIdx: 9, qty: 2, price: 165 },
            ],
        },
    ];

    for (const s of sampleSales) {
        const existing = await prisma.sale.findUnique({
            where: { tenant_id_serial_number: { tenant_id: tenant.id, serial_number: s.serial } },
        });
        if (!existing) {
            const totalAmount = s.items.reduce((sum, i) => sum + i.qty * i.price, 0);
            await prisma.sale.create({
                data: {
                    tenant_id: tenant.id,
                    store_id: store.id,
                    serial_number: s.serial,
                    total_amount: totalAmount,
                    amount_paid: totalAmount,
                    status: 'COMPLETED',
                    customer_id: s.customerId,
                    items: {
                        create: s.items.map((i) => ({
                            product_id: createdProducts[i.productIdx].product.id,
                            quantity: i.qty,
                            price_at_sale: i.price,
                        })),
                    },
                },
            });
        }
    }
    console.log('  Sales: 3 sample sales created (idempotent)');

    console.log('\nDemo seeded: email=demo@retailsaas.app password=demo123456');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
