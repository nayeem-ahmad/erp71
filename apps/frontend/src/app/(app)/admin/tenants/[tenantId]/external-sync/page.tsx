'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Play, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import CompactSection from '@/components/ui/compact/CompactSection';
import { PageShell, Button, Field, Input, Select, Checkbox, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import { api, type ExternalSyncConnection, type ExternalSyncRun, type ExternalSyncWarning } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';

type StoreOption = { id: string; name: string };

const RUN_POLL_MS = 5000;

/**
 * Platform-admin console for pulling a tenant's sales and purchase history out
 * of Express Retail Pro. Not reachable by tenant users — the whole route sits
 * behind the platform admin guard on the API side.
 */
export default function TenantExternalSyncPage() {
    const params = useParams();
    const tenantId = String(params?.tenantId ?? '');

    const [tenantName, setTenantName] = useState('');
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
    const [confirmDelete, setConfirmDelete] = useState(false);

    const [runForm, setRunForm] = useState({ dateFrom: '', dateTo: '', dryRun: true, fullResync: false });

    const activeRun = useMemo(() => runs.find((run) => run.status === 'RUNNING') ?? null, [runs]);

    const loadRuns = useCallback(async () => {
        if (!tenantId) return;
        try {
            setRuns(await api.listExternalSyncRuns(tenantId));
        } catch {
            // A failed poll is not worth interrupting the page for.
        }
    }, [tenantId]);

    const load = useCallback(async () => {
        if (!tenantId) return;
        setIsLoading(true);
        setLoadError('');
        try {
            const [tenant, existing] = await Promise.all([
                api.getAdminTenant(tenantId),
                api.getExternalSync(tenantId),
            ]);

            setTenantName(tenant?.name ?? '');
            setStores(tenant?.stores ?? []);
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
            } else if (tenant?.stores?.length === 1) {
                setForm((prev) => ({ ...prev, storeId: tenant.stores[0].id }));
            }

            await loadRuns();
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load the sync configuration');
        } finally {
            setIsLoading(false);
        }
    }, [tenantId, loadRuns]);

    useEffect(() => {
        void load();
    }, [load]);

    // While an import is in flight the run row is the only progress channel.
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
        if (!form.storeId) errors.storeId = 'Pick the store imported documents belong to';
        if (form.windowDays < 1 || form.windowDays > 3650) errors.windowDays = 'Window must be between 1 and 3650 days';
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSave() {
        if (!validate()) return;
        setIsSaving(true);
        try {
            const saved = await api.saveExternalSync(tenantId, {
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
            const result = await api.testExternalSync(tenantId, {
                baseUrl: form.baseUrl.trim(),
                username: form.username.trim(),
                ...(form.password ? { password: form.password } : {}),
            });
            toast.success(`Connected as ${result.user.name} (org ${result.organizationId})`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Connection test failed');
        } finally {
            setIsTesting(false);
        }
    }

    async function handleRun() {
        setIsStarting(true);
        try {
            await api.startExternalSyncRun(tenantId, {
                ...(runForm.dateFrom ? { dateFrom: runForm.dateFrom } : {}),
                ...(runForm.dateTo ? { dateTo: runForm.dateTo } : {}),
                dryRun: runForm.dryRun,
                fullResync: runForm.fullResync,
            });
            toast.success(runForm.dryRun ? 'Dry run started' : 'Import started');
            await loadRuns();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not start the import');
        } finally {
            setIsStarting(false);
        }
    }

    async function handleDelete() {
        setConfirmDelete(false);
        try {
            await api.deleteExternalSync(tenantId);
            setConnection(null);
            toast.success('Connection removed — imported documents were left in place');
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not remove the connection');
        }
    }

    const breadcrumbs = buildBreadcrumbs('Home', [
        { label: 'Admin', href: '/admin' },
        { label: 'Tenants', href: '/admin/tenants' },
        { label: 'Express Retail Pro import' },
    ]);

    if (isLoading) {
        return (
            <PageShell>
                <PageHeader title="Express Retail Pro import" breadcrumbs={breadcrumbs} />
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading…
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title="Express Retail Pro import"
                subtitle={tenantName ? `Pull sales and purchase history into ${tenantName}` : undefined}
                breadcrumbs={breadcrumbs}
                actions={
                    <Button variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void load()}>
                        Refresh
                    </Button>
                }
            />

            {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

            <Alert tone="warning">
                An import writes master data, sales and purchases only. It does <strong>not</strong> create stock
                movements, journal entries or payment records — opening stock and opening balances stay a separate
                exercise, otherwise imported history would double-count against them.
            </Alert>

            <CompactSection title="Connection">
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Base URL" required error={fieldErrors.baseUrl}>
                        <Input
                            value={form.baseUrl}
                            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                            placeholder="https://www.expressretailerp.com"
                        />
                    </Field>
                    <Field label="Store for imported documents" required error={fieldErrors.storeId}>
                        <Select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
                            <option value="">Select a store…</option>
                            {stores.map((store) => (
                                <option key={store.id} value={store.id}>
                                    {store.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Username" required error={fieldErrors.username}>
                        <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    </Field>
                    <Field
                        label="Password"
                        required={!connection}
                        error={fieldErrors.password}
                        hint={connection?.hasPassword ? 'Leave blank to keep the stored password' : undefined}
                    >
                        <Input
                            type="password"
                            autoComplete="new-password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                        />
                    </Field>
                    <Field label="Document prefix" hint="Keeps imported numbers from colliding with POS-generated ones">
                        <Input
                            value={form.documentPrefix}
                            onChange={(e) => setForm({ ...form, documentPrefix: e.target.value })}
                        />
                    </Field>
                    <Field
                        label="Rolling window (days)"
                        error={fieldErrors.windowDays}
                        hint="Each scheduled run re-pulls this many days back"
                    >
                        <Input
                            type="number"
                            min={1}
                            max={3650}
                            value={form.windowDays}
                            onChange={(e) => setForm({ ...form, windowDays: Number(e.target.value) })}
                        />
                    </Field>
                    <Field label="History starts" hint="Earliest business date the importer will ever request">
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

                {connection?.external_org_id ? (
                    <p className="text-xs text-gray-500 mt-3">
                        Bound to provider organization <span className="font-medium">{connection.external_org_id}</span>.
                        Imports abort if the credentials start returning a different organization.
                    </p>
                ) : null}

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
                                Dry run (count only, write nothing)
                            </label>
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch">
                                <Checkbox
                                    checked={runForm.fullResync}
                                    onChange={(e) => setRunForm({ ...runForm, fullResync: e.target.checked })}
                                />
                                Full history re-sync
                            </label>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mt-4">
                        <Button
                            icon={<Play className="w-3.5 h-3.5" />}
                            onClick={() => void handleRun()}
                            loading={isStarting}
                            disabled={Boolean(activeRun)}
                        >
                            {runForm.dryRun ? 'Start dry run' : 'Start import'}
                        </Button>
                        {activeRun ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                An import is already running
                            </span>
                        ) : null}
                    </div>
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
                                    <th className="py-2 pr-3 font-medium">Sales</th>
                                    <th className="py-2 pr-3 font-medium">Purchases</th>
                                    <th className="py-2 pr-3 font-medium">Masters</th>
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
                    'The stored credentials and the provider-to-ERP71 id map are deleted. Documents already imported stay in the tenant.\n\n' +
                    'Because the id map goes with it, a future re-import would create duplicates rather than updating what is already there.'
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

function RunRow({ run }: Readonly<{ run: ExternalSyncRun }>) {
    const [showWarnings, setShowWarnings] = useState(false);
    const warnings = run.warnings ?? [];

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
                <td className="py-2 pr-3">{formatTally(run, 'sales')}</td>
                <td className="py-2 pr-3">{formatTally(run, 'purchases')}</td>
                <td className="py-2 pr-3 text-gray-500">
                    {run.stats
                        ? `${run.stats.products.created + run.stats.products.updated}p / ${
                              run.stats.customers.created + run.stats.customers.updated
                          }c / ${run.stats.suppliers.created + run.stats.suppliers.updated}s`
                        : '—'}
                </td>
                <td className="py-2">
                    <RunNote
                        run={run}
                        warningCount={warnings.length}
                        onToggleWarnings={() => setShowWarnings((open) => !open)}
                    />
                </td>
            </tr>
            {showWarnings ? (
                <tr>
                    <td colSpan={7} className="py-2">
                        <ul className="space-y-1 text-xs text-gray-600 bg-gray-50 rounded-md p-3">
                            {warnings.map((warning: ExternalSyncWarning, index: number) => (
                                <li key={`${warning.entity}-${warning.externalId}-${index}`}>
                                    <span className="font-medium">{warning.code}</span> — {warning.message}
                                </li>
                            ))}
                        </ul>
                    </td>
                </tr>
            ) : null}
        </>
    );
}

function RunNote({
    run,
    warningCount,
    onToggleWarnings,
}: Readonly<{ run: ExternalSyncRun; warningCount: number; onToggleWarnings: () => void }>) {
    if (run.error_message) {
        return (
            <span className="inline-flex items-center gap-1 text-danger">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {run.error_message}
            </span>
        );
    }

    if (warningCount > 0) {
        return (
            <button type="button" className="text-primary hover:underline" onClick={onToggleWarnings}>
                {warningCount} warning{warningCount === 1 ? '' : 's'}
            </button>
        );
    }

    if (run.status === 'SUCCESS') {
        return (
            <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Clean
            </span>
        );
    }

    return <span className="text-gray-400">—</span>;
}

function formatTally(run: ExternalSyncRun, key: 'sales' | 'purchases') {
    const tally = run.stats?.[key];
    if (!tally) return '—';
    const parts = [`${tally.created} new`, `${tally.updated} updated`];
    if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
    return parts.join(', ');
}

function toneForStatus(status: ExternalSyncRun['status']) {
    if (status === 'SUCCESS') return 'success' as const;
    if (status === 'FAILED') return 'danger' as const;
    if (status === 'PARTIAL') return 'warning' as const;
    return 'neutral' as const;
}
