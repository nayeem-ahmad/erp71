import { BadRequestException } from '@nestjs/common';
import { ExternalSyncMatchService } from './external-sync.match.service';
import type { ApplyMatchDecisionsDto } from './external-sync.match.dto';
import { getProviderDefinition } from './provider-adapter';
import { readSnapshotFile } from './snapshot/snapshot-file';
import { SNAPSHOT_FORMAT_VERSION } from './snapshot/snapshot.types';
import type { SnapshotDocument } from './snapshot/snapshot.types';

jest.mock('./snapshot/snapshot-file', () => ({
    ...jest.requireActual('./snapshot/snapshot-file'),
    readSnapshotFile: jest.fn(),
}));

jest.mock('./provider-adapter', () => {
    const actual = jest.requireActual('./provider-adapter');
    return {
        ...actual,
        getProviderDefinition: jest.fn((provider: string) => actual.getProviderDefinition(provider)),
    };
});

const mockedReadSnapshot = readSnapshotFile as jest.MockedFunction<typeof readSnapshotFile>;
const mockedGetDef = getProviderDefinition as jest.MockedFunction<typeof getProviderDefinition>;

const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    provider: 'EXPRESS_RETAIL_PRO',
    store_id: 'store-1',
    base_url: 'https://example.test',
    username: 'user',
    password_encrypted: 'cipher',
    external_org_id: 'org-9',
};

const READY_SNAPSHOT = {
    id: 'snap-1',
    tenant_id: 'tenant-1',
    connection_id: 'conn-1',
    status: 'READY',
    counts: {
        products: 1,
        customers: 0,
        suppliers: 0,
        sales: 0,
        purchases: 0,
        customerPayments: 0,
        supplierPayments: 0,
        saleReturns: 0,
    },
};

function snapshotDoc(overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
    const products = overrides.products ?? [
        {
            id: 1,
            code: 'NAPA',
            name: 'Napa 500mg',
            purchase_rate: '8',
            sale_rate: '10',
            vat: null,
            reorder: null,
            is_service: 'false',
            status: '1',
            organization_id: 'org-9',
            updated_at: null,
        },
    ];
    return {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        manifest: {
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            tenantId: 'tenant-1',
            connectionId: 'conn-1',
            provider: 'EXPRESS_RETAIL_PRO',
            externalOrgId: 'org-9',
            windowFrom: '2026-01-01',
            windowTo: '2026-01-31',
            extractedAt: '2026-09-30T00:00:00.000Z',
            counts: {
                products: products.length,
                customers: 0,
                suppliers: 0,
                sales: 0,
                purchases: 0,
                customerPayments: 0,
                supplierPayments: 0,
                saleReturns: 0,
            },
            sha256: 'x',
        },
        products,
        customers: [],
        suppliers: [],
        sales: [],
        purchases: [],
        customerPayments: [],
        supplierPayments: [],
        saleReturns: [],
        ...overrides,
    };
}

function makeDb() {
    return {
        externalSyncConnection: {
            findUnique: jest.fn().mockResolvedValue(CONNECTION),
        },
        externalSyncSnapshot: {
            findFirst: jest.fn().mockResolvedValue(READY_SNAPSHOT),
        },
        externalSyncMapping: {
            upsert: jest.fn().mockResolvedValue({}),
        },
        product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Napa 500mg', sku: 'NAPA' }]) },
        customer: { findMany: jest.fn().mockResolvedValue([]) },
        supplier: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
}

type Db = ReturnType<typeof makeDb>;

/** A one-row workbook whose manifest agrees with it, overridable per test. */
function file(
    row: Partial<ApplyMatchDecisionsDto['rows'][number]> = {},
    manifest: Partial<ApplyMatchDecisionsDto['manifest']> = {},
    rowCount?: number,
): ApplyMatchDecisionsDto {
    const rows = [
        {
            entity: 'PRODUCT',
            externalId: '1',
            decision: 'accept',
            matchId: 'p1',
            altIds: [],
            notes: '',
            ...row,
        },
    ] as ApplyMatchDecisionsDto['rows'];

    return {
        manifest: {
            connectionId: 'conn-1',
            provider: 'EXPRESS_RETAIL_PRO',
            generatedAt: '2026-09-21T00:00:00.000Z',
            rowCount: rowCount ?? rows.length,
            snapshotId: 'snap-1',
            ...manifest,
        },
        rows,
    };
}

describe('ExternalSyncMatchService', () => {
    let db: Db;
    let service: ExternalSyncMatchService;
    let decrypt: jest.Mock;

    beforeEach(() => {
        db = makeDb();
        decrypt = jest.fn().mockReturnValue('secret');
        service = new ExternalSyncMatchService(db as any, { decrypt } as any);
        mockedReadSnapshot.mockReset();
        mockedGetDef.mockImplementation((provider: string) =>
            jest.requireActual('./provider-adapter').getProviderDefinition(provider),
        );
    });

    describe('getCandidates', () => {
        it('maps from the snapshot and never decrypts the connection password', async () => {
            const liveClient = {
                login: jest.fn().mockResolvedValue({
                    organizationId: 'org-9',
                    user: { name: 'a', username: 'a', role: 'OWNER' },
                }),
                fetchProducts: jest.fn().mockResolvedValue([
                    {
                        id: 99,
                        code: 'LIVE',
                        name: 'From the live provider',
                        purchase_rate: '1',
                        sale_rate: '2',
                        vat: null,
                        reorder: null,
                        is_service: 'false',
                        status: '1',
                        organization_id: 'org-9',
                        updated_at: null,
                    },
                ]),
                fetchCustomers: jest.fn().mockResolvedValue([]),
                fetchSuppliers: jest.fn().mockResolvedValue([]),
            };
            const actual = jest.requireActual('./provider-adapter');
            const def = actual.getProviderDefinition('EXPRESS_RETAIL_PRO');
            mockedGetDef.mockReturnValue({ ...def, createClient: jest.fn(() => liveClient) });
            mockedReadSnapshot.mockResolvedValue(snapshotDoc());

            const result = await service.getCandidates('tenant-1', 'snap-1');

            expect(decrypt).not.toHaveBeenCalled();
            expect(liveClient.login).not.toHaveBeenCalled();
            expect(result.manifest.snapshotId).toBe('snap-1');
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].externalId).toBe('1');
            expect(result.rows[0].sourceName).toBe('Napa 500mg');
        });
    });

    describe('applyDecisions', () => {

    describe('rejects a file it cannot trust', () => {
        it('rejects a manifest naming a different connection', async () => {
            await expect(service.applyDecisions('tenant-1', file({}, { connectionId: 'other' }))).rejects.toThrow(
                /different connection/i,
            );
        });

        it('rejects a row count that disagrees with the manifest', async () => {
            await expect(service.applyDecisions('tenant-1', file({}, {}, 99))).rejects.toThrow(/row count/i);
        });

        it('rejects a duplicated external_id', async () => {
            db.externalSyncSnapshot.findFirst.mockResolvedValue({
                ...READY_SNAPSHOT,
                counts: { ...READY_SNAPSHOT.counts, products: 2 },
            });
            const dto = file();
            dto.rows = [dto.rows[0], { ...dto.rows[0] }];
            dto.manifest.rowCount = 2;
            await expect(service.applyDecisions('tenant-1', dto)).rejects.toThrow(/duplicate/i);
        });

        it('rejects alt2 when no second alternate was offered', async () => {
            await expect(
                service.applyDecisions('tenant-1', file({ decision: 'alt2', altIds: ['only-one'] })),
            ).rejects.toThrow(/alt2/i);
        });

        it('rejects accept when the row carries no match id', async () => {
            await expect(service.applyDecisions('tenant-1', file({ decision: 'accept', matchId: null }))).rejects.toThrow(
                /no match/i,
            );
        });

        it('rejects a match id that no longer exists in the tenant', async () => {
            db.product.findMany.mockResolvedValue([]);
            await expect(service.applyDecisions('tenant-1', file({ matchId: 'vanished' }))).rejects.toThrow(
                /no longer exist/i,
            );
        });

        it('writes NOTHING when any row is invalid', async () => {
            await expect(service.applyDecisions('tenant-1', file({}, {}, 99))).rejects.toThrow();
            expect(db.externalSyncMapping.upsert).not.toHaveBeenCalled();
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('reports BadRequest rather than a generic error', async () => {
            await expect(service.applyDecisions('tenant-1', file({}, {}, 99))).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('rejects applyDecisions when snapshotId is missing', async () => {
            const dto = file();
            delete (dto.manifest as { snapshotId?: string }).snapshotId;
            await expect(service.applyDecisions('tenant-1', dto)).rejects.toThrow(/snapshot/i);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects applyDecisions when snapshotId does not match a READY snapshot for the connection', async () => {
            db.externalSyncSnapshot.findFirst.mockResolvedValue(null);
            await expect(service.applyDecisions('tenant-1', file({}, { snapshotId: 'snap-other' }))).rejects.toThrow(
                /snapshot/i,
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects applyDecisions when rowCount is the medium subset only', async () => {
            db.externalSyncSnapshot.findFirst.mockResolvedValue({
                ...READY_SNAPSHOT,
                counts: { ...READY_SNAPSHOT.counts, products: 2 },
            });
            await expect(
                service.applyDecisions('tenant-1', file({}, { snapshotId: 'snap-1', rowCount: 1 })),
            ).rejects.toThrow(/count/i);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects a body whose row count does not equal snapshot master counts', async () => {
            db.externalSyncSnapshot.findFirst.mockResolvedValue({
                ...READY_SNAPSHOT,
                counts: {
                    products: 10,
                    customers: 4,
                    suppliers: 2,
                    sales: 0,
                    purchases: 0,
                    customerPayments: 0,
                    supplierPayments: 0,
                    saleReturns: 0,
                },
            });
            await expect(service.applyDecisions('tenant-1', file({}, { snapshotId: 'snap-1' }))).rejects.toThrow(
                /count/i,
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });
    });

    describe('applies the decisions it trusts', () => {
        it('maps accept to the suggested match', async () => {
            const result = await service.applyDecisions('tenant-1', file({ decision: 'accept', matchId: 'p1' }));
            expect(db.externalSyncMapping.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ internal_id: 'p1', entity_type: 'PRODUCT' }),
                }),
            );
            expect(result.applied).toBe(1);
        });

        it('maps alt1 to the first alternate', async () => {
            db.product.findMany.mockResolvedValue([{ id: 'alt-a' }]);
            await service.applyDecisions('tenant-1', file({ decision: 'alt1', matchId: 'p1', altIds: ['alt-a'] }));
            expect(db.externalSyncMapping.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ create: expect.objectContaining({ internal_id: 'alt-a' }) }),
            );
        });

        it('writes no mapping for new', async () => {
            const result = await service.applyDecisions('tenant-1', file({ decision: 'new', matchId: null }));
            expect(db.externalSyncMapping.upsert).not.toHaveBeenCalled();
            expect(result.applied).toBe(0);
            expect(result.skipped).toBe(1);
        });

        it('writes no mapping for skip', async () => {
            const result = await service.applyDecisions('tenant-1', file({ decision: 'skip', matchId: null }));
            expect(db.externalSyncMapping.upsert).not.toHaveBeenCalled();
            expect(result.skipped).toBe(1);
        });

        it('rejects a blank decision, because an unreviewed row is not a choice', async () => {
            await expect(service.applyDecisions('tenant-1', file({ decision: '' }))).rejects.toThrow(/decision/i);
        });

        it('scopes the existence check to the tenant', async () => {
            await service.applyDecisions('tenant-1', file());
            expect(db.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1', deleted_at: null }),
                }),
            );
        });
    });
    });
});
