'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Factory, Plus, RefreshCw, Cog, Trash2, CheckCircle2, Package, Wallet, Calculator } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatDate, formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { FinancialKpiTile } from '@/components/dashboard/KpiTile';
import { useI18n, formatMessage } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface BomComponent {
    id: string;
    productId: string;
    quantity: number;
    product: { id: string; name: string; sku: string | null };
}

interface BomRecipe {
    id: string;
    productId: string;
    productName: string;
    productSku: string | null;
    outputQty: number;
    notes: string | null;
    componentCount: number;
    created_at: string;
    updated_at: string;
}

interface BomRecipeDetail extends Omit<BomRecipe, 'componentCount'> {
    product: { id: string; name: string; sku: string | null };
    components: BomComponent[];
}

interface ProductionJobRecipe {
    id: string;
    outputQty: number;
    product: { id: string; name: string; sku: string | null };
    components: BomComponent[];
}

interface ProductionJob {
    id: string;
    tenantId: string;
    recipeId: string;
    productId: string;
    quantity: number;
    status: string;
    notes: string | null;
    startedAt: string | null;
    completedAt: string | null;
    created_at: string;
    recipe: ProductionJobRecipe;
    totalJobCost: number | string | null;
    costPerUnit: number | string | null;
}

type JobCostType = 'RAW_MATERIAL' | 'PRINTING' | 'BINDING' | 'TRANSPORT' | 'LABOR' | 'OVERHEAD' | 'OTHER';

interface ProductionJobCost {
    id: string;
    jobId: string;
    costType: JobCostType;
    amount: number | string;
    notes: string | null;
    created_at: string;
    sourcePurchaseItem?: {
        id: string;
        product: { id: string; name: string; sku: string | null };
        purchase: { id: string; purchase_number: string };
    } | null;
}

interface CostSource {
    id: string;
    productName: string;
    purchaseId: string;
    purchaseNumber: string;
    supplierName: string | null;
    purchaseDate: string;
    lineTotal: number;
    allocatedAmount: number;
    remainingAmount: number;
}

interface PricingSuggestion {
    productId: string;
    productName: string;
    costPerUnit: number;
    marginPct: number;
    suggestedPrice: number;
    currentPrice: number;
}

interface JobsResponse {
    items: ProductionJob[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

interface RequirementItem {
    productId: string;
    productName: string;
    productSku: string | null;
    perUnitQty: number;
    requiredQty: number;
    availableQty: number;
    sufficient: boolean;
}

interface RequirementsPreview {
    recipeId: string;
    quantity: number;
    outputQty: number;
    sufficient: boolean;
    components: RequirementItem[];
}

interface AnalyticsJobRow {
    jobId: string;
    productId: string;
    productName: string;
    productSku: string | null;
    quantityProduced: number;
    plannedMaterialCost: number;
    wastageCost: number;
    actualMaterialCost: number;
    unitProductionCost: number;
    completedAt: string | null;
}

interface AnalyticsTrendPoint {
    date: string;
    quantityProduced: number;
}

interface AnalyticsSummary {
    totalCompletedJobs: number;
    totalUnitsProduced: number;
    totalMaterialCost: number;
    avgUnitProductionCost: number;
    jobs: AnalyticsJobRow[];
    volumeTrend: AnalyticsTrendPoint[];
}

interface ProductPLRow {
    productId: string;
    productName: string;
    productSku: string | null;
    jobsCompleted: number;
    quantityProduced: number;
    totalProductionCost: number;
    avgCostPerUnit: number;
    unitsSold: number;
    revenue: number;
    grossProfit: number;
    grossMarginPct: number;
}

interface ProductPLReport {
    products: ProductPLRow[];
    totals: { quantityProduced: number; totalProductionCost: number; revenue: number; grossProfit: number };
}

// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

const JOB_STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
};

const EMPTY_BOM_FORM = {
    productId: '',
    outputQty: 1,
    notes: '',
    components: [] as Array<{ productId: string; quantity: number }>,
};

const EMPTY_JOB_FORM = {
    recipeId: '',
    quantity: 1,
    notes: '',
};

const JOB_STATUS_LABEL_KEYS: Record<string, 'draft' | 'inProgress' | 'completed' | 'cancelled'> = {
    DRAFT: 'draft',
    IN_PROGRESS: 'inProgress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
};

const ADDABLE_JOB_COST_TYPES: Exclude<JobCostType, 'RAW_MATERIAL'>[] = [
    'PRINTING',
    'BINDING',
    'TRANSPORT',
    'LABOR',
    'OVERHEAD',
    'OTHER',
];

const EMPTY_JOB_COST_FORM = {
    costType: 'PRINTING' as Exclude<JobCostType, 'RAW_MATERIAL'>,
    amount: '',
    notes: '',
    sourcePurchaseItemId: '',
};

// ------------------------------------------------------------------ //
//  Main Page                                                          //
// ------------------------------------------------------------------ //

export default function ManufacturingPage() {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<'bom' | 'jobs' | 'analytics' | 'productPL'>('bom');

    const tabs: Array<{ key: 'bom' | 'jobs' | 'analytics' | 'productPL'; label: string }> = [
        { key: 'bom', label: t.manufacturing.tabs.boms },
        { key: 'jobs', label: t.manufacturing.tabs.jobs },
        { key: 'analytics', label: t.manufacturing.tabs.analytics },
        { key: 'productPL', label: t.manufacturing.tabs.productPL },
    ];

    return (
        <PageShell>
            <PageHeader
                title={t.manufacturing.title}
                subtitle={t.manufacturing.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.manufacturing,
                    t.manufacturing.title,
                    'manufacturing',
                )}
            />

            <div className="flex gap-1 border-b border-gray-200">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === tab.key
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'bom' ? (
                <BomTab />
            ) : activeTab === 'jobs' ? (
                <JobsTab />
            ) : activeTab === 'analytics' ? (
                <AnalyticsTab />
            ) : (
                <ProductPLTab />
            )}
        </PageShell>
    );
}

// ------------------------------------------------------------------ //
//  Bill of Materials Tab                                              //
// ------------------------------------------------------------------ //

function BomTab() {
    const { t } = useI18n();
    const [boms, setBoms] = useState<BomRecipe[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ ...EMPTY_BOM_FORM });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await fetchWithAuth('/manufacturing/bom?limit=200');
            setBoms(data?.items ?? []);
        } catch {
            setError(t.manufacturing.loadBomsFailed);
        } finally {
            setLoading(false);
        }
    }, [t.manufacturing.loadBomsFailed]);

    useEffect(() => { load(); }, [load]);

    function openCreate() {
        setEditingId(null);
        setForm({ ...EMPTY_BOM_FORM, components: [] });
        setSaveError('');
        setShowModal(true);
    }

    async function openEdit(bom: BomRecipe) {
        setSaveError('');
        try {
            const detail: BomRecipeDetail = await fetchWithAuth(`/manufacturing/bom/${bom.id}`);
            setEditingId(bom.id);
            setForm({
                productId: detail.productId,
                outputQty: detail.outputQty,
                notes: detail.notes ?? '',
                components: detail.components.map((c) => ({
                    productId: c.productId,
                    quantity: Number(c.quantity),
                })),
            });
            setShowModal(true);
        } catch {
            alert(t.manufacturing.loadBomDetailFailed);
        }
    }

    async function handleSave() {
        if (!form.productId.trim()) {
            setSaveError(t.manufacturing.productIdRequired);
            return;
        }
        if (form.outputQty < 1) {
            setSaveError(t.manufacturing.outputQtyMin);
            return;
        }
        setSaving(true);
        setSaveError('');
        try {
            const body = {
                productId: form.productId.trim(),
                outputQty: form.outputQty,
                notes: form.notes || undefined,
                components: form.components.filter((c) => c.productId.trim()),
            };
            const url = editingId
                ? `/manufacturing/bom/${editingId}`
                : '/manufacturing/bom';
            const method = editingId ? 'PATCH' : 'POST';
            await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setShowModal(false);
            load();
        } catch (e: any) {
            setSaveError(e.message ?? t.manufacturing.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm(t.manufacturing.deleteBomConfirm)) return;
        try {
            await fetchWithAuth(`/manufacturing/bom/${id}`, { method: 'DELETE' });
            load();
        } catch {
            alert(t.manufacturing.deleteBomFailed);
        }
    }

    function addComponent() {
        setForm((f) => ({
            ...f,
            components: [...f.components, { productId: '', quantity: 1 }],
        }));
    }

    function removeComponent(index: number) {
        setForm((f) => ({
            ...f,
            components: f.components.filter((_, i) => i !== index),
        }));
    }

    function updateComponent(index: number, field: 'productId' | 'quantity', value: string | number) {
        setForm((f) => ({
            ...f,
            components: f.components.map((c, i) =>
                i === index ? { ...c, [field]: value } : c,
            ),
        }));
    }

    const recipeCountLabel = formatMessage(
        boms.length === 1 ? t.manufacturing.recipeCount : t.manufacturing.recipeCountPlural,
        { count: boms.length },
    );

    return (
        <>
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{recipeCountLabel}</span>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                    <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                        {t.manufacturing.newBom}
                    </Button>
                </div>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            {loading ? (
                <div className="text-center py-12 text-gray-500">{t.common.loading}</div>
            ) : boms.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Cog className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>{t.manufacturing.emptyBoms}</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.product}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.outputQty}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.components}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.notes}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.created}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.actions}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {boms.map((bom) => (
                                <tr key={bom.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900">{bom.productName}</div>
                                        {bom.productSku && (
                                            <div className="text-xs text-gray-500">{bom.productSku}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">{bom.outputQty}</td>
                                    <td className="px-4 py-3 text-gray-700">{bom.componentCount}</td>
                                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                                        {bom.notes ?? '—'}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">{formatDate(bom.created_at)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => openEdit(bom)}
                                                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                            >
                                                {t.manufacturing.edit}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(bom.id)}
                                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                                            >
                                                {t.manufacturing.delete}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showModal && (
                <ModalShell size="md" onBackdropClick={() => setShowModal(false)}>
                    <ModalHeader
                        title={editingId ? t.manufacturing.editBomRecipe : t.manufacturing.newBomRecipe}
                        onClose={() => setShowModal(false)}
                    />

                    <div className="p-4 space-y-4 overflow-y-auto">
                        {saveError && <Alert tone="danger">{saveError}</Alert>}

                        <Field label={t.manufacturing.outputProductId}>
                            <Input
                                type="text"
                                value={form.productId}
                                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                                placeholder={t.manufacturing.placeholders.productId}
                                disabled={!!editingId}
                            />
                        </Field>

                        <Field label={t.manufacturing.outputQuantity} hint={t.manufacturing.outputQtyHint}>
                            <Input
                                type="number"
                                min={1}
                                value={form.outputQty}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, outputQty: Number.parseInt(e.target.value, 10) || 1 }))
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

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    {t.manufacturing.componentsLabel}
                                </label>
                                <button
                                    type="button"
                                    onClick={addComponent}
                                    className="text-xs text-primary hover:text-primary-hover font-medium flex items-center gap-1"
                                >
                                    <Plus className="h-3 w-3" />
                                    {t.manufacturing.addComponent}
                                </button>
                            </div>

                            {form.components.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">
                                    {t.manufacturing.noComponents}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {form.components.map((comp, i) => (
                                        <div key={i} className="flex gap-2 items-center">
                                            <Input
                                                type="text"
                                                value={comp.productId}
                                                onChange={(e) =>
                                                    updateComponent(i, 'productId', e.target.value)
                                                }
                                                placeholder={t.manufacturing.placeholders.componentProductId}
                                                className="flex-1"
                                            />
                                            <Input
                                                type="number"
                                                min={0.0001}
                                                step={0.0001}
                                                value={comp.quantity}
                                                onChange={(e) =>
                                                    updateComponent(
                                                        i,
                                                        'quantity',
                                                        Number.parseFloat(e.target.value) || 1,
                                                    )
                                                }
                                                placeholder={t.manufacturing.placeholders.qty}
                                                className="w-24"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeComponent(i)}
                                                className="text-danger hover:text-red-700"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setShowModal(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleSave} loading={saving}>
                            {saving ? t.manufacturing.saving : editingId ? t.manufacturing.update : t.manufacturing.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </>
    );
}

// ------------------------------------------------------------------ //
//  Production Jobs Tab                                                //
// ------------------------------------------------------------------ //

function JobsTab() {
    const { t } = useI18n();
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
            const data = await fetchWithAuth('/manufacturing/bom?limit=200');
            setBoms(data?.items ?? []);
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
            setAddCostError(t.manufacturing.jobCosts.amount);
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

    const jobCountLabel = formatMessage(
        total === 1 ? t.manufacturing.jobCount : t.manufacturing.jobCountPlural,
        { count: total },
    );

    function getJobStatusLabel(status: string): string {
        const key = JOB_STATUS_LABEL_KEYS[status];
        return key ? t.manufacturing.jobStatuses[key] : status.replace('_', ' ');
    }

    return (
        <>
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{jobCountLabel}</span>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
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

            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            {actionError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{actionError}</div>
            )}

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
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.jobId}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.product}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.qty}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.status}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.started}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.completed}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.created}</th>
                                <th className="px-4 py-3 text-left">{t.manufacturing.columns.actions}</th>
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
                                        <span
                                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                JOB_STATUS_COLORS[job.status] ?? 'bg-gray-100 text-gray-600'
                                            }`}
                                        >
                                            {getJobStatusLabel(job.status)}
                                        </span>
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
                                                    className="text-green-600 hover:text-green-800 text-xs font-medium"
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

                                                {jobCostsError && (
                                                    <div className="bg-red-50 text-red-700 p-2 rounded text-xs">{jobCostsError}</div>
                                                )}

                                                {jobCostsLoading && !jobCosts[job.id] ? (
                                                    <div className="text-xs text-gray-500">{t.common.loading}</div>
                                                ) : (jobCosts[job.id]?.length ?? 0) === 0 ? (
                                                    <div className="text-xs text-gray-400">{t.manufacturing.jobCosts.empty}</div>
                                                ) : (
                                                    <table className="w-full text-xs">
                                                        <tbody className="divide-y divide-gray-200">
                                                            {jobCosts[job.id]!.map((cost) => (
                                                                <tr key={cost.id}>
                                                                    <td className="py-1.5 pr-3 text-gray-700">
                                                                        {t.manufacturing.jobCosts.costTypes[cost.costType]}
                                                                    </td>
                                                                    <td className="py-1.5 pr-3 text-gray-500">
                                                                        {cost.notes}
                                                                        {cost.sourcePurchaseItem && (
                                                                            <span className="text-gray-400">
                                                                                {' '}({cost.sourcePurchaseItem.purchase.purchase_number})
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-1.5 pr-3 text-right font-medium text-gray-800">
                                                                        {formatBDT(Number(cost.amount))}
                                                                    </td>
                                                                    <td className="py-1.5 text-right">
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
                                                        <select
                                                            value={costForm.sourcePurchaseItemId}
                                                            onChange={(e) => {
                                                                const source = costSources.find((s) => s.id === e.target.value);
                                                                setCostForm((f) => ({
                                                                    ...f,
                                                                    sourcePurchaseItemId: e.target.value,
                                                                    amount: source ? String(source.remainingAmount) : f.amount,
                                                                }));
                                                            }}
                                                            className="border rounded px-2 py-1.5 text-xs w-full sm:w-auto sm:max-w-[220px]"
                                                        >
                                                            <option value="">{t.manufacturing.jobCosts.noBillLink}</option>
                                                            {costSources.map((source) => (
                                                                <option key={source.id} value={source.id}>
                                                                    {source.purchaseNumber} — {source.productName} ({formatBDT(source.remainingAmount)} {t.manufacturing.jobCosts.remaining})
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <select
                                                            value={costForm.costType}
                                                            onChange={(e) =>
                                                                setCostForm((f) => ({ ...f, costType: e.target.value as any }))
                                                            }
                                                            className="border rounded px-2 py-1.5 text-xs"
                                                        >
                                                            {ADDABLE_JOB_COST_TYPES.map((type) => (
                                                                <option key={type} value={type}>
                                                                    {t.manufacturing.jobCosts.costTypes[type]}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            placeholder={t.manufacturing.jobCosts.amount}
                                                            value={costForm.amount}
                                                            onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))}
                                                            className="border rounded px-2 py-1.5 text-xs w-28"
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder={t.manufacturing.jobCosts.notesPlaceholder}
                                                            value={costForm.notes}
                                                            onChange={(e) => setCostForm((f) => ({ ...f, notes: e.target.value }))}
                                                            className="border rounded px-2 py-1.5 text-xs flex-1 min-w-[140px]"
                                                        />
                                                        <button
                                                            onClick={() => handleAddCost(job.id)}
                                                            disabled={addingCost}
                                                            className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-medium disabled:opacity-50"
                                                        >
                                                            {addingCost ? t.manufacturing.jobCosts.adding : t.manufacturing.jobCosts.add}
                                                        </button>
                                                    </div>
                                                )}
                                                {addCostError && (
                                                    <div className="bg-red-50 text-red-700 p-2 rounded text-xs">{addCostError}</div>
                                                )}

                                                <div className="pt-3 border-t border-gray-200 space-y-2">
                                                    <h5 className="text-xs font-semibold text-gray-700">{t.manufacturing.pricing.title}</h5>
                                                    {job.status !== 'COMPLETED' || job.costPerUnit == null ? (
                                                        <p className="text-xs text-gray-400">{t.manufacturing.pricing.onlyForCompleted}</p>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-wrap items-end gap-2">
                                                                <div>
                                                                    <label className="block text-[10px] text-gray-500 mb-0.5">
                                                                        {t.manufacturing.pricing.marginLabel}
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        step="1"
                                                                        value={marginPct[job.id] ?? '30'}
                                                                        onChange={(e) =>
                                                                            setMarginPct((prev) => ({ ...prev, [job.id]: e.target.value }))
                                                                        }
                                                                        className="border rounded px-2 py-1.5 text-xs w-20"
                                                                    />
                                                                </div>
                                                                <button
                                                                    onClick={() => handleSuggestPrice(job.id)}
                                                                    disabled={pricingLoading}
                                                                    className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium disabled:opacity-50"
                                                                >
                                                                    {pricingLoading ? t.manufacturing.pricing.suggesting : t.manufacturing.pricing.suggest}
                                                                </button>
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
                                                                    <button
                                                                        onClick={() => handleApplyPrice(job.id)}
                                                                        disabled={applyingPrice}
                                                                        className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium disabled:opacity-50"
                                                                    >
                                                                        {applyingPrice ? t.manufacturing.pricing.applying : t.manufacturing.pricing.apply}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                    {pricingError && (
                                                        <div className="bg-red-50 text-red-700 p-2 rounded text-xs">{pricingError}</div>
                                                    )}
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
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        {t.common.prevPage}
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-600">
                        {formatMessage(t.manufacturing.pageOf, { page, pages })}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(pages, p + 1))}
                        disabled={page === pages}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        {t.common.nextPage}
                    </button>
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
                                                        <th className="px-3 py-2 text-left">{t.manufacturing.requirementsColumns.component}</th>
                                                        <th className="px-3 py-2 text-right">{t.manufacturing.requirementsColumns.perUnit}</th>
                                                        <th className="px-3 py-2 text-right">{t.manufacturing.requirementsColumns.required}</th>
                                                        <th className="px-3 py-2 text-right">{t.manufacturing.requirementsColumns.available}</th>
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
                                                            <td className="px-3 py-2 text-right text-gray-700">{item.perUnitQty}</td>
                                                            <td className="px-3 py-2 text-right text-gray-700">{item.requiredQty}</td>
                                                            <td className={`px-3 py-2 text-right ${item.sufficient ? 'text-gray-700' : 'text-amber-700 font-medium'}`}>
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
                            {completingJob.recipe.components.map((comp) => (
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
        </>
    );
}

// ------------------------------------------------------------------ //
//  Analytics Tab                                                      //
// ------------------------------------------------------------------ //

function AnalyticsTab() {
    const { t } = useI18n();
    const [data, setData] = useState<AnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError('');
            try {
                const result: AnalyticsSummary = await fetchWithAuth('/manufacturing/analytics');
                setData(result);
            } catch {
                setError(t.manufacturing.analytics.loadFailed);
            } finally {
                setLoading(false);
            }
        })();
    }, [t.manufacturing.analytics.loadFailed]);

    if (loading) {
        return <div className="text-center py-12 text-gray-500">{t.common.loading}</div>;
    }

    if (error) {
        return <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>;
    }

    if (!data || data.totalCompletedJobs === 0) {
        return (
            <div className="text-center py-12 text-gray-400">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>{t.manufacturing.analytics.empty}</p>
            </div>
        );
    }

    const maxVolume = Math.max(...data.volumeTrend.map((p) => p.quantityProduced), 1);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FinancialKpiTile
                    title={t.manufacturing.analytics.completedJobs}
                    value={String(data.totalCompletedJobs)}
                    helper=""
                    tone="neutral"
                    Icon={CheckCircle2}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.unitsProduced}
                    value={String(data.totalUnitsProduced)}
                    helper=""
                    tone="neutral"
                    Icon={Package}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.totalMaterialCost}
                    value={formatBDT(data.totalMaterialCost)}
                    helper=""
                    tone="neutral"
                    Icon={Wallet}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.avgUnitCost}
                    value={formatBDT(data.avgUnitProductionCost)}
                    helper=""
                    tone="neutral"
                    Icon={Calculator}
                />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                    {t.manufacturing.analytics.volumeTrendTitle}
                </h3>
                <div className="space-y-2">
                    {data.volumeTrend.map((point) => (
                        <div key={point.date} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 text-xs text-gray-500">{formatDate(point.date)}</span>
                            <div className="flex-1 bg-blue-50 rounded h-4 overflow-hidden">
                                <div
                                    className="bg-blue-600 h-full rounded"
                                    style={{ width: `${Math.max(4, (point.quantityProduced / maxVolume) * 100)}%` }}
                                />
                            </div>
                            <span className="w-12 shrink-0 text-xs text-gray-700 text-right">{point.quantityProduced}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">{t.manufacturing.analytics.costTableTitle}</h3>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3 text-left">{t.manufacturing.analytics.columns.product}</th>
                            <th className="px-4 py-3 text-left">{t.manufacturing.analytics.columns.completed}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.analytics.columns.qtyProduced}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.analytics.columns.plannedCost}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.analytics.columns.wastageCost}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.analytics.columns.actualCost}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.analytics.columns.unitCost}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.jobs.map((job) => (
                            <tr key={job.jobId} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900">{job.productName}</div>
                                    {job.productSku && <div className="text-xs text-gray-500">{job.productSku}</div>}
                                </td>
                                <td className="px-4 py-3 text-gray-500">{formatDate(job.completedAt)}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{job.quantityProduced}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{formatBDT(job.plannedMaterialCost)}</td>
                                <td className={`px-4 py-3 text-right ${job.wastageCost > 0 ? 'text-amber-700 font-medium' : 'text-gray-700'}`}>
                                    {formatBDT(job.wastageCost)}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-700">{formatBDT(job.actualMaterialCost)}</td>
                                <td className="px-4 py-3 text-right text-gray-900 font-medium">{formatBDT(job.unitProductionCost)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ //
//  Per-Product P&L Tab                                                //
// ------------------------------------------------------------------ //

function ProductPLTab() {
    const { t } = useI18n();
    const [data, setData] = useState<ProductPLReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError('');
            try {
                const result: ProductPLReport = await fetchWithAuth('/manufacturing/reports/product-pl');
                setData(result);
            } catch {
                setError(t.manufacturing.productPL.loadFailed);
            } finally {
                setLoading(false);
            }
        })();
    }, [t.manufacturing.productPL.loadFailed]);

    if (loading) {
        return <div className="text-center py-12 text-gray-500">{t.common.loading}</div>;
    }

    if (error) {
        return <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>;
    }

    if (!data || data.products.length === 0) {
        return (
            <div className="text-center py-12 text-gray-400">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>{t.manufacturing.productPL.empty}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FinancialKpiTile
                    title={t.manufacturing.productPL.quantityProduced}
                    value={String(data.totals.quantityProduced)}
                    helper=""
                    tone="neutral"
                    Icon={Package}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.totalProductionCost}
                    value={formatBDT(data.totals.totalProductionCost)}
                    helper=""
                    tone="neutral"
                    Icon={Wallet}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.revenue}
                    value={formatBDT(data.totals.revenue)}
                    helper=""
                    tone="neutral"
                    Icon={Calculator}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.grossProfit}
                    value={formatBDT(data.totals.grossProfit)}
                    helper=""
                    tone={data.totals.grossProfit >= 0 ? 'positive' : 'negative'}
                    Icon={Calculator}
                />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3 text-left">{t.manufacturing.productPL.columns.product}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.jobsCompleted}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.qtyProduced}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.unitsSold}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.avgCost}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.productionCost}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.revenue}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.grossProfit}</th>
                            <th className="px-4 py-3 text-right">{t.manufacturing.productPL.columns.margin}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.products.map((row) => (
                            <tr key={row.productId} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900">{row.productName}</div>
                                    {row.productSku && <div className="text-xs text-gray-500">{row.productSku}</div>}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-700">{row.jobsCompleted}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{row.quantityProduced}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{row.unitsSold}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{formatBDT(row.avgCostPerUnit)}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{formatBDT(row.totalProductionCost)}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{formatBDT(row.revenue)}</td>
                                <td className={`px-4 py-3 text-right font-medium ${row.grossProfit >= 0 ? 'text-emerald-700' : 'text-danger'}`}>
                                    {formatBDT(row.grossProfit)}
                                </td>
                                <td className={`px-4 py-3 text-right font-medium ${row.grossMarginPct >= 0 ? 'text-emerald-700' : 'text-danger'}`}>
                                    {row.grossMarginPct.toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}