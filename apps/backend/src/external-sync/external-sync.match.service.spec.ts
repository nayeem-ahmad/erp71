import { BadRequestException } from '@nestjs/common';
import { ExternalSyncMatchService } from './external-sync.match.service';
import type { ApplyMatchDecisionsDto } from './external-sync.match.dto';

const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    provider: 'EXPRESS_RETAIL_PRO',
    store_id: 'store-1',
};

function makeDb() {
    return {
        externalSyncConnection: {
            findUnique: jest.fn().mockResolvedValue(CONNECTION),
        },
        externalSyncMapping: {
            upsert: jest.fn().mockResolvedValue({}),
        },
        product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
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
            ...manifest,
        },
        rows,
    };
}

describe('ExternalSyncMatchService.applyDecisions', () => {
    let db: Db;
    let service: ExternalSyncMatchService;

    beforeEach(() => {
        db = makeDb();
        // applyDecisions never decrypts anything; the encryption service is
        // only reached by getCandidates, which these tests do not exercise.
        service = new ExternalSyncMatchService(db as any, { decrypt: jest.fn() } as any);
    });

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
