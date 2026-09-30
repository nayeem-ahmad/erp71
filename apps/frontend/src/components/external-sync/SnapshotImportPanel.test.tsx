import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SnapshotImportPanel, type SnapshotImportAdapter } from './SnapshotImportPanel';
import type { CandidateRow, MatchManifest } from '@/types/match';
import type { ExternalSyncSnapshot } from '@/lib/api';

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
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

    it('lets an auto-matched row be overridden', async () => {
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

        await screen.findByLabelText(/decision for napa 500mg/i);
        fireEvent.click(screen.getByRole('button', { name: /^all /i }));
        const seclo = await screen.findByLabelText(/decision for seclo 20mg/i);
        fireEvent.change(seclo, { target: { value: 'new' } });
        fireEvent.change(screen.getByLabelText(/decision for napa 500mg/i), { target: { value: 'skip' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
        await waitFor(() => expect(adapter.applyMatchDecisions).toHaveBeenCalledTimes(1));
        const payload = (adapter.applyMatchDecisions as jest.Mock).mock.calls[0][0];
        expect(payload.rows.find((r: { externalId: string }) => r.externalId === '2')?.decision).toBe('new');
    });

    it('filters the current list by source name', async () => {
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

        await screen.findByLabelText(/decision for napa 500mg/i);
        fireEvent.click(screen.getByRole('button', { name: /^all /i }));
        await screen.findByLabelText(/decision for seclo 20mg/i);
        fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'napa' } });
        expect(screen.getByLabelText(/decision for napa 500mg/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/decision for seclo 20mg/i)).not.toBeInTheDocument();
    });

    it('shows extract phase while a snapshot is EXTRACTING', async () => {
        const extracting: ExternalSyncSnapshot = {
            ...READY,
            id: 'snap-ex',
            status: 'EXTRACTING',
            phase: 'Products',
            progress: { done: 1, total: 8 },
            finished_at: null,
        };
        const adapter = makeAdapter({
            listSnapshots: jest.fn().mockResolvedValue([extracting]),
            getMatchCandidates: jest.fn(),
        });
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

        expect(await screen.findByText(/Products/)).toBeInTheDocument();
        expect(screen.getByText(/1 \/ 8/)).toBeInTheDocument();
    });

    it('renders a compact mapping table with a confidence column', async () => {
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={makeAdapter()}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
                phase="mapping"
            />,
        );

        await screen.findByLabelText(/decision for napa 500mg/i);
        expect(screen.getByRole('columnheader', { name: /source/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /confidence/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /decision/i })).toBeInTheDocument();
        expect(screen.getByText('Medium')).toBeInTheDocument();
        expect(screen.getByText('60%')).toBeInTheDocument();
    });

    it('applies a bulk create-as-new decision to selected rows', async () => {
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={makeAdapter()}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
                phase="mapping"
            />,
        );

        const napa = await screen.findByLabelText(/decision for napa 500mg/i);
        fireEvent.click(screen.getByLabelText(/select napa 500mg/i));
        fireEvent.change(screen.getByLabelText(/bulk action/i), { target: { value: 'new' } });
        fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
        expect(napa).toHaveValue('new');
    });

    it('bulk-accepts only rows that have a suggested match', async () => {
        const adapter = makeAdapter({
            getMatchCandidates: jest.fn().mockResolvedValue({
                manifest,
                rows: [
                    row(),
                    row({
                        externalId: '2',
                        sourceName: 'Unknown syrup',
                        suggestedMatch: null,
                        matchId: null,
                        altIds: [],
                        altCandidates: [],
                        confidence: 'medium',
                        decision: '',
                    }),
                ],
            }),
        });
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={adapter}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
                phase="mapping"
            />,
        );

        await screen.findByLabelText(/decision for napa 500mg/i);
        fireEvent.change(screen.getByLabelText(/bulk action/i), { target: { value: 'accept' } });
        fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
        expect(screen.getByLabelText(/decision for napa 500mg/i)).toHaveValue('accept');
        expect(screen.getByLabelText(/decision for unknown syrup/i)).toHaveValue('');
    });

    it('confirms matches and continues when the mapping step finishes', async () => {
        const onMatchesConfirmed = jest.fn();
        const adapter = makeAdapter();
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={adapter}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
                phase="mapping"
                onMatchesConfirmed={onMatchesConfirmed}
            />,
        );

        fireEvent.change(await screen.findByLabelText(/decision for napa 500mg/i), { target: { value: 'new' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }));
        await waitFor(() => expect(adapter.applyMatchDecisions).toHaveBeenCalledTimes(1));
        expect(onMatchesConfirmed).toHaveBeenCalledTimes(1);
    });

    it('hides mapping review while the extract step is showing', async () => {
        render(
            <SnapshotImportPanel
                provider="EXPRESS_RETAIL_PRO"
                providerLabel="Express Retail Pro"
                connectionId="conn-1"
                adapter={makeAdapter()}
                steps={['MASTERS']}
                windowForm={{ dateFrom: '', dateTo: '', fullResync: false }}
                phase="extract"
            />,
        );

        expect(await screen.findByRole('button', { name: /extract from express retail pro/i })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: /confidence/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /start import/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /start dry run/i })).not.toBeInTheDocument();
    });
});
