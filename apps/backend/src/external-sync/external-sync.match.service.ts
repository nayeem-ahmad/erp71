import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { getProviderDefinition } from './provider-adapter';
import {
    buildCustomerCandidates,
    buildProductCandidates,
    buildSupplierCandidates,
} from './match/candidates';
import type { ApplyMatchDecisionsDto, MatchDecisionRowDto } from './external-sync.match.dto';
import type { CandidateRow, ExistingRecord, MatchEntity, SourceRecord } from './match/match.types';

/** Which table each entity's ids live in, for the existence check. */
const ENTITY_MODEL = {
    PRODUCT: 'product',
    CUSTOMER: 'customer',
    SUPPLIER: 'supplier',
} as const;

interface PlannedWrite {
    entity: MatchEntity;
    externalId: string;
    internalId: string;
}

/**
 * Turns a reviewed match workbook into `ExternalSyncMapping` rows.
 *
 * A mapping is what a live run consults before it decides anything itself, so
 * writing one is equivalent to signing off a merge: every document the import
 * creates for that external id is billed against the internal record named
 * here, and `isImmutablyPosted` will refuse to rewrite it afterwards.
 *
 * That is why this validates the entire file before writing any of it. A
 * half-applied workbook would leave the tenant in a state nobody chose and no
 * re-upload could describe.
 */
@Injectable()
export class ExternalSyncMatchService {
    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
    ) {}

    /**
     * Pulls the provider's masters, pairs them against what the tenant already
     * has, and returns one candidate row per source record for the reviewer's
     * workbook. Reads only — nothing here writes.
     */
    async getCandidates(tenantId: string, provider?: string) {
        const connection = await this.db.externalSyncConnection.findUnique({
            where: {
                tenant_id_provider: {
                    tenant_id: tenantId,
                    provider: provider ?? 'EXPRESS_RETAIL_PRO',
                },
            },
        });
        if (!connection) {
            throw new NotFoundException('No connection configured for this tenant and provider');
        }

        const def = getProviderDefinition(connection.provider);
        const client = def.createClient({
            baseUrl: connection.base_url,
            username: connection.username,
            password: this.encryption.decrypt(connection.password_encrypted),
        });

        const session = await client.login();
        // The same guard a run applies: a mis-typed credential must not pull
        // another company's masters into this tenant's review workbook.
        if (connection.external_org_id && connection.external_org_id !== session.organizationId) {
            throw new ConflictException(
                `Provider organization changed (expected ${connection.external_org_id}, got ${session.organizationId}). ` +
                    'Refusing to read — reset the connection if this is intentional.',
            );
        }

        const [rawProducts, rawCustomers, rawSuppliers] = await Promise.all([
            client.fetchProducts(),
            client.fetchCustomers(),
            client.fetchSuppliers(),
        ]);

        // The mappers disambiguate codes against a claimed set, exactly as a run
        // does, so the external ids here are the ones a run would write.
        const claimedSkus = new Set<string>();
        const claimedCodes = new Set<string>();
        const claimedNames = new Set<string>();

        const sourceProducts: SourceRecord[] = rawProducts.map((row) => {
            const m = def.mappers.product(row as never, claimedSkus);
            return { externalId: m.externalId, name: m.name, sku: m.sku };
        });
        const sourceCustomers: SourceRecord[] = rawCustomers.map((row) => {
            const m = def.mappers.customer(row as never, claimedCodes);
            return { externalId: m.externalId, name: m.name, phone: m.phone };
        });
        const sourceSuppliers: SourceRecord[] = rawSuppliers.map((row) => {
            const m = def.mappers.supplier(row as never, claimedNames);
            return { externalId: m.externalId, name: m.name, phone: m.phone };
        });

        const [products, customers, suppliers] = await Promise.all([
            this.db.product.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, sku: true },
            }),
            this.db.customer.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, phone: true },
            }),
            this.db.supplier.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, phone: true },
            }),
        ]);

        const label = def.label;
        const rows: CandidateRow[] = [
            ...buildProductCandidates(sourceProducts, products as ExistingRecord[], label),
            ...buildCustomerCandidates(sourceCustomers, customers as ExistingRecord[], label),
            ...buildSupplierCandidates(sourceSuppliers, suppliers as ExistingRecord[], label),
        ];

        return {
            manifest: {
                tenantId,
                connectionId: connection.id,
                provider: connection.provider,
                generatedAt: new Date().toISOString(),
                rowCount: rows.length,
            },
            rows,
        };
    }

    async applyDecisions(tenantId: string, dto: ApplyMatchDecisionsDto) {
        const connection = await this.db.externalSyncConnection.findUnique({
            where: {
                tenant_id_provider: { tenant_id: tenantId, provider: dto.manifest.provider },
            },
            select: { id: true, tenant_id: true, provider: true },
        });

        if (!connection) {
            throw new NotFoundException(`No ${dto.manifest.provider} connection configured for this tenant`);
        }

        // A workbook generated for another connection would map this tenant's
        // external ids onto records chosen for a different source entirely.
        if (connection.id !== dto.manifest.connectionId) {
            throw new BadRequestException(
                'This workbook was generated for a different connection. Download a fresh one and review it again.',
            );
        }

        if (dto.rows.length !== dto.manifest.rowCount) {
            throw new BadRequestException(
                `Row count mismatch: the manifest says ${dto.manifest.rowCount} rows but the file has ${dto.rows.length}. ` +
                    'Rows were added or removed after the workbook was generated — download a fresh one.',
            );
        }

        const writes = await this.planWrites(tenantId, dto.rows);

        // Every row checked out; only now does anything change.
        await this.db.$transaction(
            writes.map((write) =>
                this.db.externalSyncMapping.upsert({
                    where: {
                        connection_id_entity_type_external_id: {
                            connection_id: connection.id,
                            entity_type: write.entity,
                            external_id: write.externalId,
                        },
                    },
                    create: {
                        tenant_id: connection.tenant_id,
                        connection_id: connection.id,
                        entity_type: write.entity,
                        external_id: write.externalId,
                        internal_id: write.internalId,
                    },
                    update: { internal_id: write.internalId },
                }),
            ),
        );

        return { applied: writes.length, skipped: dto.rows.length - writes.length };
    }

    /**
     * Resolves every row to a write or to nothing, throwing on the first row it
     * cannot trust. Returns only once the whole file is known to be applicable.
     */
    private async planWrites(tenantId: string, rows: MatchDecisionRowDto[]): Promise<PlannedWrite[]> {
        const seen = new Set<string>();
        const resolved: PlannedWrite[] = [];

        for (const row of rows) {
            const key = `${row.entity}:${row.externalId}`;
            if (seen.has(key)) {
                throw new BadRequestException(
                    `Duplicate row for ${row.entity} ${row.externalId}. Each source record may appear only once.`,
                );
            }
            seen.add(key);

            const internalId = this.resolveInternalId(row);
            if (internalId) {
                resolved.push({
                    entity: row.entity as MatchEntity,
                    externalId: row.externalId,
                    internalId,
                });
            }
        }

        await this.assertTargetsExist(tenantId, resolved);
        return resolved;
    }

    /** The decision column, turned into the id it names — or null for no link. */
    private resolveInternalId(row: MatchDecisionRowDto): string | null {
        const alts = row.altIds ?? [];

        switch (row.decision) {
            // A brand-new record and an explicitly skipped one both mean "write
            // no mapping"; the import will create or ignore it as usual.
            case 'new':
            case 'skip':
                return null;

            case 'accept':
                if (!row.matchId) {
                    throw new BadRequestException(
                        `${row.entity} ${row.externalId} is marked "accept" but has no match to accept. ` +
                            'Use "new" if it should be created fresh.',
                    );
                }
                return row.matchId;

            case 'alt1':
            case 'alt2':
            case 'alt3': {
                const index = Number(row.decision.slice(3)) - 1;
                const id = alts[index];
                if (!id) {
                    throw new BadRequestException(
                        `${row.entity} ${row.externalId} is marked "${row.decision}" but only ${alts.length} ` +
                            `alternate${alts.length === 1 ? ' was' : 's were'} offered.`,
                    );
                }
                return id;
            }

            default:
                // Covers a blank cell: an unreviewed row is not a decision, and
                // guessing one is exactly what this whole review exists to stop.
                throw new BadRequestException(
                    `${row.entity} ${row.externalId} has no valid decision ("${row.decision}"). ` +
                        'Every row needs one of: accept, new, alt1, alt2, alt3, skip.',
                );
        }
    }

    /**
     * A workbook can sit on someone's laptop for days while the tenant changes
     * underneath it, so every id it names is re-checked against live, undeleted
     * rows before it is trusted.
     */
    private async assertTargetsExist(tenantId: string, writes: PlannedWrite[]) {
        for (const entity of Object.keys(ENTITY_MODEL) as MatchEntity[]) {
            const ids = [...new Set(writes.filter((w) => w.entity === entity).map((w) => w.internalId))];
            if (ids.length === 0) continue;

            const model = this.db[ENTITY_MODEL[entity]] as {
                findMany: (args: unknown) => Promise<{ id: string }[]>;
            };
            const found = await model.findMany({
                where: { tenant_id: tenantId, id: { in: ids }, deleted_at: null },
                select: { id: true },
            });

            const alive = new Set(found.map((r) => r.id));
            const missing = ids.filter((id) => !alive.has(id));
            if (missing.length > 0) {
                throw new BadRequestException(
                    `${missing.length} ${entity.toLowerCase()} record(s) named in this workbook no longer exist or ` +
                        `have been deleted (${missing.slice(0, 3).join(', ')}). Download a fresh workbook.`,
                );
            }
        }
    }
}
