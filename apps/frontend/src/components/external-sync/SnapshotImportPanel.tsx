'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Play, Upload } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select, StatusBadge } from '@/components/ui';
import { toast } from '@/lib/toast';
import { downloadMatchWorkbook } from '@/lib/match-workbook';
import {
    assembleDecisionRows,
    decisionKey,
    isConfirmReady,
    seedDecisions,
} from '@/lib/match-review';
import type {
    ExternalSyncRun,
    ExternalSyncSnapshot,
    ExternalSyncStep,
} from '@/lib/api';
import type { CandidateRow, MatchDecision, MatchEntity, MatchManifest } from '@/types/match';

const SNAPSHOT_POLL_MS = 5000;

const ENTITY_TABS: Array<{ entity: MatchEntity; label: string }> = [
    { entity: 'PRODUCT', label: 'Products' },
    { entity: 'CUSTOMER', label: 'Customers' },
    { entity: 'SUPPLIER', label: 'Suppliers' },
];

export type SnapshotImportAdapter = {
    listSnapshots: (provider: string) => Promise<ExternalSyncSnapshot[]>;
    startExtract: (body: {
        provider: string;
        dateFrom?: string;
        dateTo?: string;
        fullResync?: boolean;
    }) => Promise<ExternalSyncSnapshot>;
    getSnapshot: (id: string) => Promise<ExternalSyncSnapshot>;
    cancelExtract: (id: string) => Promise<{ cancelling: boolean }>;
    downloadFile: (id: string) => Promise<{ blob: Blob; filename: string }>;
    uploadFile: (file: File, provider: string) => Promise<ExternalSyncSnapshot>;
    deleteSnapshot: (id: string) => Promise<{ deleted: boolean }>;
    getMatchCandidates: (snapshotId: string) => Promise<{ manifest: MatchManifest; rows: CandidateRow[] }>;
    applyMatchDecisions: (payload: {
        manifest: MatchManifest;
        rows: ReturnType<typeof assembleDecisionRows>;
    }) => Promise<{ applied: number; skipped: number }>;
    startRun: (body: {
        snapshotId: string;
        dryRun: boolean;
        steps: ExternalSyncStep[];
    }) => Promise<ExternalSyncRun>;
    downloadWorkbook?: (manifest: MatchManifest, rows: CandidateRow[]) => void;
};

export type SnapshotWindowForm = {
    dateFrom: string;
    dateTo: string;
    fullResync: boolean;
};

type SnapshotImportPanelProps = {
    provider: string;
    providerLabel: string;
    connectionId: string | null;
    adapter: SnapshotImportAdapter;
    steps: ExternalSyncStep[];
    dryRunDefault?: boolean;
    windowForm: SnapshotWindowForm;
    importRunning?: boolean;
};

type FilterChip = 'needs' | 'all';

function toneForSnapshot(status: ExternalSyncSnapshot['status']) {
    if (status === 'READY') return 'success' as const;
    if (status === 'FAILED') return 'danger' as const;
    return 'warning' as const;
}

function pickDefaultSnapshot(list: ExternalSyncSnapshot[], previous: string | null): string | null {
    if (previous && list.some((snap) => snap.id === previous)) return previous;
    const ready = list.find((snap) => snap.status === 'READY');
    if (ready) return ready.id;
    const extracting = list.find((snap) => snap.status === 'EXTRACTING');
    return extracting?.id ?? null;
}

function windowLabel(snap: ExternalSyncSnapshot): string {
    return `${snap.window_from.slice(0, 10)} → ${snap.window_to.slice(0, 10)}`;
}

export function SnapshotImportPanel({
    provider,
    providerLabel,
    connectionId,
    adapter,
    steps,
    dryRunDefault = true,
    windowForm,
    importRunning = false,
}: SnapshotImportPanelProps) {
    const [snapshots, setSnapshots] = useState<ExternalSyncSnapshot[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [manifest, setManifest] = useState<MatchManifest | null>(null);
    const [rows, setRows] = useState<CandidateRow[]>([]);
    const [decisions, setDecisions] = useState<Record<string, MatchDecision | ''>>({});
    const [tab, setTab] = useState<MatchEntity>('PRODUCT');
    const [filter, setFilter] = useState<FilterChip>('needs');
    const [search, setSearch] = useState('');
    const [dryRun, setDryRun] = useState(dryRunDefault);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshList = useCallback(async () => {
        const list = await adapter.listSnapshots(provider);
        setSnapshots(list);
        setSelectedId((prev) => pickDefaultSnapshot(list, prev));
        return list;
    }, [adapter, provider]);

    useEffect(() => {
        let cancelled = false;
        setIsLoadingList(true);
        refreshList()
            .catch((err: unknown) => {
                if (!cancelled) toast.error(err instanceof Error ? err.message : 'Could not load snapshots');
            })
            .finally(() => {
                if (!cancelled) setIsLoadingList(false);
            });
        return () => {
            cancelled = true;
        };
    }, [refreshList]);

    const extracting = snapshots.some((snap) => snap.status === 'EXTRACTING');
    useEffect(() => {
        if (!extracting) return;
        const timer = setInterval(() => {
            void refreshList().catch(() => {
                // A failed poll is not worth interrupting the page for.
            });
        }, SNAPSHOT_POLL_MS);
        return () => clearInterval(timer);
    }, [extracting, refreshList]);

    const selected = snapshots.find((snap) => snap.id === selectedId) ?? null;
    const selectedReadyId = selected?.status === 'READY' ? selected.id : null;

    useEffect(() => {
        if (!selectedReadyId) {
            setManifest(null);
            setRows([]);
            setDecisions({});
            return;
        }
        let cancelled = false;
        setIsLoadingCandidates(true);
        adapter
            .getMatchCandidates(selectedReadyId)
            .then((data) => {
                if (cancelled) return;
                setManifest(data.manifest);
                setRows(data.rows);
                setDecisions(seedDecisions(data.rows));
            })
            .catch((err: unknown) => {
                if (!cancelled) toast.error(err instanceof Error ? err.message : 'Could not load match candidates');
            })
            .finally(() => {
                if (!cancelled) setIsLoadingCandidates(false);
            });
        return () => {
            cancelled = true;
        };
    }, [adapter, selectedReadyId]);

    const tabRows = useMemo(() => rows.filter((row) => row.entity === tab), [rows, tab]);
    const mediumRows = useMemo(
        () => tabRows.filter((row) => row.confidence === 'medium'),
        [tabRows],
    );
    const autoRows = useMemo(() => tabRows.filter((row) => row.confidence === 'high'), [tabRows]);
    const newRows = useMemo(
        () => tabRows.filter((row) => row.confidence === 'low' || row.confidence === 'none'),
        [tabRows],
    );
    const visibleRows = useMemo(() => {
        const base = filter === 'needs' ? mediumRows : tabRows;
        const query = search.trim().toLowerCase();
        if (!query) return base;
        return base.filter(
            (row) =>
                row.sourceName.toLowerCase().includes(query) ||
                (row.sourceExtra ?? '').toLowerCase().includes(query),
        );
    }, [filter, mediumRows, tabRows, search]);
    const confirmReady = isConfirmReady(rows, decisions);
    const busy = extracting || importRunning || isExtracting || isStarting || isUploading;

    async function handleExtract() {
        setIsExtracting(true);
        try {
            const snap = await adapter.startExtract({
                provider,
                ...(windowForm.dateFrom ? { dateFrom: windowForm.dateFrom } : {}),
                ...(windowForm.dateTo ? { dateTo: windowForm.dateTo } : {}),
                ...(windowForm.fullResync ? { fullResync: true } : {}),
            });
            setSelectedId(snap.id);
            toast.success('Extract started');
            await refreshList();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not start the extract');
        } finally {
            setIsExtracting(false);
        }
    }

    async function handleCancelExtract() {
        if (!selected || selected.status !== 'EXTRACTING') return;
        setIsCancelling(true);
        try {
            await adapter.cancelExtract(selected.id);
            toast.success('Stopping the extract');
            await refreshList();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not cancel the extract');
        } finally {
            setIsCancelling(false);
        }
    }

    async function handleDownload(id: string) {
        try {
            const { blob, filename } = await adapter.downloadFile(id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not download the snapshot');
        }
    }

    async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setIsUploading(true);
        try {
            const snap = await adapter.uploadFile(file, provider);
            setSelectedId(snap.id);
            toast.success('Snapshot uploaded');
            await refreshList();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not upload the snapshot');
        } finally {
            setIsUploading(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            await adapter.deleteSnapshot(id);
            if (selectedId === id) setSelectedId(null);
            toast.success('Snapshot removed');
            await refreshList();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not remove the snapshot');
        }
    }

    async function handleConfirm() {
        if (!manifest || !confirmReady) return;
        setIsConfirming(true);
        try {
            const result = await adapter.applyMatchDecisions({
                manifest,
                rows: assembleDecisionRows(rows, decisions),
            });
            toast.success(
                `${result.applied} match${result.applied === 1 ? '' : 'es'} recorded, ${result.skipped} to be created fresh`,
            );
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not apply match decisions');
        } finally {
            setIsConfirming(false);
        }
    }

    async function handleStartRun() {
        if (!selectedReadyId) return;
        setIsStarting(true);
        try {
            await adapter.startRun({ snapshotId: selectedReadyId, dryRun, steps });
            toast.success(dryRun ? 'Dry run started' : 'Import started');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not start the import');
        } finally {
            setIsStarting(false);
        }
    }

    function handleDownloadWorkbook() {
        if (!manifest || rows.length === 0) {
            toast.error('Load a snapshot before downloading the workbook');
            return;
        }
        const download = adapter.downloadWorkbook ?? downloadMatchWorkbook;
        download(manifest, rows);
    }

    function setDecision(row: CandidateRow, value: MatchDecision | '') {
        setDecisions((prev) => ({ ...prev, [decisionKey(row.entity, row.externalId)]: value }));
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    icon={<Play className="w-3.5 h-3.5" />}
                    onClick={() => void handleExtract()}
                    loading={isExtracting}
                    disabled={!connectionId || busy}
                >
                    Extract from {providerLabel}
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".gz,.json.gz,application/gzip"
                    className="hidden"
                    aria-label="Upload snapshot file"
                    onChange={(event) => void handleUpload(event)}
                    disabled={busy}
                />
                <Button
                    type="button"
                    variant="secondary"
                    icon={<Upload className="w-3.5 h-3.5" />}
                    onClick={() => fileInputRef.current?.click()}
                    loading={isUploading}
                    disabled={busy}
                >
                    Upload snapshot
                </Button>
                {selected?.status === 'EXTRACTING' ? (
                    <Button variant="secondary" onClick={() => void handleCancelExtract()} loading={isCancelling}>
                        Cancel extract
                    </Button>
                ) : null}
            </div>

            {isLoadingList ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading snapshots
                </div>
            ) : snapshots.length === 0 ? (
                <p className="text-xs text-gray-500">
                    Extract from {providerLabel} or upload a .gz snapshot to review matches and import.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-start text-gray-500 border-b border-gray-100">
                                <th className="py-2 pe-3 font-medium">Window</th>
                                <th className="py-2 pe-3 font-medium">Status</th>
                                <th className="py-2 pe-3 font-medium">Counts</th>
                                <th className="py-2 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {snapshots.map((snap) => (
                                <tr
                                    key={snap.id}
                                    className={`border-b border-gray-50 ${snap.id === selectedId ? 'bg-blue-50' : ''}`}
                                >
                                    <td className="py-2 pe-3">
                                        <button
                                            type="button"
                                            className="text-start text-blue-600 hover:underline max-md:min-h-touch"
                                            onClick={() => setSelectedId(snap.id)}
                                        >
                                            {windowLabel(snap)}
                                        </button>
                                    </td>
                                    <td className="py-2 pe-3">
                                        <StatusBadge tone={toneForSnapshot(snap.status)}>{snap.status}</StatusBadge>
                                        {snap.status === 'EXTRACTING' && (snap.phase || snap.progress) ? (
                                            <span className="ms-2 text-gray-500">
                                                {[
                                                    snap.phase,
                                                    snap.progress
                                                        ? `${snap.progress.done} / ${snap.progress.total}`
                                                        : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        ) : null}
                                        {snap.error_message ? (
                                            <span className="ms-2 text-danger">{snap.error_message}</span>
                                        ) : null}
                                    </td>
                                    <td className="py-2 pe-3 text-gray-500">
                                        {snap.counts
                                            ? `${snap.counts.products ?? 0}p / ${snap.counts.customers ?? 0}c / ${snap.counts.suppliers ?? 0}s`
                                            : '—'}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex flex-wrap gap-2">
                                            {snap.status === 'READY' ? (
                                                <button
                                                    type="button"
                                                    className="text-blue-600 hover:underline max-md:min-h-touch"
                                                    onClick={() => void handleDownload(snap.id)}
                                                >
                                                    Download
                                                </button>
                                            ) : null}
                                            {snap.status !== 'EXTRACTING' ? (
                                                <button
                                                    type="button"
                                                    className="text-danger hover:underline max-md:min-h-touch"
                                                    onClick={() => void handleDelete(snap.id)}
                                                >
                                                    Delete
                                                </button>
                                            ) : null}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {selectedReadyId ? (
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-1 border-b border-gray-100">
                        {ENTITY_TABS.map((item) => (
                            <button
                                key={item.entity}
                                type="button"
                                className={`px-3 py-1.5 text-xs font-medium max-md:min-h-touch ${
                                    tab === item.entity
                                        ? 'border-b-2 border-blue-600 text-blue-700'
                                        : 'text-gray-500 hover:text-gray-800'
                                }`}
                                onClick={() => setTab(item.entity)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                        <FilterButton
                            active={filter === 'needs'}
                            onClick={() => setFilter('needs')}
                            label={`Needs decision (${mediumRows.length})`}
                        />
                        <FilterButton
                            active={filter === 'all'}
                            onClick={() => setFilter('all')}
                            label={`All (${tabRows.length})`}
                        />
                        <Input
                            aria-label="Search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name"
                            className="w-48"
                        />
                    </div>

                    {isLoadingCandidates ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Scoring matches
                        </div>
                    ) : (
                        <>
                            {visibleRows.length === 0 && filter === 'needs' ? (
                                <p className="text-xs text-gray-500">No rows need a decision in this tab.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {visibleRows.map((row) => (
                                        <MatchRow
                                            key={decisionKey(row.entity, row.externalId)}
                                            row={row}
                                            value={decisions[decisionKey(row.entity, row.externalId)] ?? ''}
                                            onChange={(value) => setDecision(row, value)}
                                        />
                                    ))}
                                </ul>
                            )}

                            {filter === 'needs' ? (
                                <>
                                    <CollapsedGroup
                                        title={`Auto-matched (${autoRows.length})`}
                                        rows={autoRows}
                                        decisions={decisions}
                                        onChange={setDecision}
                                    />
                                    <CollapsedGroup
                                        title={`Create as new (${newRows.length})`}
                                        rows={newRows}
                                        decisions={decisions}
                                        onChange={setDecision}
                                    />
                                </>
                            ) : null}
                        </>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            onClick={() => void handleConfirm()}
                            loading={isConfirming}
                            disabled={!confirmReady || isConfirming || rows.length === 0}
                        >
                            Confirm matches
                        </Button>
                        <Button
                            variant="secondary"
                            icon={<Download className="w-3.5 h-3.5" />}
                            onClick={handleDownloadWorkbook}
                            disabled={rows.length === 0}
                        >
                            Download review workbook
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch">
                    <Checkbox checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                    Dry run (count only, change nothing)
                </label>
                <Button
                    icon={<Play className="w-3.5 h-3.5" />}
                    onClick={() => void handleStartRun()}
                    loading={isStarting}
                    disabled={!selectedReadyId || busy || steps.length === 0}
                >
                    {dryRun ? 'Start dry run' : 'Start import'}
                </Button>
                {!selectedReadyId ? (
                    <span className="text-xs text-gray-500">Select a ready snapshot first</span>
                ) : null}
                {steps.length === 0 ? <span className="text-xs text-gray-500">Pick at least one step</span> : null}
            </div>
        </div>
    );
}

function FilterButton({
    active,
    onClick,
    label,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`rounded-full px-2.5 py-1 text-xs font-medium max-md:min-h-touch ${
                active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
        >
            {label}
        </button>
    );
}

function MatchRow({
    row,
    value,
    onChange,
}: {
    row: CandidateRow;
    value: MatchDecision | '';
    onChange: (value: MatchDecision | '') => void;
}) {
    return (
        <li className="rounded-lg border border-gray-100 p-3">
            <div className="grid gap-2 md:grid-cols-3">
                <div>
                    <p className="text-sm font-medium text-gray-900">{row.sourceName}</p>
                    {row.sourceExtra ? <p className="text-xs text-gray-500">{row.sourceExtra}</p> : null}
                </div>
                <div>
                    <p className="text-xs text-gray-500">Suggested</p>
                    <p className="text-sm text-gray-800">{row.suggestedMatch ?? '—'}</p>
                </div>
                <Field label="Decision">
                    <Select
                        aria-label={`Decision for ${row.sourceName}`}
                        className="min-h-touch"
                        value={value}
                        onChange={(event) => onChange(event.target.value as MatchDecision | '')}
                    >
                        <option value="">Choose…</option>
                        {row.matchId ? (
                            <option value="accept">{row.suggestedMatch ?? 'Accept suggested'}</option>
                        ) : null}
                        {row.altIds.map((id, index) => (
                            <option key={id} value={`alt${index + 1}`}>
                                {row.altCandidates[index] ?? `Alternative ${index + 1}`}
                            </option>
                        ))}
                        <option value="new">Create as new</option>
                        <option value="skip">Skip</option>
                    </Select>
                </Field>
            </div>
        </li>
    );
}

function CollapsedGroup({
    title,
    rows,
    decisions,
    onChange,
}: {
    title: string;
    rows: CandidateRow[];
    decisions: Record<string, MatchDecision | ''>;
    onChange: (row: CandidateRow, value: MatchDecision | '') => void;
}) {
    if (rows.length === 0) return null;
    return (
        <details className="rounded-lg border border-gray-100 p-3">
            <summary className="cursor-pointer text-xs font-medium text-gray-700 max-md:min-h-touch">
                {title}
            </summary>
            <ul className="mt-2 space-y-2">
                {rows.map((row) => (
                    <MatchRow
                        key={decisionKey(row.entity, row.externalId)}
                        row={row}
                        value={decisions[decisionKey(row.entity, row.externalId)] ?? ''}
                        onChange={(value) => onChange(row, value)}
                    />
                ))}
            </ul>
        </details>
    );
}
