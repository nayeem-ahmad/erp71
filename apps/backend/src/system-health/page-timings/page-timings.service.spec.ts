import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageTimingsService } from './page-timings.service';
import { PageTimingSummaryQueryDto, RecordPageTimingsDto } from './page-timings.dto';

const sample = {
    route: '/sales/:id',
    nav_type: 'navigate',
    total_ms: 412,
    boot_ms: 48,
    data_ms: 291,
    render_ms: 73,
    api_calls: 2,
    network_ms: 70,
    server_ms: 221,
    db_ms: 184,
    token_wait_ms: 0,
    slowest_endpoint: 'GET /sales/:id',
    slowest_ms: 291,
};

describe('PageTimingsService', () => {
    let db: any;
    let service: PageTimingsService;

    beforeEach(() => {
        db = {
            pageTimingSample: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            $queryRaw: jest.fn(),
        };
        service = new PageTimingsService(db);
    });

    it('stores each sample, filling what a navigation does not have with null', async () => {
        await expect(service.record([sample as any])).resolves.toEqual({ recorded: 1 });

        expect(db.pageTimingSample.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ route: '/sales/:id', total_ms: 412, document_ms: null })],
        });
    });

    it('prunes old samples at most once an hour', async () => {
        await service.record([sample as any]);
        await service.record([sample as any]);

        expect(db.pageTimingSample.deleteMany).toHaveBeenCalledTimes(1);
        const cutoff: Date = db.pageTimingSample.deleteMany.mock.calls[0][0].where.created_at.lt;
        const days = (Date.now() - cutoff.getTime()) / 86_400_000;
        expect(Math.round(days)).toBe(30);
    });

    it('does not fail the request when pruning fails', async () => {
        db.pageTimingSample.deleteMany.mockRejectedValue(new Error('db down'));
        await expect(service.record([sample as any])).resolves.toEqual({ recorded: 1 });
    });

    it('summarises percentiles overall and per route, rounding to whole ms', async () => {
        db.$queryRaw
            .mockResolvedValueOnce([{ views: 3, p50_ms: 400.4, p75_ms: 500, p95_ms: 900.6, document_ms: null, boot_ms: 40, data_ms: 300, render_ms: 60, network_ms: 70, server_ms: 200, db_ms: 150, api_calls: 2 }])
            .mockResolvedValueOnce([{ route: '/sales', views: BigInt(3), p50_ms: 400, p75_ms: 500, p95_ms: 900, document_ms: 120.5, boot_ms: 40, data_ms: 300, render_ms: 60, network_ms: 70, server_ms: 200, db_ms: 150, api_calls: 2, slowest_endpoint: 'GET /sales' }]);

        const summary = await service.summary(7, 'load', new Date('2026-11-20T00:00:00Z'));

        expect(summary.overall).toMatchObject({ views: 3, p50_ms: 400, p95_ms: 901, document_ms: null });
        expect(summary.routes).toEqual([
            expect.objectContaining({ route: '/sales', views: 3, document_ms: 121, slowest_endpoint: 'GET /sales' }),
        ]);
        expect(summary).toMatchObject({ days: 7, nav_type: 'load' });
        const sql = db.$queryRaw.mock.calls[1][0];
        expect(sql.values).toEqual([new Date('2026-11-13T00:00:00Z'), 'load', 100]);
    });

    it('reports an empty window as zero views', async () => {
        db.$queryRaw.mockResolvedValueOnce([{ views: 0, p50_ms: null }]).mockResolvedValueOnce([]);

        const summary = await service.summary();

        expect(summary.overall.views).toBe(0);
        expect(summary.overall.p50_ms).toBeNull();
        expect(summary.routes).toEqual([]);
    });
});

describe('page timing DTOs', () => {
    const errorsFor = async (body: object) =>
        (await validate(plainToInstance(RecordPageTimingsDto, body), { whitelist: true, forbidNonWhitelisted: true }))
            .map((e) => e.property);

    it('accepts a batch of samples', async () => {
        await expect(errorsFor({ samples: [sample] })).resolves.toEqual([]);
    });

    it('refuses an empty or oversized batch', async () => {
        await expect(errorsFor({ samples: [] })).resolves.toEqual(['samples']);
        await expect(errorsFor({ samples: Array(21).fill(sample) })).resolves.toEqual(['samples']);
    });

    it('refuses a sample with an unknown field, a bad route or a negative duration', async () => {
        await expect(errorsFor({ samples: [{ ...sample, user_id: 'u1' }] })).resolves.toEqual(['samples']);
        await expect(errorsFor({ samples: [{ ...sample, route: 'sales' }] })).resolves.toEqual(['samples']);
        await expect(errorsFor({ samples: [{ ...sample, total_ms: -1 }] })).resolves.toEqual(['samples']);
    });

    it('offers only the dashboard windows', async () => {
        const errors = async (query: object) =>
            (await validate(plainToInstance(PageTimingSummaryQueryDto, query))).map((e) => e.property);
        await expect(errors({ days: '7', nav_type: 'navigate' })).resolves.toEqual([]);
        await expect(errors({ days: '14' })).resolves.toEqual(['days']);
        await expect(errors({ nav_type: 'reload' })).resolves.toEqual(['nav_type']);
    });
});
