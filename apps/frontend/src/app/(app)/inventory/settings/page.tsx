'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Coins, PackageMinus, Plus, Save, Settings2 } from 'lucide-react';
import { api } from '@/lib/api';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { Checkbox } from '@/components/ui';

export default function InventorySettingsPage() {
    const { t } = useI18n();
    // Still loaded, but only to populate the defaults dropdowns below — the
    // warehouse list itself moved to /inventory/warehouses.
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<any>({});
    const [message, setMessage] = useState('');
    const [reasonForm, setReasonForm] = useState<any>({ type: 'SHRINKAGE', code: '', label: '' });

    useEffect(() => {
        void loadAll();
    }, []);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [warehouseData, settingsData, reasonData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getInventorySettings(),
                api.getInventoryReasons(),
            ]);
            setWarehouses(warehouseData);
            setReasons(reasonData);
            setForm({
                defaultProductWarehouseId: settingsData.defaultProductWarehouse?.id || '',
                defaultPurchaseWarehouseId: settingsData.defaultPurchaseWarehouse?.id || '',
                defaultSalesWarehouseId: settingsData.defaultSalesWarehouse?.id || '',
                defaultShrinkageWarehouseId: settingsData.defaultShrinkageWarehouse?.id || '',
                defaultTransferSourceWarehouseId: settingsData.defaultTransferSourceWarehouse?.id || '',
                defaultTransferDestinationWarehouseId: settingsData.defaultTransferDestinationWarehouse?.id || '',
                defaultReorderLevel: settingsData.default_reorder_level ?? 10,
                defaultSafetyStock: settingsData.default_safety_stock ?? 0,
                defaultLeadTimeDays: settingsData.default_lead_time_days ?? 0,
                discrepancyApprovalThreshold: settingsData.discrepancy_approval_threshold ?? 25,
                costingMethod: settingsData.costing_method ?? 'WEIGHTED_AVERAGE',
                allowNegativeStock: settingsData.allow_negative_stock ?? false,
            });
        } catch (error) {
            console.error('Failed to load inventory settings', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            await api.updateInventorySettings({
                ...form,
                defaultReorderLevel: Number(form.defaultReorderLevel),
                defaultSafetyStock: Number(form.defaultSafetyStock),
                defaultLeadTimeDays: Number(form.defaultLeadTimeDays),
                discrepancyApprovalThreshold: Number(form.discrepancyApprovalThreshold),
            });
            setMessage(t.inventorySettings.settingsUpdated);
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.saveFailed);
        }
    };

    const handleCreateReason = async () => {
        try {
            await api.createInventoryReason(reasonForm);
            setMessage(t.inventorySettings.reasonCreated);
            setReasonForm({ type: 'SHRINKAGE', code: '', label: '' });
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.reasonCreateFailed);
        }
    };

    const handleToggleReason = async (reason: any) => {
        try {
            await api.updateInventoryReason(reason.id, { isActive: !reason.is_active });
            setMessage(t.inventorySettings.reasonUpdated);
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.reasonUpdateFailed);
        }
    };

    const warehouseDefaultLabels: Record<string, string> = {
        defaultProductWarehouseId: t.inventorySettings.productCreationWarehouse,
        defaultPurchaseWarehouseId: t.inventorySettings.purchaseReceiptWarehouse,
        defaultSalesWarehouseId: t.inventorySettings.salesIssueWarehouse,
        defaultShrinkageWarehouseId: t.inventorySettings.shrinkageWarehouse,
        defaultTransferSourceWarehouseId: t.inventorySettings.transferSourceWarehouse,
        defaultTransferDestinationWarehouseId: t.inventorySettings.transferDestinationWarehouse,
    };

    const alertRuleLabels: Record<string, string> = {
        defaultReorderLevel: t.inventorySettings.defaultReorderLevel,
        defaultSafetyStock: t.inventorySettings.defaultSafetyStock,
        defaultLeadTimeDays: t.inventorySettings.defaultLeadTimeDays,
        discrepancyApprovalThreshold: t.inventorySettings.discrepancyApprovalThreshold,
    };

    if (loading) {
        return <div className="p-6 text-sm text-gray-500">{t.inventorySettings.loading}</div>;
    }

    return (
        <PageShell>
            <div className="max-w-[1100px] mx-auto space-y-6">
                <PageHeader
                    title={t.inventorySettings.title}
                    subtitle={t.inventorySettings.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventorySettings.title,
                        'inventory',
                    )}
                    actions={(
                        <button onClick={() => void handleSave()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-sm">
                            <Save className="w-4 h-4 me-2" /> {t.common.saveChanges}
                        </button>
                    )}
                />

                {message ? <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{message}</div> : null}

                <section className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Settings2 className="w-5 h-5 text-blue-600" />
                            <h2 className="font-bold text-lg">{t.inventorySettings.warehouseDefaults}</h2>
                        </div>
                        {/* The warehouse list itself lives at /inventory/warehouses; this page
                            only chooses among them, so anyone who came here to add or
                            deactivate one needs a way onward. */}
                        <Link
                            href={routes.inventory.warehouses}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                        >
                            {t.warehousesPage.manageWarehouses}
                            <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {Object.entries(warehouseDefaultLabels).map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{label}</label>
                                <select value={form[key]} onChange={(e) => setForm((current: any) => ({ ...current, [key]: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                    <option value="">{t.inventorySettings.selectWarehouse}</option>
                                    {warehouses.map((warehouse) => (
                                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <h2 className="font-bold text-lg">{t.inventorySettings.alertRules}</h2>
                    <div className="grid md:grid-cols-4 gap-4">
                        {Object.entries(alertRuleLabels).map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{label}</label>
                                <input type="number" value={form[key]} onChange={(e) => setForm((current: any) => ({ ...current, [key]: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                            </div>
                        ))}
                    </div>
                </section>

                <section className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Coins className="w-5 h-5 text-blue-600" />
                        <h2 className="font-bold text-lg">{t.inventorySettings.costingMethod}</h2>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1" htmlFor="costing-method">
                                {t.inventorySettings.costingMethodLabel}
                            </label>
                            <select
                                id="costing-method"
                                value={form.costingMethod}
                                onChange={(e) => setForm((current: any) => ({ ...current, costingMethod: e.target.value }))}
                                className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                            >
                                <option value="WEIGHTED_AVERAGE">{t.inventorySettings.costingWeightedAverage}</option>
                                <option value="LATEST_COST">{t.inventorySettings.costingLatestCost}</option>
                            </select>
                        </div>
                        <p className="text-xs text-gray-500 md:self-end md:pb-3">
                            {form.costingMethod === 'LATEST_COST'
                                ? t.inventorySettings.costingLatestCostHelp
                                : t.inventorySettings.costingWeightedAverageHelp}
                        </p>
                    </div>
                    <p className="text-xs text-gray-500">{t.inventorySettings.costingMethodNote}</p>
                </section>

                <section className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <PackageMinus className="w-5 h-5 text-blue-600" />
                        <h2 className="font-bold text-lg">{t.inventorySettings.stockPolicy}</h2>
                    </div>
                    <label htmlFor="allow-negative-stock" className="flex items-start gap-3 cursor-pointer">
                        <Checkbox
                            id="allow-negative-stock"
                            className="mt-0.5"
                            checked={!!form.allowNegativeStock}
                            onChange={(e) => setForm((current: any) => ({ ...current, allowNegativeStock: e.target.checked }))}
                        />
                        <span>
                            <span className="block text-sm font-medium text-gray-900">{t.inventorySettings.allowNegativeStock}</span>
                            <span className="block text-xs text-gray-500 mt-0.5">
                                {form.allowNegativeStock
                                    ? t.inventorySettings.allowNegativeStockOnHelp
                                    : t.inventorySettings.allowNegativeStockOffHelp}
                            </span>
                        </span>
                    </label>
                    <p className="text-xs text-gray-500">{t.inventorySettings.allowNegativeStockNote}</p>
                </section>

                <section className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <h2 className="font-bold text-lg">{t.inventorySettings.reasonCatalog}</h2>
                    <div className="grid md:grid-cols-4 gap-4">
                        <select value={reasonForm.type} onChange={(e) => setReasonForm((current: any) => ({ ...current, type: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="SHRINKAGE">{t.inventorySettings.shrinkage}</option>
                            <option value="DISCREPANCY">{t.inventorySettings.discrepancy}</option>
                        </select>
                        <input value={reasonForm.code} onChange={(e) => setReasonForm((current: any) => ({ ...current, code: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.reasonCode} />
                        <input value={reasonForm.label} onChange={(e) => setReasonForm((current: any) => ({ ...current, label: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.reasonLabel} />
                        <button onClick={() => void handleCreateReason()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center shadow-lg shadow-sm">
                            <Plus className="w-4 h-4 me-2" /> {t.inventorySettings.addReason}
                        </button>
                    </div>
                    <div className="grid gap-3">
                        {reasons.map((reason) => (
                            <div key={reason.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-bold text-gray-900">{reason.label}</div>
                                    <div className="text-xs text-gray-500 font-bold uppercase tracking-widest">{reason.type} • {reason.code}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-gray-400">{reason.is_system ? t.inventorySettings.system : reason.is_active ? t.inventorySettings.active : t.inventorySettings.inactive}</div>
                                    {!reason.is_system ? <button onClick={() => void handleToggleReason(reason)} className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold">{reason.is_active ? t.inventorySettings.deactivate : t.inventorySettings.activate}</button> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
    </PageShell>
    );
}