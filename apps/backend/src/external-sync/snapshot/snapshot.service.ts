import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { DatabaseService } from '../../database/database.service';
import { EncryptionService } from '../../common/encryption.service';
import { toDateString } from '../external-sync.mapper';
import { DEFAULT_PROVIDER, getProviderDefinition } from '../provider-adapter';
import {
    SNAPSHOT_FORMAT_VERSION,
    type SnapshotDocument,
} from './snapshot.types';
import {
    countsOf,
    readSnapshotBuffer,
    readSnapshotFile,
    removeIfExists,
    snapshotFilePath,
    writeSnapshotFile,
    writeSnapshotGzip,
} from './snapshot-file';
import { resolveSyncWindow } from './window';

class ExtractCancelledError extends Error {
    constructor() {
        super('Extract cancelled');
    }
}

@Injectable()
export class ExternalSyncSnapshotService {
    private readonly logger = new Logger(ExternalSyncSnapshotService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
    ) {}

    async assertNoInFlight(connectionId: string): Promise<void> {
        const extracting = await this.db.externalSyncSnapshot.findFirst({
            where: { connection_id: connectionId, status: 'EXTRACTING' },
            select: { id: true, created_at: true },
        });
        if (extracting) {
            throw new ConflictException(
                `An extract is already running (started ${extracting.created_at.toISOString()})`,
            );
        }
        const running = await this.db.externalSyncRun.findFirst({
            where: { connection_id: connectionId, status: 'RUNNING' },
            select: { id: true, started_at: true },
        });
        if (running) {
            throw new ConflictException(
                `An import is already running (started ${running.started_at.toISOString()})`,
            );
        }
    }

    async startExtract(
        tenantId: string,
        dto: { provider?: string; dateFrom?: string; dateTo?: string; fullResync?: boolean },
        userId?: string,
    ) {
        const def = getProviderDefinition(dto.provider ?? DEFAULT_PROVIDER);
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
        });
        if (!connection) {
            throw new NotFoundException(`No ${def.label} connection configured for this tenant`);
        }

        await this.assertNoInFlight(connection.id);
        const { from, to } = resolveSyncWindow(connection, dto);

        const snapshot = await this.db.externalSyncSnapshot.create({
            data: {
                tenant_id: tenantId,
                connection_id: connection.id,
                status: 'EXTRACTING',
                phase: 'Starting',
                window_from: from,
                window_to: to,
                extracted_by: userId ?? null,
            },
        });

        void this.executeExtract(snapshot.id).catch((error) => {
            this.logger.error(`Snapshot extract ${snapshot.id} crashed: ${error?.message ?? error}`, error?.stack);
        });

        return snapshot;
    }

    async executeExtract(snapshotId: string): Promise<void> {
        const snapshot = await this.db.externalSyncSnapshot.findUnique({
            where: { id: snapshotId },
            include: { connection: true },
        });
        if (!snapshot?.connection) return;

        const connection = snapshot.connection;
        const dest = snapshotFilePath(connection.tenant_id, snapshot.id);

        try {
            const def = getProviderDefinition(connection.provider);
            const client = def.createClient({
                baseUrl: connection.base_url,
                username: connection.username,
                password: this.encryption.decrypt(connection.password_encrypted),
            });
            const session = await client.login();

            if (connection.external_org_id && connection.external_org_id !== session.organizationId) {
                throw new ConflictException(
                    `Provider organization changed (expected ${connection.external_org_id}, got ${session.organizationId}). ` +
                        'Refusing to import — reset the connection if this is intentional.',
                );
            }

            const chunks = def.planWindows(snapshot.window_from, snapshot.window_to);
            const withQuotations = typeof client.fetchQuotationDocuments === 'function';
            const total = 3 + chunks.length * (withQuotations ? 6 : 5);
            let done = 0;
            const mark = async (phase: string) => {
                done += 1;
                await this.db.externalSyncSnapshot.update({
                    where: { id: snapshotId },
                    data: { phase, progress: { done, total } },
                });
            };

            const products = await client.fetchProducts();
            await mark('Products');
            await this.throwIfCancelled(snapshotId);

            const customers = await client.fetchCustomers();
            await mark('Customers');
            await this.throwIfCancelled(snapshotId);

            const suppliers = await client.fetchSuppliers();
            await mark('Suppliers');
            await this.throwIfCancelled(snapshotId);

            const sales: unknown[] = [];
            const purchases: unknown[] = [];
            const customerPayments: unknown[] = [];
            const supplierPayments: unknown[] = [];
            const saleReturns: unknown[] = [];
            const quotations: unknown[] = [];
            let quotationsError: string | undefined;

            for (const chunk of chunks) {
                sales.push(...(await client.fetchSaleDocuments(chunk)));
                await mark('Sales');
                await this.throwIfCancelled(snapshotId);
                purchases.push(...(await client.fetchPurchaseDocuments(chunk)));
                await mark('Purchases');
                await this.throwIfCancelled(snapshotId);
                customerPayments.push(...(await client.fetchPayments(chunk, 'CUSTOMER')));
                await mark('Customer payments');
                await this.throwIfCancelled(snapshotId);
                supplierPayments.push(...(await client.fetchPayments(chunk, 'SUPPLIER')));
                await mark('Supplier payments');
                await this.throwIfCancelled(snapshotId);
                saleReturns.push(...(await client.fetchSaleReturnDocuments(chunk)));
                await mark('Sale returns');
                await this.throwIfCancelled(snapshotId);
                if (withQuotations && !quotationsError) {
                    try {
                        quotations.push(...(await client.fetchQuotationDocuments!(chunk)));
                    } catch (error) {
                        // Kept, not thrown: see SnapshotDocument.quotationsError.
                        quotationsError = String((error as Error)?.message ?? error);
                        quotations.length = 0;
                    }
                    await mark('Quotations');
                    await this.throwIfCancelled(snapshotId);
                }
            }

            const unsigned: SnapshotDocument = {
                formatVersion: SNAPSHOT_FORMAT_VERSION,
                manifest: {
                    formatVersion: SNAPSHOT_FORMAT_VERSION,
                    tenantId: connection.tenant_id,
                    connectionId: connection.id,
                    provider: connection.provider,
                    externalOrgId: session.organizationId,
                    windowFrom: toDateString(snapshot.window_from),
                    windowTo: toDateString(snapshot.window_to),
                    extractedAt: new Date().toISOString(),
                    counts: countsOf({
                        products,
                        customers,
                        suppliers,
                        sales,
                        purchases,
                        customerPayments,
                        supplierPayments,
                        saleReturns,
                        quotations,
                    }),
                    sha256: '',
                },
                products,
                customers,
                suppliers,
                sales,
                purchases,
                customerPayments,
                supplierPayments,
                saleReturns,
                quotations,
                ...(quotationsError ? { quotationsError } : {}),
            };

            const written = await writeSnapshotFile(dest, unsigned);
            await this.db.externalSyncSnapshot.update({
                where: { id: snapshotId },
                data: {
                    status: 'READY',
                    phase: null,
                    counts: unsigned.manifest.counts as object,
                    byte_size: written.byteSize,
                    sha256: written.sha256,
                    finished_at: new Date(),
                    error_message: null,
                },
            });
        } catch (error) {
            await removeIfExists(dest);
            await removeIfExists(`${dest}.tmp`);
            const cancelled = error instanceof ExtractCancelledError;
            await this.db.externalSyncSnapshot.update({
                where: { id: snapshotId },
                data: {
                    status: 'FAILED',
                    phase: null,
                    finished_at: new Date(),
                    error_message: cancelled ? 'Cancelled' : (error as Error)?.message ?? String(error),
                },
            });
            if (cancelled) return;
            throw error;
        }
    }

    async cancelExtract(tenantId: string, snapshotId: string) {
        const snapshot = await this.db.externalSyncSnapshot.findFirst({
            where: { id: snapshotId, tenant_id: tenantId, status: 'EXTRACTING' },
            select: { id: true },
        });
        if (!snapshot) {
            throw new NotFoundException('No extracting snapshot to cancel');
        }
        await this.db.externalSyncSnapshot.update({
            where: { id: snapshot.id },
            data: { cancel_requested: true },
        });
        return { cancelling: true };
    }

    async getSnapshot(tenantId: string, snapshotId: string) {
        const snapshot = await this.db.externalSyncSnapshot.findFirst({
            where: { id: snapshotId, tenant_id: tenantId },
        });
        if (!snapshot) throw new NotFoundException('Snapshot not found');
        return snapshot;
    }

    async listSnapshots(tenantId: string, provider?: string) {
        const def = getProviderDefinition(provider ?? DEFAULT_PROVIDER);
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
            select: { id: true },
        });
        if (!connection) return [];
        return this.db.externalSyncSnapshot.findMany({
            where: { tenant_id: tenantId, connection_id: connection.id },
            orderBy: { created_at: 'desc' },
            take: 20,
        });
    }

    async uploadSnapshot(tenantId: string, provider: string | undefined, buffer: Buffer) {
        const def = getProviderDefinition(provider ?? DEFAULT_PROVIDER);
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
        });
        if (!connection) {
            throw new NotFoundException(`No ${def.label} connection configured for this tenant`);
        }

        let doc;
        try {
            doc = await readSnapshotBuffer(buffer);
        } catch (error) {
            throw new BadRequestException(
                `This file is not a valid snapshot: ${(error as Error).message ?? error}`,
            );
        }

        if (doc.manifest.tenantId !== tenantId) {
            throw new BadRequestException('This snapshot belongs to a different workspace.');
        }
        if (doc.manifest.connectionId !== connection.id) {
            throw new BadRequestException('This snapshot was extracted for a different connection.');
        }
        if (doc.manifest.provider !== connection.provider) {
            throw new BadRequestException('This snapshot was extracted for a different provider.');
        }
        if (connection.external_org_id && doc.manifest.externalOrgId !== connection.external_org_id) {
            throw new BadRequestException(
                `Provider organization mismatch (expected ${connection.external_org_id}, file has ${doc.manifest.externalOrgId}).`,
            );
        }

        const row = await this.db.externalSyncSnapshot.create({
            data: {
                tenant_id: tenantId,
                connection_id: connection.id,
                status: 'READY',
                window_from: new Date(`${doc.manifest.windowFrom}T00:00:00.000Z`),
                window_to: new Date(`${doc.manifest.windowTo}T00:00:00.000Z`),
                counts: doc.manifest.counts as object,
                byte_size: buffer.length,
                sha256: doc.manifest.sha256,
                finished_at: new Date(),
            },
        });
        try {
            await writeSnapshotGzip(snapshotFilePath(tenantId, row.id), buffer);
        } catch (error) {
            await this.db.externalSyncSnapshot.delete({ where: { id: row.id } }).catch(() => undefined);
            throw error;
        }
        return row;
    }

    async openFile(tenantId: string, snapshotId: string) {
        const snapshot = await this.db.externalSyncSnapshot.findFirst({
            where: { id: snapshotId, tenant_id: tenantId },
            include: { connection: true },
        });
        if (!snapshot) throw new NotFoundException('Snapshot not found');
        if (snapshot.status !== 'READY') {
            throw new BadRequestException('Snapshot is not ready to download');
        }
        const filePath = snapshotFilePath(tenantId, snapshot.id);
        try {
            await fs.stat(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new NotFoundException('Snapshot file is missing on disk');
            }
            throw error;
        }
        const from = toDateString(snapshot.window_from);
        const to = toDateString(snapshot.window_to);
        return {
            path: filePath,
            filename: `${snapshot.connection.provider}-${from}-to-${to}.json.gz`,
            byteSize: snapshot.byte_size ?? 0,
        };
    }

    async deleteSnapshot(tenantId: string, snapshotId: string) {
        const snapshot = await this.db.externalSyncSnapshot.findFirst({
            where: { id: snapshotId, tenant_id: tenantId },
        });
        if (!snapshot) throw new NotFoundException('Snapshot not found');
        if (snapshot.status === 'EXTRACTING') {
            throw new ConflictException('Cannot delete a snapshot while it is extracting');
        }
        await removeIfExists(snapshotFilePath(tenantId, snapshot.id));
        await this.db.externalSyncSnapshot.delete({ where: { id: snapshot.id } });
        return { deleted: true };
    }

    async removeFilesForConnection(tenantId: string, connectionId: string): Promise<void> {
        const rows = await this.db.externalSyncSnapshot.findMany({
            where: { tenant_id: tenantId, connection_id: connectionId },
            select: { id: true, tenant_id: true },
        });
        for (const row of rows) {
            await removeIfExists(snapshotFilePath(row.tenant_id, row.id));
        }
    }

    private async throwIfCancelled(snapshotId: string): Promise<void> {
        const row = await this.db.externalSyncSnapshot.findUnique({
            where: { id: snapshotId },
            select: { cancel_requested: true },
        });
        if (row?.cancel_requested) throw new ExtractCancelledError();
    }
}
