import { BadRequestException } from '@nestjs/common';
import { ExternalSyncService, SYNC_STEPS } from './external-sync.service';

/**
 * Step selection decides what a run actually does, so the ordering and
 * validation rules are worth pinning independently of the import itself.
 */
describe('external-sync step selection', () => {
    const service = new ExternalSyncService({} as any, {} as any);
    const resolve = (requested?: string[]) => (service as any).resolveSteps(requested);

    it('defaults to the whole import', () => {
        expect(resolve()).toEqual([...SYNC_STEPS]);
        expect(resolve([])).toEqual([...SYNC_STEPS]);
    });

    it('keeps canonical order however the steps were listed', () => {
        // Returns must still run after sales, or their parents will not exist.
        expect(resolve(['SALE_RETURNS', 'SALES'])).toEqual(['SALES', 'SALE_RETURNS']);
    });

    it('allows a single step, so one failed phase can be retried alone', () => {
        expect(resolve(['CUSTOMER_PAYMENTS'])).toEqual(['CUSTOMER_PAYMENTS']);
    });

    it('rejects an unknown step rather than silently importing nothing', () => {
        expect(() => resolve(['SALES', 'NONSENSE'])).toThrow(BadRequestException);
        expect(() => resolve(['NONSENSE'])).toThrow(/NONSENSE/);
    });
});
