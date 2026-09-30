import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SnapshotImportPanel, type SnapshotImportAdapter } from './SnapshotImportPanel';
import type { CandidateRow, MatchManifest } from '@/types/match';
import type { ExternalSyncSnapshot } from '@/lib/api';

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

const READY: ExternalSyncSnapshot = {
    id: 'snap-1',
    tenant_id: 'tenant-1',
    connection_id: 'conn-1',
    status: 'READY',
    window_from: '2026-01-01T00:00:00.000Z',
    window_to: '2026-01-31T00:00:00.000Z',
    counts: { products: 2, customers: 0, suppliers: 0 },
    byte_size: 100,
    sha256: 'abc',
    error_message: null,
    phase: null,
    progress: null,
    created_at: '2026-09-30T00:00:00.000Z',
    finished_at: '2026-09-30T00:01:00.000Z',
};

const manifest: MatchManifest = {
    tenantId: 'tenant-1',
    connectionId: 'conn-1',
    provider: 'EXPRESS_RETAIL_PRO',
    snapshotId: 'snap-1',
    generatedAt: '2026-09-30T00:00:00.000Z',
    rowCount: 2,
};

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
        entity: 'PRODUCT',
        externalId: '1',
        source: 'Express Retail Pro',
        sourceName: 'Napa 500mg',
        sourceExtra: '500mg',
        suggestedMatch: 'Square Napa 500 mg',
        matchId: 'p1',
        confidence: 'medium',
        score: 0.6,
        altCandidates: ['Other Napa'],
        altIds: ['p2'],
        decision: '',
        notes: '',
        ...overrides,
    };
}

function makeAdapter(overrides: Partial<SnapshotImportAdapter> = {}): SnapshotImportAdapter {
    return {
        listSnapshots: jest.fn().mockResolvedValue([READY]),
        startExtract: jest.fn(),
        getSnapshot: jest.fn(),
        cancelExtract: jest.fn(),
        downloadFile: jest.fn(),
        uploadFile: jest.fn(),
        deleteSnapshot: jest.fn(),
        getMatchCandidates: jest.fn().mockResolvedValue({
            manifest,
            rows: [
                row(),
                row({
                    externalId: '2',
                    sourceName: 'Seclo 20mg',
                    confidence: 'high',
                    decision: 'accept',
                    matchId: 'p3',
                    altIds: [],
                    altCandidates: [],
                }),
            ],
        }),
        applyMatchDecisions: jest.fn().mockResolvedValue({ applied: 1, skipped: 1 }),
        startRun: jest.fn(),
        ...overrides,
    };
}

describe('SnapshotImportPanel', () => {
    it('enables Confirm after a medium row is decided and sends every row', async () => {
        const adapter = makeAdapter();
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={adapter}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
            />,
        );

        const select = await screen.findByLabelText(/decision for napa 500mg/i);
        const confirm = screen.getByRole('button', { name: /confirm/i });
        expect(confirm).toBeDisabled();

        fireEvent.change(select, { target: { value: 'new' } });
        expect(confirm).toBeEnabled();

        fireEvent.click(confirm);
        await waitFor(() => expect(adapter.applyMatchDecisions).toHaveBeenCalledTimes(1));
        const payload = (adapter.applyMatchDecisions as jest.Mock).mock.calls[0][0];
        expect(payload.rows).toHaveLength(2);
        expect(payload.rows.find((r: { externalId: string }) => r.externalId === '1')?.decision).toBe('new');
        expect(payload.rows.find((r: { externalId: string }) => r.externalId === '2')?.decision).toBe('accept');
    });
});
