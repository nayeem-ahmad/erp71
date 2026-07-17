import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { runSimulation, type SimulationProgress } from './generator/simulate';

@Injectable()
export class DemoDataService implements OnModuleInit {
    private readonly logger = new Logger(DemoDataService.name);

    constructor(private readonly db: DatabaseService) {}

    /**
     * A container restart mid-run would strand a batch in RUNNING forever. On
     * boot, fail any batch still marked RUNNING/PENDING — there is one backend
     * container, so nothing else can legitimately be mid-run.
     */
    async onModuleInit(): Promise<void> {
        const { count } = await this.db.demoDataBatch.updateMany({
            where: { status: { in: ['RUNNING', 'PENDING'] } },
            data: { status: 'FAILED', error: 'Interrupted by a server restart', finished_at: new Date() },
        });
        if (count > 0) this.logger.warn(`Marked ${count} orphaned demo-data batch(es) as FAILED on startup.`);
    }

    /** The tenant's latest batch, for status polling. */
    async getStatus(tenantId: string) {
        return this.db.demoDataBatch.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { batch_number: 'desc' },
        });
    }

    /**
     * Create a batch and kick off generation in the background (in-process,
     * DB-backed progress). Returns immediately with the batch id/number.
     */
    /** Tenant-owner path: the shop owner loads demo data for their own store. */
    async startBatch(tenantId: string, userId: string, userRole: string | undefined) {
        if (userRole !== 'OWNER') {
            throw new ForbiddenException('Only the shop owner can load demo data');
        }
        return this.beginBatch(tenantId, userId);
    }

    /**
     * Platform-admin path: load demo data into an arbitrary tenant. Access is
     * gated by the admin guard on the route, not the OWNER role check; rows are
     * attributed to the target tenant's own owner rather than the admin.
     */
    async startBatchForTenant(tenantId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, deleted_at: null },
            select: { owner_id: true },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }
        return this.beginBatch(tenantId, tenant.owner_id);
    }

    /** Create the batch row and kick off generation in the background. */
    private async beginBatch(tenantId: string, userId: string) {
        const running = await this.db.demoDataBatch.findFirst({
            where: { tenant_id: tenantId, status: 'RUNNING' },
        });
        if (running) {
            throw new ConflictException('A demo-data load is already running for this store.');
        }

        const priorBatches = await this.db.demoDataBatch.count({ where: { tenant_id: tenantId } });
        const batchNumber = priorBatches + 1;

        const batch = await this.db.demoDataBatch.create({
            data: { tenant_id: tenantId, batch_number: batchNumber, status: 'PENDING', phase: 'Queued' },
        });

        // Fire-and-forget: generation runs without blocking the HTTP response.
        void this.runBatch(batch.id, tenantId, userId, batchNumber);

        return { batchId: batch.id, batchNumber };
    }

    private async runBatch(batchId: string, tenantId: string, userId: string, batchNumber: number): Promise<void> {
        await this.db.demoDataBatch.update({
            where: { id: batchId },
            data: { status: 'RUNNING', phase: 'Starting', started_at: new Date() },
        });

        const onProgress = async (p: SimulationProgress) => {
            await this.db.demoDataBatch.update({
                where: { id: batchId },
                data: { phase: p.phase, processed: p.processed, total: p.total, counts: p.counts as unknown as object },
            });
        };

        try {
            const counts = await runSimulation({ db: this.db, tenantId, userId, batchNumber, onProgress });
            await this.db.demoDataBatch.update({
                where: { id: batchId },
                data: {
                    status: 'COMPLETED', phase: 'Completed', finished_at: new Date(),
                    counts: counts as unknown as object,
                },
            });
            this.logger.log(`Demo-data batch ${batchNumber} for tenant ${tenantId} completed.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Demo-data batch ${batchNumber} for tenant ${tenantId} failed: ${message}`);
            await this.db.demoDataBatch.update({
                where: { id: batchId },
                data: { status: 'FAILED', phase: 'Failed', error: message, finished_at: new Date() },
            });
        }
    }
}
