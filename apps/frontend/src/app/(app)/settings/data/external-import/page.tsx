'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, PlugZap, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import CompactSection from '@/components/ui/compact/CompactSection';
import { PageShell, Button, Field, Input, Select, Checkbox, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import {
    api,
    type ExternalSyncConnection,
    type ExternalSyncRun,
    type ExternalSyncStep,
    type ExternalSyncWarning,
} from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const RUN_POLL_MS = 5000;

/** Order matches the backend's SYNC_STEPS — returns must follow sales. */
const STEPS: Array<{ key: ExternalSyncStep; label: string; hint: string }> = [
    { key: 'MASTERS', label: 'Products, customers, suppliers', hint: 'Everything else references these' },
    { key: 'PURCHASES', label: 'Purchases', hint: 'Stock must exist before it is sold' },
    { key: 'SALES', label: 'Sales', hint: 'Needs products, customers and their stock' },
    { key: 'CUSTOMER_PAYMENTS', label: 'Customer payments', hint: 'Needs customers' },
    { key: 'SUPPLIER_PAYMENTS', label: 'Supplier payments', hint: 'Needs suppliers' },
    { key: 'SALE_RETURNS', label: 'Sale returns', hint: 'Needs the parent sales already imported' },
];

type StoreOption = { id: string; name: string };

/**
 * Tenant-facing external ERP import. The platform-admin page at
 * /admin/tenants/[tenantId]/external-sync does the same job for us; this one
 * lets an owner migrate their own history.
 *
 * Deliberately missing here: the `post_impacts` switch. Replaying history into
 * stock, balances and the ledger double-counts a workspace that already has
 * opening balances, so that stays with platform admins — shown, not editable.
 */
export default function TenantExternalImportPage() {
    const [stores, setStores] = useState<StoreOption[]>([]);
    const [connection, setConnection] = useState<ExternalSyncConnection | null>(null);
    const [runs, setRuns] = useState<ExternalSyncRun[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const [form, setForm] = useState({
        baseUrl: 'https://www.expressretailerp.com',
        username: '',
        password: '',
        storeId: '',
        documentPrefix: 'XR-',
        windowDays: 90,
        historyStartDate: '',
        enabled: false,
    });
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const [runForm, setRunForm] = useState({ dateFrom: '', dateTo: '', dryRun: true, fullResync: false });
    const [selectedSteps, setSelectedSteps] = useState<ExternalSyncStep[]>(STEPS.map((step) => step.key));

    const activeRun = useMemo(() => runs.find((run) => run.status === 'RUNNING') ?? null, [runs]);

    const loadRuns = useCallback(async () => {
        try {
            setRuns(await api.listMyExternalSyncRuns());
        } catch {
            // A failed poll is not worth interrupting the page for.
        }
    }, []);

    const load = useCallback(async () => {
        setIsLoading(true);
        setLoadError('');
        try {
            const [storeList, existing] = await Promise.all([api.getStores(), api.getMyExternalSync()]);
            setStores(storeList ?? []);
            setConnection(existing);

            if (existing) {
                setForm({
                    baseUrl: existing.base_url,
                    username: existing.username,
                    password: '',
                    storeId: existing.store_id,
                    documentPrefix: existing.document_prefix,
                    windowDays: existing.window_days,
                    historyStartDate: existing.history_start_date?.slice(0, 10) ?? '',
                    enabled: existing.enabled,
                });
            } else if (storeList?.length === 1) {
                setForm((prev) => ({ ...prev, storeId: storeList[0].id }));
            }

            await loadRuns();
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load the import configuration');
        } finally {
            setIsLoading(false);
        }
    }, [loadRuns]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!activeRun) return;
        const timer = setInterval(() => void loadRuns(), RUN_POLL_MS);
        return () => clearInterval(timer);
    }, [activeRun, loadRuns]);

    function validate(): boolean {
        const errors: Record<string, string> = {};
        if (!form.baseUrl.trim()) errors.baseUrl = 'Base URL is required';
        else if (!/^https:\/\//i.test(form.baseUrl.trim())) errors.baseUrl = 'Base URL must start with https://';
        if (!form.username.trim()) errors.username = 'Username is required';
        if (!connection && !form.password) errors.password = 'Password is required when creating a connection';
        if (!form.storeId) errors.storeId = 'Pick the branch imported documents belong to';
        if (form.windowDays < 1 || form.windowDays > 3650) errors.windowDays = 'Window must be between 1 and 3650 days';
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSave() {
        if (!validate()) return;
        setIsSaving(true);
        try {
            const saved = await api.saveMyExternalSync({
                baseUrl: form.baseUrl.trim(),
                username: form.username.trim(),
                ...(form.password ? { password: form.password } : {}),
                storeId: form.storeId,
                documentPrefix: form.documentPrefix,
                enabled: form.enabled,
                windowDays: Number(form.windowDays),
                ...(form.historyStartDate ? { historyStartDate: form.historyStartDate } : {}),
            });
            setConnection(saved);
            setForm((prev) => ({ ...prev, password: '' }));
            toast.success('Connection saved');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not save the connection');
        } finally {
            setIsSaving(false);
        }
    }

    async function handleTest() {
        if (!form.baseUrl.trim() || !form.username.trim()) {
            setFieldErrors({ username: 'Base URL and username are needed to test' });
            return;
        }
        setIsTesting(true);
        try {
            const result = await api.testMyExternalSync({
                baseUrl: form.baseUrl.trim(),
                username: form.username.trim(),
                ...(form.password ? { password: form.password } : {}),
            });
            toast.success(`Connected as ${result.user.name}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Connection test failed');
        } finally {
            setIsTesting(false);
        }
    }

    async function handleRun() {
        setIsStarting(true);
        try {
            await api.startMyExternalSyncRun({
                ...(runForm.dateFrom ? { dateFrom: runForm.dateFrom } : {}),
                ...(runForm.dateTo ? { dateTo: runForm.dateTo } : {}),
                dryRun: runForm.dryRun,
                fullResync: runForm.fullResync,
                steps: selectedSteps,
            });
            toast.success(runForm.dryRun ? 'Dry run started' : 'Import started');
            await loadRuns();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not start the import');
        } finally {
            setIsStarting(false);
        }
    }

    async function handleCancel() {
        if (!activeRun) return;
        setIsCancelling(true);
        try {
            await api.cancelMyExternalSyncRun(activeRun.id);
            toast.success('Stopping after the current step');
            await loadRuns();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not cancel the run');
        } finally {
            setIsCancelling(false);
        }
    }

    async function handleDelete() {
        try {
            await api.deleteMyExternalSync();
            setConnection(null);
            setConfirmDelete(false);
            toast.success('Connection removed');
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not remove the connection');
        }
    }

    if (isLoading) {
        return (
            <PageShell>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title="Import from another ERP"
                subtitle="Bring your sales and purchase history across from Express Retail Pro"
                breadcrumbs={modulePageBreadcrumbs('Home', 'Data Management', 'External import', 'settings')}
            />

            {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

            <CompactSection title="Connection">
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Base URL" required error={fieldErrors.baseUrl}>
                        <Input
                            value={form.baseUrl}
                            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                            placeholder="https://www.expressretailerp.com"
                        />
                    </Field>
                    <Field label="Branch for imported documents" required error={fieldErrors.storeId}>
                        <Select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
                            <option value="">Select a branch</option>
                            {stores.map((store) => (
                                <option key={store.id} value={store.id}>
                                    {store.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Username" required error={fieldErrors.username}>
                        <Input
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                        />
                    </Field>
                    <Field
                        label="Password"
                        required={!connection}
                        error={fieldErrors.password}
                        hint={connection?.hasPassword ? 'Leave blank to keep the stored password' : undefined}
                    >
                        <Input
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                        />
                    </Field>
                    <Field label="Document prefix" hint="Keeps imported numbers from clashing with your own">
                        <Input
                            value={form.documentPrefix}
                            onChange={(e) => setForm({ ...form, documentPrefix: e.target.value })}
                        />
                    </Field>
                    <Field label="Rolling window (days)" error={fieldErrors.windowDays}>
                        <Input
                            type="number"
                            value={form.windowDays}
                            onChange={(e) => setForm({ ...form, windowDays: Number(e.target.value) })}
                        />
                    </Field>
                    <Field label="History starts" hint="Earliest date the import will ever ask for">
                        <Input
                            type="date"
                            value={form.historyStartDate}
                            onChange={(e) => setForm({ ...form, historyStartDate: e.target.value })}
                        />
                    </Field>
                    <div className="flex items-end">
                        <label className="flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch">
                            <Checkbox
                                checked={form.enabled}
                                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                            />
                            Run nightly (02:00) on the rolling window
                        </label>
                    </div>
                </div>

                {connection?.post_impacts ? (
                    <Alert tone="warning" className="mt-3">
                        Imported documents are being posted to stock, balances and your accounts. Contact support
                        before changing this connection — the setting is managed for you.
                    </Alert>
                ) : (
                    <p className="mt-3 text-xs text-gray-500">
                        Imported documents are recorded as history. They do not move stock, customer or supplier
                        balances, or your accounts.
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-4">
                    <Button onClick={() => void handleSave()} loading={isSaving}>
                        Save connection
                    </Button>
                    <Button
                        variant="secondary"
                        icon={<PlugZap className="w-3.5 h-3.5" />}
                        onClick={() => void handleTest()}
                        loading={isTesting}
                    >
                        Test credentials
                    </Button>
                    {connection ? (
                        <Button
                            variant="danger"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => setConfirmDelete(true)}
                        >
                            Remove
                        </Button>
                    ) : null}
                </div>
            </CompactSection>

            {connection ? (
                <CompactSection title="Run an import">
                    <div className="grid gap-3 md:grid-cols-4">
                        <Field label="From" hint="Blank uses the rolling window">
                            <Input
                                type="date"
                                value={runForm.dateFrom}
                                onChange={(e) => setRunForm({ ...runForm, dateFrom: e.target.value })}
                            />
                        </Field>
                        <Field label="To" hint="Blank means today">
                            <Input
                                type="date"
                                value={runForm.dateTo}
                                onChange={(e) => setRunForm({ ...runForm, dateTo: e.target.value })}
                            />
                        </Field>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch">
                                <Checkbox
                                    checked={runForm.dryRun}
                                    onChange={(e) => setRunForm({ ...runForm, dryRun: e.target.checked })}
                                />
                                Dry run (count only, change nothing)
                            </label>
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch">
                                <Checkbox
                                    checked={runForm.fullResync}
                                    onChange={(e) => setRunForm({ ...runForm, fullResync: e.target.checked })}
                                />
                                Full history
                            </label>
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-gray-700">Steps to run</p>
                            <div className="flex gap-3 text-xs">
                                <button
                                    type="button"
                                    className="text-blue-600 hover:underline"
                                    onClick={() => setSelectedSteps(STEPS.map((step) => step.key))}
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    className="text-blue-600 hover:underline"
                                    onClick={() => setSelectedSteps([])}
                                >
                                    None
                                </button>
                            </div>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 mt-2">
                            {STEPS.map((step) => (
                                <label
                                    key={step.key}
                                    className="flex items-start gap-2 text-xs text-gray-700 max-md:min-h-touch"
                                >
                                    <Checkbox
                                        checked={selectedSteps.includes(step.key)}
                                        onChange={(e) =>
                                            setSelectedSteps((prev) =>
                                                e.target.checked
                                                    ? [...prev, step.key]
                                                    : prev.filter((key) => key !== step.key),
                                            )
                                        }
                                    />
                                    <span>
                                        {step.label}
                                        <span className="block text-gray-500">{step.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-4">
                        <Button
                            icon={<Play className="w-3.5 h-3.5" />}
                            onClick={() => void handleRun()}
                            loading={isStarting}
                            disabled={Boolean(activeRun) || selectedSteps.length === 0}
                        >
                            {runForm.dryRun ? 'Start dry run' : 'Start import'}
                        </Button>
                        {selectedSteps.length === 0 ? (
                            <span className="text-xs text-gray-500">Pick at least one step</span>
                        ) : null}
                        {activeRun ? (
                            <Button variant="secondary" onClick={() => void handleCancel()} loading={isCancelling}>
                                Stop after current step
                            </Button>
                        ) : null}
                    </div>

                    {activeRun ? <RunProgress run={activeRun} /> : null}
                </CompactSection>
            ) : null}

            {runs.length > 0 ? (
                <CompactSection title="Recent runs">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="py-2 pr-3 font-medium">Started</th>
                                    <th className="py-2 pr-3 font-medium">Status</th>
                                    <th className="py-2 pr-3 font-medium">Window</th>
                                    <th className="py-2 pr-3 font-medium">Imported</th>
                                    <th className="py-2 font-medium">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runs.map((run) => (
                                    <RunRow key={run.id} run={run} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CompactSection>
            ) : null}

            <ConfirmDialog
                open={confirmDelete}
                title="Remove this connection?"
                prompt={
                    'Documents already imported stay where they are. The saved credentials and the id map linking them to the other system are deleted.\n\n' +
                    'Because the id map goes too, a future import would create duplicates rather than updating what is already here.'
                }
                confirmLabel="Remove"
                cancelLabel="Cancel"
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => setConfirmDelete(false)}
            />
        </PageShell>
    );
}

function RunProgress({ run }: { run: ExternalSyncRun }) {
    const done = run.progress?.done ?? 0;
    const total = run.progress?.total ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

    return (
        <div className="mt-4 rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {run.phase ?? 'Working'}
                </span>
                <span className="text-gray-500">{total > 0 ? `${done} / ${total} steps` : 'Starting'}</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                <div className="h-1.5 rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function RunRow({ run }: { run: ExternalSyncRun }) {
    const [showWarnings, setShowWarnings] = useState(false);
    const warnings: ExternalSyncWarning[] = run.warnings ?? [];

    const imported = run.stats
        ? Object.values(run.stats).reduce((sum, tally) => sum + tally.created + tally.updated, 0)
        : 0;

    return (
        <>
            <tr className="border-b border-gray-50">
                <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDate(run.started_at)}
                    {run.dry_run ? <span className="ml-1 text-gray-400">(dry run)</span> : null}
                </td>
                <td className="py-2 pr-3">
                    <StatusBadge tone={toneForStatus(run.status)}>{run.status}</StatusBadge>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-gray-500">
                    {run.window_from.slice(0, 10)} → {run.window_to.slice(0, 10)}
                </td>
                <td className="py-2 pr-3">{run.stats ? `${imported} records` : '—'}</td>
                <td className="py-2">
                    {run.error_message ? (
                        <span className="text-danger">{run.error_message}</span>
                    ) : warnings.length > 0 ? (
                        <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => setShowWarnings((open) => !open)}
                        >
                            {warnings.length} notes
                        </button>
                    ) : (
                        <span className="text-gray-400">—</span>
                    )}
                </td>
            </tr>
            {showWarnings ? (
                <tr>
                    <td colSpan={5} className="py-2">
                        <ul className="space-y-1 text-xs text-gray-600 bg-gray-50 rounded-md p-3">
                            {warnings.map((warning, index) => (
                                <li key={`${warning.externalId}-${index}`}>{warning.message}</li>
                            ))}
                        </ul>
                    </td>
                </tr>
            ) : null}
        </>
    );
}

function toneForStatus(status: ExternalSyncRun['status']) {
    if (status === 'SUCCESS') return 'success' as const;
    if (status === 'FAILED') return 'danger' as const;
    if (status === 'PARTIAL' || status === 'CANCELLED') return 'warning' as const;
    return 'neutral' as const;
}
