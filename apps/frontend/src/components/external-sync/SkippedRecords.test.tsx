import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExternalSyncRun, ExternalSyncWarning } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { SkippedRecordsPanel, formatSkippedReport, skippedRecordsOf } from './SkippedRecords';

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const QUOTE: ExternalSyncWarning = {
    entity: 'QUOTATION',
    externalId: '1213',
    code: 'WRITE_FAILED',
    message: 'Quotation 2500028 could not be imported: another record already has the same quote_number, version',
    skipped: {
        number: '2500028',
        date: '2025-08-23',
        party: 'C00061 Some Surgical',
        amount: 436430,
        lines: 35,
        error: 'another record already has the same quote_number, version',
    },
};

const PAYMENT: ExternalSyncWarning = {
    entity: 'CUSTOMER_PAYMENT',
    externalId: '130001',
    code: 'PAYMENT_AMOUNT_INVALID',
    message: 'Payment TR01123: amount 0.000 is not a positive number — skipped',
    skipped: { number: 'TR01123', date: '2026-03-03', party: '#52116', amount: 0, lines: null },
};

const NOTE: ExternalSyncWarning = { entity: 'SALE', externalId: '9', code: 'QUANTITY_ROUNDED', message: 'rounded' };

function run(warnings: ExternalSyncWarning[]): ExternalSyncRun {
    return {
        id: 'run-1',
        trigger: 'MANUAL',
        status: 'PARTIAL',
        phase: null,
        progress: null,
        steps: null,
        window_from: '2021-10-12T00:00:00.000Z',
        window_to: '2026-10-11T00:00:00.000Z',
        dry_run: false,
        stats: null,
        warnings,
        error_message: null,
        started_at: '2026-10-11T01:10:00.000Z',
        finished_at: null,
    };
}

describe('skipped records', () => {
    it('picks out only the records that were not imported', () => {
        expect(skippedRecordsOf(run([NOTE, QUOTE, PAYMENT]))).toEqual([QUOTE, PAYMENT]);
        expect(skippedRecordsOf(run([]))).toEqual([]);
    });

    it('writes a plain-text report grouped by what was skipped', () => {
        expect(formatSkippedReport(run([PAYMENT, NOTE, QUOTE]))).toBe(
            [
                'Skipped records — import of 2026-10-11 (2021-10-12 → 2026-10-11)',
                '2 records were not imported.',
                '',
                'Quotations — 1',
                `  2500028 · 2025-08-23 · C00061 Some Surgical · ${formatBDT(436430)} · 35 lines`,
                '    Quotation 2500028 could not be imported: another record already has the same quote_number, version',
                '',
                'Customer payments — 1',
                `  TR01123 · 2026-03-03 · #52116 · ${formatBDT(0)}`,
                '    Payment TR01123: amount 0.000 is not a positive number — skipped',
                '',
            ].join('\n'),
        );
    });

    it('shows the records and copies the report', async () => {
        const writeText = jest.fn(async () => undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<SkippedRecordsPanel run={run([QUOTE, PAYMENT])} />);

        expect(screen.getByText('2 records were not imported')).toBeInTheDocument();
        expect(screen.getByText('Quotations — 1')).toBeInTheDocument();
        expect(screen.getByText(/could not be imported: another record already has the same quote_number/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(formatSkippedReport(run([QUOTE, PAYMENT]))));
        expect(toast.success).toHaveBeenCalledWith('Skipped records copied');
    });
});
