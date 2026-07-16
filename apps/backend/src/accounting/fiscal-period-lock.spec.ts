import { BadRequestException } from '@nestjs/common';
import { assertFiscalPeriodOpen } from './posting.utils';

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
