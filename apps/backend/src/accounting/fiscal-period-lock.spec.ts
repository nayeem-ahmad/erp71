import { BadRequestException } from '@nestjs/common';
import { assertFiscalPeriodOpen, autoPostFromRules } from './posting.utils';

describe('assertFiscalPeriodOpen', () => {
    const buildTx = (period: unknown) => ({
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
    }) as any;

    it('throws when the date falls in a locked period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: true, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .rejects.toThrow(BadRequestException);
    });

    it('allows an open period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: false, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });

    it('allows a date with no fiscal period at all', async () => {
        // Most tenants never create fiscal periods. Absence must not block posting.
        const tx = buildTx(null);
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });
});

describe('autoPostFromRules idempotent retry vs fiscal period lock', () => {
    it('short-circuits an already-posted event without throwing, even when its period is locked', async () => {
        // A retry of an already-posted event is a no-op read path: it returns the
        // existing voucher and writes nothing. The fiscal-period guard exists to
        // block new writes, so it must never fire on this path - regardless of
        // whether the period governing the event's date has since been locked.
        const existingEvent = {
            id: 'pe-1',
            status: 'posted',
            voucher: { id: 'v-1', voucher_number: 'CR-00001', voucher_type: 'CASH_RECEIVE' },
        };

        const tx = {
            fiscalPeriod: {
                // If the guard ran, it would see a locked period and throw.
                findFirst: jest.fn().mockResolvedValue({ is_locked: true, period_label: 'Jan 2026' }),
            },
            postingEvent: {
                findUnique: jest.fn().mockResolvedValue(existingEvent),
            },
        } as any;

        const result = await autoPostFromRules({
            tx,
            tenantId: 'tenant-1',
            eventType: 'sale',
            sourceModule: 'sales',
            sourceType: 'invoice',
            sourceId: 'inv-1',
            amount: 100,
            date: new Date('2026-01-15'),
        });

        expect(result).toEqual({
            postingStatus: 'posted',
            voucherId: 'v-1',
            voucherNumber: 'CR-00001',
            voucherType: 'CASH_RECEIVE',
        });
        expect(tx.fiscalPeriod.findFirst).not.toHaveBeenCalled();
    });
});
