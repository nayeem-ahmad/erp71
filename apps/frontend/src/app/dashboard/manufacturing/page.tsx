'use client';

import { useState, useEffect, useCallback } from 'react';
import { Factory, Plus, X, RefreshCw, Cog, Trash2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatDate } from '@/lib/format';

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
}

interface JobsResponse {
    items: ProductionJob[];
    total: number;
    page: number;
    limit: number;
    pages: number;
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

// ------------------------------------------------------------------ //
//  Main Page                                                          //
// ------------------------------------------------------------------ //

export default function ManufacturingPage() {
    const [activeTab, setActiveTab] = useState<'bom' | 'jobs'>('bom');

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-2">
                <Factory className="h-6 w-6 text-gray-600" />
                <h1 className="text-2xl font-bold text-gray-900">Manufacturing</h1>
            </div>

            {/* Top-level tabs */}
            <div className="flex gap-1 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('bom')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'bom'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Bill of Materials
                </button>
                <button
                    onClick={() => setActiveTab('jobs')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'jobs'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Production Jobs
                </button>
            </div>

            {activeTab === 'bom' ? <BomTab /> : <JobsTab />}
        </div>
    );
}

// ------------------------------------------------------------------ //
//  Bill of Materials Tab                                              //
// ------------------------------------------------------------------ //

function BomTab() {
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
            const res = await fetchWithAuth('/api/v1/manufacturing/bom');
            const json = await res.json();
            setBoms(json?.data ?? json ?? []);
        } catch {
            setError('Failed to load BOMs');
        } finally {
            setLoading(false);
        }
    }, []);

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
            const res = await fetchWithAuth(`/api/v1/manufacturing/bom/${bom.id}`);
            const json = await res.json();
            const detail: BomRecipeDetail = json?.data ?? json;
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
            alert('Failed to load BOM details');
        }
    }

    async function handleSave() {
        if (!form.productId.trim()) {
            setSaveError('Product ID is required.');
            return;
        }
        if (form.outputQty < 1) {
            setSaveError('Output quantity must be at least 1.');
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
                ? `/api/v1/manufacturing/bom/${editingId}`
                : '/api/v1/manufacturing/bom';
            const method = editingId ? 'PATCH' : 'POST';
            const res = await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const msg = err?.message;
                throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
            }
            setShowModal(false);
            load();
        } catch (e: any) {
            setSaveError(e.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this BOM recipe? This cannot be undone.')) return;
        try {
            await fetchWithAuth(`/api/v1/manufacturing/bom/${id}`, { method: 'DELETE' });
            load();
        } catch {
            alert('Failed to delete BOM');
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

    return (
        <>
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{boms.length} recipe{boms.length !== 1 ? 's' : ''}</span>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        New BOM
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

            {loading ? (
                <div className="text-center py-12 text-gray-500">Loading...</div>
            ) : boms.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Cog className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>No BOM recipes yet. Create one to get started.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Product</th>
                                <th className="px-4 py-3 text-left">Output Qty</th>
                                <th className="px-4 py-3 text-left">Components</th>
                                <th className="px-4 py-3 text-left">Notes</th>
                                <th className="px-4 py-3 text-left">Created</th>
                                <th className="px-4 py-3 text-left">Actions</th>
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
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(bom.id)}
                                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* BOM Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b">
                            <h2 className="text-lg font-semibold">
                                {editingId ? 'Edit BOM Recipe' : 'New BOM Recipe'}
                            </h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {saveError && (
                                <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{saveError}</div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Output Product ID *
                                </label>
                                <input
                                    type="text"
                                    value={form.productId}
                                    onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                                    placeholder="Product ID of the manufactured item"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    disabled={!!editingId}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Output Quantity *
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    value={form.outputQty}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, outputQty: parseInt(e.target.value) || 1 }))
                                    }
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Number of output units produced per production run
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea
                                    rows={2}
                                    value={form.notes}
                                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            {/* Components */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-medium text-gray-700">
                                        Components / Raw Materials
                                    </label>
                                    <button
                                        type="button"
                                        onClick={addComponent}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                                    >
                                        <Plus className="h-3 w-3" />
                                        Add Component
                                    </button>
                                </div>

                                {form.components.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">
                                        No components added yet.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {form.components.map((comp, i) => (
                                            <div key={i} className="flex gap-2 items-center">
                                                <input
                                                    type="text"
                                                    value={comp.productId}
                                                    onChange={(e) =>
                                                        updateComponent(i, 'productId', e.target.value)
                                                    }
                                                    placeholder="Component Product ID"
                                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                />
                                                <input
                                                    type="number"
                                                    min={0.0001}
                                                    step={0.0001}
                                                    value={comp.quantity}
                                                    onChange={(e) =>
                                                        updateComponent(
                                                            i,
                                                            'quantity',
                                                            parseFloat(e.target.value) || 1,
                                                        )
                                                    }
                                                    placeholder="Qty"
                                                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeComponent(i)}
                                                    className="text-red-400 hover:text-red-600"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 p-6 border-t bg-gray-50 rounded-b-xl">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ------------------------------------------------------------------ //
//  Production Jobs Tab                                                //
// ------------------------------------------------------------------ //

function JobsTab() {
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

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        setActionError('');
        try {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (statusFilter) params.set('status', statusFilter);
            const res = await fetchWithAuth(`/api/v1/manufacturing/jobs?${params}`);
            const json = await res.json();
            const data: JobsResponse = json?.data ?? json;
            setJobs(data.items ?? []);
            setTotal(data.total ?? 0);
            setPages(data.pages ?? 1);
        } catch {
            setError('Failed to load production jobs');
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter]);

    useEffect(() => { load(); }, [load]);

    function openCreate() {
        setForm({ ...EMPTY_JOB_FORM });
        setSaveError('');
        setShowModal(true);
    }

    async function handleCreateJob() {
        if (!form.recipeId.trim()) {
            setSaveError('Recipe ID is required.');
            return;
        }
        if (form.quantity < 1) {
            setSaveError('Quantity must be at least 1.');
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
            const res = await fetchWithAuth('/api/v1/manufacturing/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const msg = err?.message;
                throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Failed to create job'));
            }
            setShowModal(false);
            load();
        } catch (e: any) {
            setSaveError(e.message ?? 'Failed to create job');
        } finally {
            setSaving(false);
        }
    }

    async function handleJobAction(jobId: string, action: 'start' | 'complete' | 'cancel') {
        const label = action.charAt(0).toUpperCase() + action.slice(1);
        if (!confirm(`${label} this production job?`)) return;
        setActionError('');
        try {
            const res = await fetchWithAuth(`/api/v1/manufacturing/jobs/${jobId}/${action}`, {
                method: 'POST',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const msg = err?.message;
                throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? `Failed to ${action} job`));
            }
            load();
        } catch (e: any) {
            setActionError(e.message ?? `Failed to ${action} job`);
        }
    }

    const filterTabs = [
        { label: 'All', value: '' },
        { label: 'Draft', value: 'DRAFT' },
        { label: 'In Progress', value: 'IN_PROGRESS' },
        { label: 'Completed', value: 'COMPLETED' },
    ];

    return (
        <>
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{total} job{total !== 1 ? 's' : ''}</span>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        New Job
                    </button>
                </div>
            </div>

            {/* Status filter tabs */}
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
                <div className="text-center py-12 text-gray-500">Loading...</div>
            ) : jobs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Factory className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>No production jobs yet.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Job ID</th>
                                <th className="px-4 py-3 text-left">Product</th>
                                <th className="px-4 py-3 text-left">Qty</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Started</th>
                                <th className="px-4 py-3 text-left">Completed</th>
                                <th className="px-4 py-3 text-left">Created</th>
                                <th className="px-4 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {jobs.map((job) => (
                                <tr key={job.id} className="hover:bg-gray-50">
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
                                            {job.status.replace('_', ' ')}
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
                                                    Start
                                                </button>
                                            )}
                                            {job.status === 'IN_PROGRESS' && (
                                                <button
                                                    onClick={() => handleJobAction(job.id, 'complete')}
                                                    className="text-green-600 hover:text-green-800 text-xs font-medium"
                                                >
                                                    Complete
                                                </button>
                                            )}
                                            {(job.status === 'DRAFT' || job.status === 'IN_PROGRESS') && (
                                                <button
                                                    onClick={() => handleJobAction(job.id, 'cancel')}
                                                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {pages > 1 && (
                <div className="flex justify-center gap-2">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-600">
                        Page {page} of {pages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(pages, p + 1))}
                        disabled={page === pages}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            )}

            {/* New Job Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between p-6 border-b">
                            <h2 className="text-lg font-semibold">New Production Job</h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {saveError && (
                                <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{saveError}</div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    BOM Recipe ID *
                                </label>
                                <input
                                    type="text"
                                    value={form.recipeId}
                                    onChange={(e) => setForm((f) => ({ ...f, recipeId: e.target.value }))}
                                    placeholder="Recipe ID"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Quantity *
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    value={form.quantity}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 1 }))
                                    }
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Number of production runs (multiplied by recipe output qty)
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea
                                    rows={2}
                                    value={form.notes}
                                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 p-6 border-t bg-gray-50 rounded-b-xl">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateJob}
                                disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? 'Creating…' : 'Create Job'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
