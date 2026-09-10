'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Cog, Trash2 } from 'lucide-react';
import { api, fetchAllPages, fetchWithAuth } from '@/lib/api';
import { formatDate } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import {
    EMPTY_BOM_FORM,
    productLabel,
    type BomRecipe,
    type BomRecipeDetail,
    type PickerProduct,
} from './manufacturing-shared';

// ------------------------------------------------------------------ //
//  Bill of Materials                                                  //
// ------------------------------------------------------------------ //

export default function ManufacturingBomsPage() {
    const { t, fmt } = useI18n();
    const [boms, setBoms] = useState<BomRecipe[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ ...EMPTY_BOM_FORM });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [products, setProducts] = useState<PickerProduct[]>([]);

    useEffect(() => {
        api.getProducts().then(setProducts).catch(() => setProducts([]));
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setBoms(await fetchAllPages<BomRecipe>('/manufacturing/bom'));
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
        setError('');
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
            setError(t.manufacturing.loadBomDetailFailed);
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
        setError('');
        try {
            await fetchWithAuth(`/manufacturing/bom/${id}`, { method: 'DELETE' });
            load();
        } catch (e: any) {
            // The API explains *why* a recipe cannot go (jobs still reference it);
            // that beats a generic failure line.
            setError(e?.message || t.manufacturing.deleteBomFailed);
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

    const recipeCountLabel = fmt(t.manufacturing.recipeCount, { count: boms.length });
    // A recipe that consumed its own output would decrement the finished goods it
    // just produced, so the output product is not on offer as a component.
    const componentOptions = products.filter((product) => product.id !== form.productId);

    return (
        <PageShell>
            <PageHeader
                title={t.manufacturing.tabs.boms}
                subtitle={t.manufacturing.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.manufacturing,
                    t.manufacturing.tabs.boms,
                    'manufacturing',
                )}
            />
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{recipeCountLabel}</span>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={load}
                        aria-label={t.common.refresh}
                        icon={<RefreshCw className="h-4 w-4" />}
                    />
                    <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                        {t.manufacturing.newBom}
                    </Button>
                </div>
            </div>

            {error && <Alert tone="danger">{error}</Alert>}

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
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.product}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.outputQty}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.components}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.notes}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.created}</th>
                                <th className="px-4 py-3 text-start">{t.manufacturing.columns.actions}</th>
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

                        <Field label={t.manufacturing.outputProductId} htmlFor="bom-output-product">
                            <Select
                                id="bom-output-product"
                                value={form.productId}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        productId: e.target.value,
                                        // Clear any component row that has just become the output.
                                        components: f.components.map((c) =>
                                            c.productId === e.target.value ? { ...c, productId: '' } : c,
                                        ),
                                    }))
                                }
                                disabled={!!editingId}
                            >
                                <option value="">{t.manufacturing.placeholders.productId}</option>
                                {products.map((product) => (
                                    <option key={product.id} value={product.id}>
                                        {productLabel(product)}
                                    </option>
                                ))}
                            </Select>
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
                                            <Select
                                                aria-label={t.manufacturing.placeholders.componentProductId}
                                                value={comp.productId}
                                                onChange={(e) =>
                                                    updateComponent(i, 'productId', e.target.value)
                                                }
                                                className="flex-1 min-w-0"
                                            >
                                                <option value="">{t.manufacturing.placeholders.componentProductId}</option>
                                                {componentOptions.map((product) => (
                                                    <option key={product.id} value={product.id}>
                                                        {productLabel(product)}
                                                    </option>
                                                ))}
                                            </Select>
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
        </PageShell>
    );
}
