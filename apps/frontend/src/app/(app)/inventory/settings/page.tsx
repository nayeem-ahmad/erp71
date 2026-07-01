'use client';

import { useEffect, useState } from 'react';
import { Plus, Save, Settings2, Warehouse } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function InventorySettingsPage() {
    const { t } = useI18n();
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<any>({});
    const [message, setMessage] = useState('');
    const [warehouseForm, setWarehouseForm] = useState<any>({ storeId: '', name: '', code: '', isDefault: false });
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
            });
            setWarehouseForm((current: any) => ({ ...current, storeId: warehouseData[0]?.store_id || '' }));
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

    const handleCreateWarehouse = async () => {
        try {
            await api.createInventoryWarehouse({
                storeId: warehouseForm.storeId,
                name: warehouseForm.name,
                code: warehouseForm.code || undefined,
                isDefault: warehouseForm.isDefault,
            });
            setMessage(t.inventorySettings.warehouseCreated);
            setWarehouseForm({ storeId: warehouseForm.storeId, name: '', code: '', isDefault: false });
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.warehouseCreateFailed);
        }
    };

    const handleToggleWarehouse = async (warehouse: any) => {
        try {
            await api.updateInventoryWarehouse(warehouse.id, {
                isActive: !warehouse.is_active,
            });
            setMessage(t.inventorySettings.warehouseUpdated);
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.warehouseUpdateFailed);
        }
    };

    const handleSetDefaultWarehouse = async (warehouse: any) => {
        try {
            await api.updateInventoryWarehouse(warehouse.id, { isDefault: true });
            setMessage(t.inventorySettings.warehouseDefaultUpdated);
            await loadAll();
        } catch (error: any) {
            setMessage(error.message || t.inventorySettings.warehouseDefaultFailed);
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
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-[1100px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventorySettings.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.inventorySettings.subtitle}
                        </p>
                    </div>
                    <button onClick={() => void handleSave()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200">
                        <Save className="w-4 h-4 mr-2" /> {t.common.saveChanges}
                    </button>
                </div>

                {message ? <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{message}</div> : null}

                <section className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">{t.inventorySettings.warehouseDefaults}</h2>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {Object.entries(warehouseDefaultLabels).map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{label}</label>
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

                <section className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Warehouse className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">{t.inventorySettings.warehouses}</h2>
                    </div>
                    <div className="grid md:grid-cols-4 gap-4">
                        <input value={warehouseForm.storeId} onChange={(e) => setWarehouseForm((current: any) => ({ ...current, storeId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.storeId} />
                        <input value={warehouseForm.name} onChange={(e) => setWarehouseForm((current: any) => ({ ...current, name: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.warehouseName} />
                        <input value={warehouseForm.code} onChange={(e) => setWarehouseForm((current: any) => ({ ...current, code: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.optionalCode} />
                        <button onClick={() => void handleCreateWarehouse()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center shadow-lg shadow-blue-200">
                            <Plus className="w-4 h-4 mr-2" /> {t.inventorySettings.addWarehouse}
                        </button>
                    </div>
                    <div className="grid gap-3">
                        {warehouses.map((warehouse) => (
                            <div key={warehouse.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 gap-4">
                                <div>
                                    <div className="text-sm font-black text-gray-900">{warehouse.name}</div>
                                    <div className="text-xs text-gray-500 font-bold uppercase tracking-widest">{warehouse.code} • {warehouse.is_default ? t.inventorySettings.default : t.inventorySettings.secondary} • {warehouse.is_active ? t.inventorySettings.active : t.inventorySettings.inactive}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!warehouse.is_default ? <button onClick={() => void handleSetDefaultWarehouse(warehouse)} className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold">{t.inventorySettings.makeDefault}</button> : null}
                                    <button onClick={() => void handleToggleWarehouse(warehouse)} className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold">{warehouse.is_active ? t.inventorySettings.deactivate : t.inventorySettings.activate}</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <h2 className="font-black text-lg">{t.inventorySettings.alertRules}</h2>
                    <div className="grid md:grid-cols-4 gap-4">
                        {Object.entries(alertRuleLabels).map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{label}</label>
                                <input type="number" value={form[key]} onChange={(e) => setForm((current: any) => ({ ...current, [key]: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                            </div>
                        ))}
                    </div>
                </section>

                <section className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <h2 className="font-black text-lg">{t.inventorySettings.reasonCatalog}</h2>
                    <div className="grid md:grid-cols-4 gap-4">
                        <select value={reasonForm.type} onChange={(e) => setReasonForm((current: any) => ({ ...current, type: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="SHRINKAGE">{t.inventorySettings.shrinkage}</option>
                            <option value="DISCREPANCY">{t.inventorySettings.discrepancy}</option>
                        </select>
                        <input value={reasonForm.code} onChange={(e) => setReasonForm((current: any) => ({ ...current, code: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.reasonCode} />
                        <input value={reasonForm.label} onChange={(e) => setReasonForm((current: any) => ({ ...current, label: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.inventorySettings.reasonLabel} />
                        <button onClick={() => void handleCreateReason()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center shadow-lg shadow-blue-200">
                            <Plus className="w-4 h-4 mr-2" /> {t.inventorySettings.addReason}
                        </button>
                    </div>
                    <div className="grid gap-3">
                        {reasons.map((reason) => (
                            <div key={reason.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-black text-gray-900">{reason.label}</div>
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
        </div>
    );
}