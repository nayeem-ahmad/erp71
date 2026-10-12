import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RecordHistoryInterceptor } from './record-history.interceptor';
import { TRACK_HISTORY_KEY, type TrackHistorySpec } from './track-history.metadata';
import type { RecordSnapshot } from './record-history.snapshots';

function makeContext(request: any) {
    return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
    } as any;
}

function makeRequest(overrides: Record<string, any> = {}) {
    return {
        params: { id: 'sale-1' },
        headers: { 'user-agent': 'Chrome' },
        ip: '198.51.100.7',
        user: { userId: 'user-1' },
        tenantId: 'tenant-1',
        ...overrides,
    };
}

function snap(data: Record<string, unknown>, tenantId = 'tenant-1', label = 'INV-1'): RecordSnapshot {
    return { tenantId, label, data };
}

/** The "after" half is fire-and-forget; let its promise chain settle. */
async function settle() {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('RecordHistoryInterceptor', () => {
    let history: { isEnabled: jest.Mock; snapshot: jest.Mock; write: jest.Mock };
    let reflector: Reflector;
    let db: any;
    let interceptor: RecordHistoryInterceptor;
    let spec: TrackHistorySpec | undefined;

    beforeEach(() => {
        history = {
            isEnabled: jest.fn().mockResolvedValue(true),
            snapshot: jest.fn(),
            write: jest.fn().mockResolvedValue(true),
        };
        reflector = new Reflector();
        spec = { entity: 'SALE', action: 'UPDATE' };
        jest.spyOn(reflector, 'get').mockImplementation((key) => (key === TRACK_HISTORY_KEY ? spec : undefined));
        db = { supplierPaymentAllocation: { findUnique: jest.fn() } };
        interceptor = new RecordHistoryInterceptor(history as any, reflector, db);
    });

    async function run(request: any, result: unknown = { id: 'sale-1' }) {
        const handler = { handle: () => of(result) };
        const out = await lastValueFrom(await interceptor.intercept(makeContext(request), handler as any));
        await settle();
        return out;
    }

    it('records the before and after snapshots of an edit', async () => {
        const before = snap({ total: 100 });
        const after = snap({ total: 150 });
        history.snapshot.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

        await run(makeRequest());

        expect(history.snapshot).toHaveBeenNthCalledWith(1, 'SALE', 'sale-1');
        expect(history.write).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            entityType: 'SALE',
            entityId: 'sale-1',
            action: 'UPDATE',
            before,
            after,
            userId: 'user-1',
            ipAddress: '198.51.100.7',
            userAgent: 'Chrome',
        });
    });

    it('takes the "before" snapshot before the handler runs', async () => {
        const order: string[] = [];
        history.snapshot.mockImplementation(async () => {
            order.push('snapshot');
            return snap({});
        });
        const handler = {
            handle: () => {
                order.push('handler');
                return of({ id: 'sale-1' });
            },
        };
        await lastValueFrom(await interceptor.intercept(makeContext(makeRequest()), handler as any));
        await settle();

        expect(order).toEqual(['snapshot', 'handler', 'snapshot']);
    });

    it('files a create under the id the handler returned, with no "before"', async () => {
        spec = { entity: 'SALE', action: 'CREATE' };
        const after = snap({ total: 100 });
        history.snapshot.mockResolvedValue(after);

        // `:id` on a create route names the parent (the customer a payment is
        // for), never the new record.
        await run(makeRequest({ params: { id: 'customer-9' } }), { id: 'sale-new' });

        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(history.snapshot).toHaveBeenCalledWith('SALE', 'sale-new');
        expect(history.write).toHaveBeenCalledWith(
            expect.objectContaining({ entityId: 'sale-new', action: 'CREATE', before: null, after }),
        );
    });

    it('records every record a batch create made', async () => {
        spec = {
            entity: 'SALE',
            action: 'CREATE',
            resultIds: (result: any) => result.converted.map((row: any) => row.saleId),
        };
        history.snapshot.mockResolvedValue(snap({}));

        await run(makeRequest({ params: {} }), { converted: [{ saleId: 's1' }, { saleId: 's2' }] });

        expect(history.write.mock.calls.map(([entry]) => entry.entityId)).toEqual(['s1', 's2']);
    });

    it('reads the id from the named param', async () => {
        spec = { entity: 'CUSTOMER_PAYMENT', action: 'DELETE', idParam: 'paymentId' };
        history.snapshot.mockResolvedValueOnce(snap({ amount: 500 })).mockResolvedValueOnce(null);

        await run(makeRequest({ params: { paymentId: 'pay-1' } }), { success: true });

        expect(history.snapshot).toHaveBeenNthCalledWith(1, 'CUSTOMER_PAYMENT', 'pay-1');
        expect(history.write).toHaveBeenCalledWith(
            expect.objectContaining({ entityId: 'pay-1', action: 'DELETE', after: null }),
        );
    });

    it('resolves the id through `resolveId` when the param names something else', async () => {
        spec = {
            entity: 'SUPPLIER_PAYMENT',
            action: 'UNALLOCATE',
            resolveId: async (database, request) =>
                (await database.supplierPaymentAllocation.findUnique({ where: { id: request.params.allocationId } }))
                    ?.transaction_id,
        };
        db.supplierPaymentAllocation.findUnique.mockResolvedValue({ transaction_id: 'pay-7' });
        history.snapshot.mockResolvedValue(snap({}));

        await run(makeRequest({ params: { allocationId: 'alloc-1' } }));

        expect(history.snapshot).toHaveBeenNthCalledWith(1, 'SUPPLIER_PAYMENT', 'pay-7');
        expect(history.write).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'pay-7' }));
    });

    it("never files another tenant's record under the caller's tenant", async () => {
        history.snapshot.mockResolvedValue(snap({ total: 1 }, 'tenant-other'));

        await run(makeRequest());

        expect(history.write).not.toHaveBeenCalled();
    });

    it('writes nothing when the handler fails', async () => {
        history.snapshot.mockResolvedValue(snap({}));
        const handler = { handle: () => throwError(() => new Error('refused')) };

        await expect(
            lastValueFrom(await interceptor.intercept(makeContext(makeRequest()), handler as any)),
        ).rejects.toThrow('refused');
        await settle();

        expect(history.write).not.toHaveBeenCalled();
    });

    it('does nothing for a type switched off in platform settings', async () => {
        history.isEnabled.mockResolvedValue(false);

        await run(makeRequest());

        expect(history.snapshot).not.toHaveBeenCalled();
        expect(history.write).not.toHaveBeenCalled();
    });

    it('does nothing on a route without @TrackHistory', async () => {
        spec = undefined;

        await run(makeRequest());

        expect(history.isEnabled).not.toHaveBeenCalled();
    });

    it('never fails the request when a snapshot or the write throws', async () => {
        history.snapshot.mockRejectedValue(new Error('db down'));
        history.write.mockRejectedValue(new Error('db down'));

        await expect(run(makeRequest(), { id: 'sale-1' })).resolves.toEqual({ id: 'sale-1' });
    });

    it('skips requests with no tenant context', async () => {
        await run(makeRequest({ tenantId: undefined }));

        expect(history.isEnabled).not.toHaveBeenCalled();
    });
});
