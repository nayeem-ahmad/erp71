import { PrismaClient, DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD, seedDemoAccount } from '@erp71/database';
import { runSimulation } from '../src/demo-data/generator/simulate';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding demo sandbox scaffolding...');
    const account = await seedDemoAccount(prisma);
    console.log(`  Tenant: ${account.tenantId}`);
    console.log(`  Store:  ${account.storeId}`);

    // Run the same six-month generator the "Load Demo Data" button uses, so the
    // sandbox and the button produce identical data through one code path.
    const priorBatches = await prisma.demoDataBatch.count({ where: { tenant_id: account.tenantId } });
    const batchNumber = priorBatches + 1;
    const batch = await prisma.demoDataBatch.create({
        data: { tenant_id: account.tenantId, batch_number: batchNumber, status: 'RUNNING', phase: 'Starting' },
    });

    console.log(`\nGenerating six months of demo history (batch ${batchNumber})...`);
    try {
        const counts = await runSimulation({
            db: prisma,
            tenantId: account.tenantId,
            userId: account.userId,
            batchNumber,
            onProgress: (p) => {
                process.stdout.write(`\r  ${p.phase.padEnd(40)} (${p.processed}/${p.total})   `);
            },
        });
        await prisma.demoDataBatch.update({
            where: { id: batch.id },
            data: { status: 'COMPLETED', phase: 'Completed', finished_at: new Date(), counts: counts as unknown as object },
        });
        console.log('\n\nGenerated:');
        for (const [key, value] of Object.entries(counts)) {
            console.log(`  ${key}: ${value}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.demoDataBatch.update({
            where: { id: batch.id },
            data: { status: 'FAILED', phase: 'Failed', error: message, finished_at: new Date() },
        });
        throw error;
    }

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
