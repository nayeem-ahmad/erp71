'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, PackageOpen, TriangleAlert } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Checkbox, ConfirmDialog, Select } from '@/components/ui';

/** Module groups the load can be asked for. `core` is always on. */
export const OPTIONAL_MODULES = ['sales', 'purchasing', 'inventory', 'crm', 'hr', 'finance', 'operations'] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

const MONTH_CHOICES = [1, 2, 3, 6, 9, 12];

/** Which counts roll up into which module group, for the post-load summary. */
const COUNT_GROUPS: Record<'core' | OptionalModule, string[]> = {
    core: ['products', 'customers', 'suppliers', 'purchases', 'sales', 'creditSales', 'customerPayments',
        'supplierPayments', 'expenses', 'salesReturns', 'purchaseReturns', 'cashierSessions', 'cashTransactions'],
    sales: ['quotations', 'salesOrders', 'orderDeposits', 'deliveryOrders', 'storefrontOrders', 'warrantyClaims',
        'loyaltyTransactions'],
    purchasing: ['purchaseQuotations', 'purchaseOrders', 'productDemands'],
    inventory: ['transfers', 'shrinkages', 'stockTakes'],
    crm: ['customerGroups', 'territories', 'priceLists', 'discountCodes', 'leads', 'leadConversations', 'crmContacts',
        'customerInteractions', 'crmActivities', 'crmFollowUps', 'crmCampaigns'],
    hr: ['departments', 'designations', 'employees', 'holidays', 'workSchedules', 'attendanceRecords', 'leaveRequests',
        'payrollRuns', 'salaryAccruals', 'salaryPayments', 'expenseClaims'],
    finance: ['costCenters', 'budgets', 'fixedAssets', 'depreciationEntries', 'loans', 'loanPayments', 'investors',
        'investorTransactions', 'fundTransfers'],
    operations: ['bomRecipes', 'productionJobs', 'projects', 'projectTasks', 'notifications', 'supportThreads'],
};

export interface DemoAnomaly {
    kind: string;
    module: string;
    severity: 'low' | 'medium' | 'high';
    label: string;
    hint: string;
    occurredAt: string;
    entity: string;
    entityId: string;
    reference?: string;
    detail: string;
}

export interface DemoBatch {
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    phase?: string | null;
    processed: number;
    total: number;
    batch_number: number;
    error?: string | null;
    counts?: Record<string, number> | null;
    options?: { months?: number; modules?: string[]; includeAnomalies?: boolean } | null;
    anomalies?: DemoAnomaly[] | null;
}

/** Number of completed demo-data loads, given the tenant's latest batch. */
export function getCompletedLoads(batch: DemoBatch | null): number {
    if (!batch) return 0;
    return batch.status === 'COMPLETED' ? batch.batch_number : batch.batch_number - 1;
}

/** Rows written per module group, for the "what this load put in" summary. */
export function summariseCounts(counts: Record<string, number> | null | undefined) {
    if (!counts) return [];
    return (Object.keys(COUNT_GROUPS) as Array<'core' | OptionalModule>)
        .map((group) => ({
            group,
            total: COUNT_GROUPS[group].reduce((sum, key) => sum + (counts[key] ?? 0), 0),
        }))
        .filter((row) => row.total > 0);
}

const SEVERITY_CLASS: Record<DemoAnomaly['severity'], string> = {
    high: 'bg-red-50 text-red-700 border-red-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-gray-50 text-gray-600 border-gray-200',
};

/**
 * Load Demo Data: choose what to generate, watch it run, and see what landed.
 *
 * The options are here for the *second* load rather than the first. A store that
 * already has six months of history usually wants a different top-up — another
 * quarter of trading, or only the CRM and HR modules — and a button that could
 * only ever repeat the first load would not give them that.
 */
export default function DemoDataCard() {
    const { t } = useI18n();
    const dm = t.settingsExtras.dataManagement;
    const demo = dm.demoData;

    const [batch, setBatch] = useState<DemoBatch | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [starting, setStarting] = useState(false);
    const [showAnomalies, setShowAnomalies] = useState(false);

    const [months, setMonths] = useState(6);
    const [modules, setModules] = useState<OptionalModule[]>([...OPTIONAL_MODULES]);
    const [includeAnomalies, setIncludeAnomalies] = useState(true);

    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const running = batch?.status === 'RUNNING' || batch?.status === 'PENDING' || starting;
    const completedLoads = getCompletedLoads(batch);
    const summary = useMemo(() => summariseCounts(batch?.counts), [batch?.counts]);
    const anomalies = batch?.anomalies ?? [];

    const fetchStatus = useCallback(async (): Promise<DemoBatch | null> => {
        try {
            return (await fetchWithAuth('/tenants/demo-data/status')) as DemoBatch | null;
        } catch {
            return null;
        }
    }, []);

    const poll = useCallback(async () => {
        const next = await fetchStatus();
        setBatch(next);
        if (next && (next.status === 'RUNNING' || next.status === 'PENDING')) {
            pollTimer.current = setTimeout(poll, 2000);
        } else if (next?.status === 'COMPLETED') {
            toast.success(demo.completed);
        } else if (next?.status === 'FAILED') {
            toast.error(next.error || demo.failed);
        }
    }, [fetchStatus, demo.completed, demo.failed]);

    useEffect(() => {
        // Resume polling if a load is already in flight (e.g. after a refresh).
        fetchStatus().then((current) => {
            setBatch(current);
            if (current && (current.status === 'RUNNING' || current.status === 'PENDING')) {
                pollTimer.current = setTimeout(poll, 2000);
            }
        });
        return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
    }, [fetchStatus, poll]);

    const toggleModule = (module: OptionalModule) => {
        setModules((current) => (
            current.includes(module) ? current.filter((m) => m !== module) : [...current, module]
        ));
    };

    const start = async () => {
        setConfirming(false);
        setStarting(true);
        setShowAnomalies(false);
        try {
            await fetchWithAuth('/tenants/demo-data', {
                method: 'POST',
                body: JSON.stringify({ months, modules, includeAnomalies }),
            });
            const next = await fetchStatus();
            setBatch(next);
            pollTimer.current = setTimeout(poll, 2000);
        } catch (err: any) {
            // A 409 means a load is already running — recover by resuming polling
            // rather than surfacing a hard error.
            const next = await fetchStatus();
            if (next && (next.status === 'RUNNING' || next.status === 'PENDING')) {
                setBatch(next);
                toast.error(demo.alreadyRunning);
                pollTimer.current = setTimeout(poll, 2000);
            } else {
                toast.error(err?.message || demo.failed);
            }
        } finally {
            setStarting(false);
        }
    };

    const progressPct = batch && batch.total > 0
        ? Math.min(100, Math.round((batch.processed / batch.total) * 100))
        : 0;

    const monthLabel = (count: number) => (
        count === 1 ? demo.monthsOptionOne : demo.monthsOption.replace('{count}', String(count))
    );

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-blue-50 mt-0.5">
                    <PackageOpen className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 space-y-1">
                    <h2 className="text-base font-bold text-gray-900">{demo.title}</h2>
                    <p className="text-sm text-gray-500">{demo.description}</p>
                </div>
            </div>

            {running ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-700">{batch?.phase || demo.generating}</span>
                        {batch && batch.total > 0 && (
                            <span className="text-gray-500">
                                {demo.progress
                                    .replace('{processed}', String(batch.processed))
                                    .replace('{total}', String(batch.total))}
                            </span>
                        )}
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                    </div>
                </div>
            ) : (
                <>
                    <div className="rounded-lg border border-gray-200 p-4 space-y-4">
                        <p className="text-sm font-semibold text-gray-900">{demo.optionsTitle}</p>

                        <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor="demo-months" className="text-sm text-gray-700">{demo.monthsLabel}</label>
                            <Select
                                id="demo-months"
                                value={months}
                                onChange={(event) => setMonths(Number(event.target.value))}
                                className="w-40"
                            >
                                {MONTH_CHOICES.map((count) => (
                                    <option key={count} value={count}>{monthLabel(count)}</option>
                                ))}
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <p className="text-sm text-gray-700">{demo.modulesLabel}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                {OPTIONAL_MODULES.map((module) => (
                                    <label key={module} className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                                        <Checkbox
                                            checked={modules.includes(module)}
                                            onChange={() => toggleModule(module)}
                                        />
                                        {demo.modules[module]}
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500">{demo.modulesHint}</p>
                        </div>

                        <div className="space-y-1">
                            <label className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                                <Checkbox
                                    checked={includeAnomalies}
                                    onChange={(event) => setIncludeAnomalies(event.target.checked)}
                                />
                                {demo.anomaliesLabel}
                            </label>
                            <p className="text-xs text-gray-500">{demo.anomaliesHint}</p>
                        </div>
                    </div>

                    <Button onClick={() => setConfirming(true)} icon={<Database className="w-4 h-4" />}>
                        {completedLoads > 0 ? demo.addMoreButton : demo.button}
                    </Button>
                </>
            )}

            {/* What the last completed load actually put in. */}
            {batch?.status === 'COMPLETED' && summary.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-900">
                        {demo.summaryTitle.replace('{number}', String(batch.batch_number))}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {summary.map((row) => (
                            <div key={row.group}>
                                <p className="text-xs text-gray-500">{demo.modules[row.group]}</p>
                                <p className="text-sm font-semibold text-gray-900">
                                    {demo.summaryRows.replace('{count}', row.total.toLocaleString())}
                                </p>
                            </div>
                        ))}
                    </div>

                    {anomalies.length > 0 ? (
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => setShowAnomalies((open) => !open)}
                                className="inline-flex min-h-touch items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                            >
                                <TriangleAlert className="w-4 h-4" />
                                {demo.anomalyListTitle.replace('{count}', String(anomalies.length))}
                            </button>
                            {showAnomalies && (
                                <div className="space-y-2">
                                    <p className="text-xs text-gray-500">{demo.anomalyListHint}</p>
                                    <ul className="space-y-2">
                                        {anomalies.map((anomaly) => (
                                            <li
                                                key={`${anomaly.kind}-${anomaly.entityId}`}
                                                className={`rounded-md border p-2 text-xs ${SEVERITY_CLASS[anomaly.severity]}`}
                                            >
                                                <p className="font-semibold">
                                                    {anomaly.occurredAt.slice(0, 10)}
                                                    {anomaly.reference ? ` · ${anomaly.reference}` : ''} — {anomaly.label}
                                                </p>
                                                <p className="mt-0.5">{anomaly.detail}</p>
                                                <p className="mt-0.5 opacity-80">{anomaly.hint}</p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-500">{demo.noAnomalies}</p>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={confirming}
                title={demo.confirmTitle}
                prompt={completedLoads > 0
                    ? demo.confirmAppend.replace('{count}', String(completedLoads)).replace('{months}', String(months))
                    : demo.confirmFirst.replace('{months}', String(months))}
                confirmLabel={demo.confirmButton}
                cancelLabel={dm.dialog.cancel}
                loading={starting}
                onConfirm={start}
                onCancel={() => setConfirming(false)}
            />
        </div>
    );
}
