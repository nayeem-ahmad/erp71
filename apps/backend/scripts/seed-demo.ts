import { PrismaClient, DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD, seedDemoAccount } from '@erp71/database';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding demo sandbox account...');
    const result = await seedDemoAccount(prisma);
    console.log(`  Tenant: ${result.tenantId}`);
    console.log(`  Store: ${result.storeId}`);
    console.log(`  Products: ${result.productCount}`);
    console.log(`  Customers: ${result.customerCount}`);
    console.log(`\nDemo ready: email=${DEMO_ACCOUNT_EMAIL} password=${DEMO_ACCOUNT_PASSWORD}`);
    console.log('One-click login: POST /api/v1/auth/demo or /demo on the frontend');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });