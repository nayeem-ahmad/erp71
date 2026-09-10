'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Factory, Plus, RefreshCw, Wallet } from 'lucide-react';
import { fetchAllPages, fetchWithAuth } from '@/lib/api';
import { formatDate, formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { useI18n, formatMessage } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, Alert, StatusBadge } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import {
    ADDABLE_JOB_COST_TYPES,
    EMPTY_JOB_COST_FORM,
    EMPTY_JOB_FORM,
    JOB_STATUS_LABEL_KEYS,
    JOB_STATUS_TONES,
    type BomRecipe,
    type CostSource,
    type JobsResponse,
    type PricingSuggestion,
    type ProductionJob,
    type ProductionJobCost,
    type RequirementsPreview,
} from '../manufacturing-shared';

// ------------------------------------------------------------------ //
//  Production Jobs                                                    //
// ------------------------------------------------------------------ //

export default function ManufacturingJobsPage() {
    const { t, fmt } = useI18n();
    const [jobs, setJobs] = useState<ProductionJob[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ ...EMPTY_JOB_FORM });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const [actionError, setActionError] = useState('');

    const [boms, setBoms] = useState<BomRecipe[]>([]);
    const [bomsLoading, setBomsLoading] = useState(false);
    const [requirements, setRequirements] = useState<RequirementsPreview | null>(null);
    const [requirementsLoading, setRequirementsLoading] = useState(false);

    const [completingJob, setCompletingJob] = useState<ProductionJob | null>(null);
    const [wastageQty, setWastageQty] = useState<Record<string, string>>({});
    const [completing, setCompleting] = useState(false);
    const [completeError, setCompleteError] = useState('');

    const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
    const [jobCosts, setJobCosts] = useState<Record<string, ProductionJobCost[]>>({});
    const [jobCostsLoading, setJobCostsLoading] = useState(false);
    const [jobCostsError, setJobCostsError] = useState('');
    const [costForm, setCostForm] = useState({ ...EMPTY_JOB_COST_FORM });
    const [addingCost, setAddingCost] = useState(false);
    const [addCostError, setAddCostError] = useState('');
    const [costSources, setCostSources] = useState<CostSource[]>([]);
    const [costSourcesLoaded, setCostSourcesLoaded] = useState(false);

    const [marginPct, setMarginPct] = useState<Record<string, string>>({});
    const [pricingSuggestion, setPricingSuggestion] = useState<Record<string, PricingSuggestion | null>>({});
    const [pricingLoading, setPricingLoading] = useState(false);
    const [pricingError, setPricingError] = useState('');
    const [applyingPrice, setApplyingPrice] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        setActionError('');
        try {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (statusFilter) params.set('status', statusFilter);
            const data: JobsResponse = await fetchWithAuth(`/manufacturing/jobs?${params}`);
            setJobs(data.items ?? []);
            setTotal(data.total ?? 0);
            setPages(data.pages ?? 1);
        } catch {
            setError(t.manufacturing.loadJobsFailed);
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, t.manufacturing.loadJobsFailed]);

    useEffect(() => { load(); }, [load]);

    async function openCreate() {
        setForm({ ...EMPTY_JOB_FORM });
        setSaveError('');
        setRequirements(null);
        setShowModal(true);
        setBomsLoading(true);
        try {
            setBoms(await fetchAllPages<BomRecipe>('/manufacturing/bom'));
        } catch {
            setBoms([]);
        } finally {
            setBomsLoading(false);
        }
    }

    useEffect(() => {
        if (!showModal || !form.recipeId || form.quantity < 1) {
            setRequirements(null);
            return;
        }
        let cancelled = false;
        setRequirementsLoading(true);
        const timer = setTimeout(async () => {
            try {
                const data: RequirementsPreview = await fetchWithAuth(
                    `/manufacturing/bom/${form.recipeId}/requirements?quantity=${form.quantity}`,
                );
                if (!cancelled) setRequirements(data);
            } catch {
                if (!cancelled) setRequirements(null);
            } finally {
                if (!cancelled) setRequirementsLoading(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [showModal, form.recipeId, form.quantity]);

    async function handleCreateJob() {
        if (!form.recipeId.trim()) {
            setSaveError(t.manufacturing.recipeIdRequired);
            return;
        }
        if (form.quantity < 1) {
            setSaveError(t.manufacturing.quantityMin);
            return;
        }
        setSaving(true);
        setSaveError('');
        try {
            const body = {
                recipeId: form.recipeId.trim(),
                quantity: form.quantity,
                notes: form.notes || undefined,
            };
            await fetchWithAuth('/manufacturing/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setShowModal(false);
            load();
        } catch (e: any) {
            setSaveError(e.message ?? t.manufacturing.createJobFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleJobAction(jobId: string, action: 'start' | 'complete' | 'cancel') {
        const actionLabel = t.manufacturing.jobActions[action];
        if (!confirm(formatMessage(t.manufacturing.jobActionConfirm, { action: actionLabel }))) return;
        setActionError('');
        try {
            await fetchWithAuth(`/manufacturing/jobs/${jobId}/${action}`, {
                method: 'POST',
            });
            load();
        } catch (e: any) {
            setActionError(e.message ?? formatMessage(t.manufacturing.jobActionFailed, { action }));
        }
    }

    function openCompleteModal(job: ProductionJob) {
        setCompletingJob(job);
        setWastageQty({});
        setCompleteError('');
    }

    async function handleCompleteJob() {
        if (!completingJob) return;
        setCompleting(true);
        setCompleteError('');
        try {
            const wastage = Object.entries(wastageQty)
                .map(([productId, qty]) => ({ productId, quantity: parseFloat(qty) }))
                .filter((w) => w.quantity > 0);
            await fetchWithAuth(`/manufacturing/jobs/${completingJob.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wastage }),
            });
            setCompletingJob(null);
            load();
        } catch (e: any) {
            setCompleteError(e.message ?? formatMessage(t.manufacturing.jobActionFailed, { action: t.manufacturing.jobActions.complete }));
        } finally {
            setCompleting(false);
        }
    }

    async function loadJobCosts(jobId: string) {
        setJobCostsLoading(true);
        setJobCostsError('');
        try {
            const data: ProductionJobCost[] = await fetchWithAuth(`/manufacturing/jobs/${jobId}/costs`);
            setJobCosts((prev) => ({ ...prev, [jobId]: data ?? [] }));
        } catch {
            setJobCostsError(t.manufacturing.jobCosts.loadFailed);
        } finally {
            setJobCostsLoading(false);
        }
    }

    function toggleCosts(jobId: string) {
        if (expandedJobId === jobId) {
            setExpandedJobId(null);
            return;
        }
        setExpandedJobId(jobId);
        setCostForm({ ...EMPTY_JOB_COST_FORM });
        setAddCostError('');
        setPricingError('');
        if (!marginPct[jobId]) {
            setMarginPct((prev) => ({ ...prev, [jobId]: '30' }));
        }
        if (!jobCosts[jobId]) {
            loadJobCosts(jobId);
        }
        if (!costSourcesLoaded) {
            loadCostSources();
        }
    }

    async function loadCostSources() {
        try {
            const data: CostSource[] = await fetchWithAuth('/manufacturing/cost-sources');
            setCostSources(data ?? []);
        } catch {
            setCostSources([]);
        } finally {
            setCostSourcesLoaded(true);
        }
    }

    async function handleAddCost(jobId: string) {
        const amount = parseFloat(costForm.amount);
        if (!amount || amount <= 0) {
            setAddCostError(t.manufacturing.jobCosts.amountRequired);
            return;
        }
        setAddingCost(true);
        setAddCostError('');
        try {
            await fetchWithAuth(`/manufacturing/jobs/${jobId}/costs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    costType: costForm.costType,
                    amount,
                    notes: costForm.notes || undefined,
                    sourcePurchaseItemId: costForm.sourcePurchaseItemId || undefined,
                }),
            });
            setCostForm({ ...EMPTY_JOB_COST_FORM });
            await Promise.all([loadJobCosts(jobId), loadCostSources()]);
            load();
        } catch (e: any) {
            setAddCostError(e.message ?? t.manufacturing.jobCosts.addFailed);
        } finally {
            setAddingCost(false);
        }
    }

    async function handleRemoveCost(jobId: string, costId: string) {
        if (!confirm(t.manufacturing.jobCosts.removeConfirm)) return;
        try {
            await fetchWithAuth(`/manufacturing/jobs/${jobId}/costs/${costId}`, { method: 'DELETE' });
            await loadJobCosts(jobId);
            load();
        } catch (e: any) {
            setAddCostError(e.message ?? t.manufacturing.jobCosts.removeFailed);
        }
    }

    async function handleSuggestPrice(jobId: string) {
        const margin = parseFloat(marginPct[jobId] ?? '30') || 0;
        setPricingLoading(true);
        setPricingError('');
        try {
            const data: PricingSuggestion = await fetchWithAuth(
                `/manufacturing/jobs/${jobId}/pricing-suggestion?marginPct=${margin}`,
            );
            setPricingSuggestion((prev) => ({ ...prev, [jobId]: data }));
        } catch (e: any) {
            setPricingError(e.message ?? t.manufacturing.pricing.suggestFailed);
        } finally {
            setPricingLoading(false);
        }
    }

    async function handleApplyPrice(jobId: string) {
        const margin = parseFloat(marginPct[jobId] ?? '30') || 0;
        setApplyingPrice(true);
        setPricingError('');
        try {
            const data: PricingSuggestion = await fetchWithAuth(`/manufacturing/jobs/${jobId}/apply-price`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marginPct: margin }),
            });
            setPricingSuggestion((prev) => ({ ...prev, [jobId]: data }));
        } catch (e: any) {
            setPricingError(e.message ?? t.manufacturing.pricing.applyFailed);
        } finally {
            setApplyingPrice(false);
        }
    }

    const filterTabs = [
        { label: t.manufacturing.filterAll, value: '' },
        { label: t.manufacturing.jobStatuses.draft, value: 'DRAFT' },
        { label: t.manufacturing.jobStatuses.inProgress, value: 'IN_PROGRESS' },
        { label: t.manufacturing.jobStatuses.completed, value: 'COMPLETED' },
    ];

    const jobCountLabel = fmt(t.manufacturing.jobCount, { count: total });

    function getJobStatusLabel(status: string): string {
        const key = JOB_STATUS_LABEL_KEYS[status];
        return key ? t.manufacturing.jobStatuses[key] : status.replace('_', ' ');
    }

    return (
        <PageShell>
            <PageHeader
                title={t.manufacturing.tabs.jobs}
                subtitle={t.manufacturing.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.manufacturing,
                    t.manufacturing.tabs.jobs,
                    'manufacturing',
                )}
            />
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{jobCountLabel}</span>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={load}
                        aria-label={t.common.refresh}
                        icon={<RefreshCw className="h-4 w-4" />}
                    />
                    <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                        {t.manufacturing.newJob}
                    </Button>
                </div>
            </div>

            <div className="flex gap-1 border-b border-gray-200">
                {filterTabs.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            statusFilter === tab.value
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {error && <Alert tone="danger">{error}</Alert>}
            {actionError && <Alert tone="danger">{actionError}</Alert>}

            {loading ? (
                <div className="text-center py-12 text-gray-500">{t.common.loading}</div>
            ) : jobs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Factory className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>{t.manufacturing.emptyJobs}</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.jobId}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.product}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.qty}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.status}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.started}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.completed}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.created}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.actions}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {jobs.map((job) => (
                                <React.Fragment key={job.id}>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                                        {job.id.slice(0, 8)}…
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900">
                                            {job.recipe?.product?.name ?? job.productId}
                                        </div>
                                        {job.recipe?.product?.sku && (
                                            <div className="text-xs text-gray-500">
                                                {job.recipe.product.sku}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">{job.quantity}</td>
                                    <td className="px-4 py-3">
                                        <StatusBadge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>
                                            {getJobStatusLabel(job.status)}
                                        </StatusBadge>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {job.startedAt ? formatDate(job.startedAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {job.completedAt ? formatDate(job.completedAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {formatDate(job.created_at)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-2 flex-wrap">
                                            {job.status === 'DRAFT' && (
                                                <button
                                                    onClick={() => handleJobAction(job.id, 'start')}
                                                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                                >
                                                    {t.manufacturing.jobActions.start}
                                                </button>
                                            )}
                                            {job.status === 'IN_PROGRESS' && (
                                                <button
                                                    onClick={() => openCompleteModal(job)}
                                                    className="text-emerald-700 hover:text-emerald-800 text-xs font-medium"
                                                >
                                                    {t.manufacturing.jobActions.complete}
                                                </button>
                                            )}
                                            {(job.status === 'DRAFT' || job.status === 'IN_PROGRESS') && (
                                                <button
                                                    onClick={() => handleJobAction(job.id, 'cancel')}
                                                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                                                >
                                                    {t.manufacturing.jobActions.cancel}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => toggleCosts(job.id)}
                                                className="text-gray-600 hover:text-gray-900 text-xs font-medium flex items-center gap-1"
                                            >
                                                <Wallet className="h-3 w-3" />
                                                {expandedJobId === job.id
                                                    ? t.manufacturing.jobCosts.hideCosts
                                                    : t.manufacturing.jobCosts.viewCosts}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {expandedJobId === job.id && (
                                    <tr key={`${job.id}-costs`} className="bg-gray-50">
                                        <td colSpan={8} className="px-4 py-4">
                                            <div className="max-w-2xl space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-semibold text-gray-800">
                                                        {t.manufacturing.jobCosts.title}
                                                    </h4>
                                                    <div className="flex gap-4 text-sm">
                                                        <span className="text-gray-500">
                                                            {t.manufacturing.jobCosts.totalCost}:{' '}
                                                            <span className="font-semibold text-gray-800">
                                                                {formatBDT(Number(job.totalJobCost ?? 0))}
                                                            </span>
                                                        </span>
                                                        <span className="text-gray-500">
                                                            {t.manufacturing.jobCosts.costPerUnit}:{' '}
                                                            <span className="font-semibold text-gray-800">
                                                                {formatBDT(Number(job.costPerUnit ?? 0))}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>

                                                {jobCostsError && <Alert tone="danger">{jobCostsError}</Alert>}

                                                {jobCostsLoading && !jobCosts[job.id] ? (
                                                    <div className="text-xs text-gray-500">{t.common.loading}</div>
                                                ) : (jobCosts[job.id]?.length ?? 0) === 0 ? (
                                                    <div className="text-xs text-gray-400">{t.manufacturing.jobCosts.empty}</div>
                                                ) : (
                                                    <table className="w-full text-xs">
                                                        <tbody className="divide-y divide-gray-200">
                                                            {jobCosts[job.id]!.map((cost) => (
                                                                <tr key={cost.id}>
                                                                    <td className="py-1.5 pe-3 text-gray-700">
                                                                        {t.manufacturing.jobCosts.costTypes[cost.costType]}
                                                                    </td>
                                                                    <td className="py-1.5 pe-3 text-gray-500">
                                                                        {cost.notes}
                                                                        {cost.sourcePurchaseItem && (
                                                                            <span className="text-gray-400">
                                                                                {' '}({cost.sourcePurchaseItem.purchase.purchase_number})
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-1.5 pe-3 text-end font-medium text-gray-800">
                                                                        {formatBDT(Number(cost.amount))}
                                                                    </td>
                                                                    <td className="py-1.5 text-end">
                                                                        {cost.costType !== 'RAW_MATERIAL' && (
                                                                            <button
                                                                                onClick={() => handleRemoveCost(job.id, cost.id)}
                                                                                className="text-red-500 hover:text-red-700"
                                                                            >
                                                                                {t.manufacturing.jobCosts.remove}
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}

                                                {job.status !== 'CANCELLED' && (
                                                    <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-200">
                                                        <Select
                                                            aria-label={t.manufacturing.jobCosts.noBillLink}
                                                            value={costForm.sourcePurchaseItemId}
                                                            onChange={(e) => {
                                                                const source = costSources.find((s) => s.id === e.target.value);
                                                                setCostForm((f) => ({
                                                                    ...f,
                                                                    sourcePurchaseItemId: e.target.value,
                                                                    amount: source ? String(source.remainingAmount) : f.amount,
                                                                }));
                                                            }}
                                                            className="w-full sm:w-auto sm:max-w-[220px]"
                                                        >
                                                            <option value="">{t.manufacturing.jobCosts.noBillLink}</option>
                                                            {costSources.map((source) => (
                                                                <option key={source.id} value={source.id}>
                                                                    {source.purchaseNumber} — {source.productName} ({formatBDT(source.remainingAmount)} {t.manufacturing.jobCosts.remaining})
                                                                </option>
                                                            ))}
                                                        </Select>
                                                        <Select
                                                            aria-label={t.manufacturing.jobCosts.costType}
                                                            value={costForm.costType}
                                                            onChange={(e) =>
                                                                setCostForm((f) => ({ ...f, costType: e.target.value as any }))
                                                            }
                                                            className="w-full sm:w-auto"
                                                        >
                                                            {ADDABLE_JOB_COST_TYPES.map((type) => (
                                                                <option key={type} value={type}>
                                                                    {t.manufacturing.jobCosts.costTypes[type]}
                                                                </option>
                                                            ))}
                                                        </Select>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            aria-label={t.manufacturing.jobCosts.amount}
                                                            placeholder={t.manufacturing.jobCosts.amount}
                                                            value={costForm.amount}
                                                            onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))}
                                                            className="w-28"
                                                        />
                                                        <Input
                                                            type="text"
                                                            aria-label={t.manufacturing.jobCosts.notes}
                                                            placeholder={t.manufacturing.jobCosts.notesPlaceholder}
                                                            value={costForm.notes}
                                                            onChange={(e) => setCostForm((f) => ({ ...f, notes: e.target.value }))}
                                                            className="flex-1 min-w-[140px]"
                                                        />
                                                        <Button
                                                            variant="primary"
                                                            onClick={() => handleAddCost(job.id)}
                                                            loading={addingCost}
                                                        >
                                                            {addingCost ? t.manufacturing.jobCosts.adding : t.manufacturing.jobCosts.add}
                                                        </Button>
                                                    </div>
                                                )}
                                                {addCostError && <Alert tone="danger">{addCostError}</Alert>}

                                                <div className="pt-3 border-t border-gray-200 space-y-2">
                                                    <h5 className="text-xs font-semibold text-gray-700">{t.manufacturing.pricing.title}</h5>
                                                    {job.status !== 'COMPLETED' || job.costPerUnit == null ? (
                                                        <p className="text-xs text-gray-400">{t.manufacturing.pricing.onlyForCompleted}</p>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-wrap items-end gap-2">
                                                                <div>
                                                                    <label
                                                                        htmlFor={`margin-${job.id}`}
                                                                        className="block text-xs text-gray-500 mb-0.5"
                                                                    >
                                                                        {t.manufacturing.pricing.marginLabel}
                                                                    </label>
                                                                    <Input
                                                                        id={`margin-${job.id}`}
                                                                        type="number"
                                                                        min="0"
                                                                        step="1"
                                                                        value={marginPct[job.id] ?? '30'}
                                                                        onChange={(e) =>
                                                                            setMarginPct((prev) => ({ ...prev, [job.id]: e.target.value }))
                                                                        }
                                                                        className="w-20"
                                                                    />
                                                                </div>
                                                                <Button
                                                                    variant="secondary"
                                                                    onClick={() => handleSuggestPrice(job.id)}
                                                                    loading={pricingLoading}
                                                                >
                                                                    {pricingLoading ? t.manufacturing.pricing.suggesting : t.manufacturing.pricing.suggest}
                                                                </Button>
                                                            </div>

                                                            {pricingSuggestion[job.id] && (
                                                                <div className="flex flex-wrap items-center gap-4 text-xs bg-white border border-gray-200 rounded p-2">
                                                                    <span className="text-gray-500">
                                                                        {t.manufacturing.pricing.costPerUnit}:{' '}
                                                                        <span className="font-semibold text-gray-800">
                                                                            {formatBDT(pricingSuggestion[job.id]!.costPerUnit)}
                                                                        </span>
                                                                    </span>
                                                                    <span className="text-gray-500">
                                                                        {t.manufacturing.pricing.currentPrice}:{' '}
                                                                        <span className="font-semibold text-gray-800">
                                                                            {formatBDT(pricingSuggestion[job.id]!.currentPrice)}
                                                                        </span>
                                                                    </span>
                                                                    <span className="text-gray-500">
                                                                        {t.manufacturing.pricing.suggestedPrice}:{' '}
                                                                        <span className="font-semibold text-emerald-700">
                                                                            {formatBDT(pricingSuggestion[job.id]!.suggestedPrice)}
                                                                        </span>
                                                                    </span>
                                                                    <Button
                                                                        variant="primary"
                                                                        onClick={() => handleApplyPrice(job.id)}
                                                                        loading={applyingPrice}
                                                                    >
                                                                        {applyingPrice ? t.manufacturing.pricing.applying : t.manufacturing.pricing.apply}
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                    {pricingError && <Alert tone="danger">{pricingError}</Alert>}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {pages > 1 && (
                <div className="flex justify-center gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                    >
                        {t.common.prevPage}
                    </Button>
                    <span className="px-3 py-1 text-sm text-gray-600">
                        {formatMessage(t.manufacturing.pageOf, { page, pages })}
                    </span>
                    <Button
                        variant="secondary"
                        onClick={() => setPage((p) => Math.min(pages, p + 1))}
                        disabled={page === pages}
                    >
                        {t.common.nextPage}
                    </Button>
                </div>
            )}

            {showModal && (
                <ModalShell size="md" onBackdropClick={() => setShowModal(false)}>
                    <ModalHeader title={t.manufacturing.newProductionJob} onClose={() => setShowModal(false)} />

                    <div className="p-4 space-y-4 overflow-y-auto">
                        {saveError && <Alert tone="danger">{saveError}</Alert>}

                        <Field
                            label={t.manufacturing.bomRecipeId}
                            htmlFor="job-recipe-select"
                            hint={!bomsLoading && boms.length === 0 ? t.manufacturing.noBomsAvailable : undefined}
                        >
                            <Select
                                id="job-recipe-select"
                                value={form.recipeId}
                                onChange={(e) => setForm((f) => ({ ...f, recipeId: e.target.value }))}
                                disabled={bomsLoading}
                            >
                                <option value="">{t.manufacturing.selectRecipePlaceholder}</option>
                                {boms.map((bom) => (
                                    <option key={bom.id} value={bom.id}>
                                        {bom.productName}{bom.productSku ? ` (${bom.productSku})` : ''}
                                    </option>
                                ))}
                            </Select>
                        </Field>

                        <Field label={t.manufacturing.quantityLabel} hint={t.manufacturing.quantityHint}>
                            <Input
                                type="number"
                                min={1}
                                value={form.quantity}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, quantity: Number.parseInt(e.target.value, 10) || 1 }))
                                }
                            />
                        </Field>

                        <Field label={t.manufacturing.columns.notes}>
                            <textarea
                                rows={2}
                                value={form.notes}
                                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>

                        {form.recipeId && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.manufacturing.materialsRequired}
                                </label>
                                {requirementsLoading ? (
                                    <p className="text-xs text-gray-500">{t.manufacturing.loadingRequirements}</p>
                                ) : requirements ? (
                                    <>
                                        {!requirements.sufficient && (
                                            <Alert tone="warning" className="mb-2">
                                                {t.manufacturing.insufficientStockWarning}
                                            </Alert>
                                        )}
                                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                            <table className="w-full text-xs">
                                                <thead className="bg-gray-50 text-gray-600 uppercase">
                                                    <tr>
                                                        <th className="px-3 py-2 text-start">{t.manufacturing.requirementsColumns.component}</th>
                                                        <th className="px-3 py-2 text-end">{t.manufacturing.requirementsColumns.perUnit}</th>
                                                        <th className="px-3 py-2 text-end">{t.manufacturing.requirementsColumns.required}</th>
                                                        <th className="px-3 py-2 text-end">{t.manufacturing.requirementsColumns.available}</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {requirements.components.map((item) => (
                                                        <tr key={item.productId} className={item.sufficient ? '' : 'bg-amber-50'}>
                                                            <td className="px-3 py-2 text-gray-900">
                                                                {item.productName}
                                                                {item.productSku && (
                                                                    <span className="text-gray-400"> ({item.productSku})</span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2 text-end text-gray-700">{item.perUnitQty}</td>
                                                            <td className="px-3 py-2 text-end text-gray-700">{item.requiredQty}</td>
                                                            <td className={`px-3 py-2 text-end ${item.sufficient ? 'text-gray-700' : 'text-amber-700 font-medium'}`}>
                                                                {item.availableQty}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>

                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setShowModal(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleCreateJob} loading={saving}>
                            {saving ? t.manufacturing.creating : t.manufacturing.createJob}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {completingJob && (
                <ModalShell size="sm" onBackdropClick={() => setCompletingJob(null)}>
                    <ModalHeader title={t.manufacturing.completeProductionJob} onClose={() => setCompletingJob(null)} />

                    <div className="p-4 space-y-4 overflow-y-auto">
                        {completeError && <Alert tone="danger">{completeError}</Alert>}

                        <p className="text-xs text-gray-500">{t.manufacturing.wastageHint}</p>

                        <div className="space-y-3">
                            {(completingJob.recipe?.components ?? []).map((comp) => (
                                <div key={comp.productId} className="flex items-center gap-3">
                                    <label htmlFor={`wastage-${comp.productId}`} className="flex-1 text-sm text-gray-700">
                                        {comp.product.name}
                                        {comp.product.sku && (
                                            <span className="text-gray-400"> ({comp.product.sku})</span>
                                        )}
                                    </label>
                                    <Input
                                        id={`wastage-${comp.productId}`}
                                        type="number"
                                        min={0}
                                        step={0.0001}
                                        placeholder="0"
                                        value={wastageQty[comp.productId] ?? ''}
                                        onChange={(e) =>
                                            setWastageQty((w) => ({ ...w, [comp.productId]: e.target.value }))
                                        }
                                        className="w-28"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setCompletingJob(null)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleCompleteJob} loading={completing}>
                            {completing ? t.manufacturing.completingJob : t.manufacturing.jobActions.complete}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
