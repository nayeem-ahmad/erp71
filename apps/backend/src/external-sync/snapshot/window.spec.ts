import { BadRequestException } from '@nestjs/common';
import { resolveSyncWindow } from './window';

const connection = { window_days: 90, history_start_date: null as Date | null };

describe('resolveSyncWindow', () => {
    it('uses explicit dateFrom and dateTo', () => {
        const { from, to } = resolveSyncWindow(connection, {
            dateFrom: '2026-01-01T00:00:00.000Z',
            dateTo: '2026-01-31T00:00:00.000Z',
        });
        expect(from.toISOString().slice(0, 10)).toBe('2026-01-01');
        expect(to.toISOString().slice(0, 10)).toBe('2026-01-31');
    });

    it('rolls back window_days from dateTo when dateFrom is omitted', () => {
        const { from, to } = resolveSyncWindow(connection, { dateTo: '2026-04-10T00:00:00.000Z' });
        expect(to.toISOString().slice(0, 10)).toBe('2026-04-10');
        expect(from.toISOString().slice(0, 10)).toBe('2026-01-10');
    });

    it('clamps fullResync to history_start_date', () => {
        const { from } = resolveSyncWindow(
            { window_days: 90, history_start_date: new Date('2025-06-01T00:00:00.000Z') },
            { dateTo: '2026-01-01T00:00:00.000Z', fullResync: true },
        );
        expect(from.toISOString().slice(0, 10)).toBe('2025-06-01');
    });

    it('rejects a from after to', () => {
        expect(() =>
            resolveSyncWindow(connection, {
                dateFrom: '2026-02-01T00:00:00.000Z',
                dateTo: '2026-01-01T00:00:00.000Z',
            }),
        ).toThrow(BadRequestException);
    });
});
