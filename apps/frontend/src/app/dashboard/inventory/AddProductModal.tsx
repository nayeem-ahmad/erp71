'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Camera } from 'lucide-react';
import { api } from '../../../lib/api';
import { COMPOUND_UNIT_DEFS, CompoundUnitType } from '../../../lib/compound-units';

interface AddProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode?: 'create' | 'edit';
    initialProduct?: any | null;
    onSubmit: (product: any) => Promise<void> | void;
}

export default function AddProductModal({ isOpen, onClose, mode = 'create', initialProduct = null, onSubmit }: AddProductModalProps) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        price: '',
        initialStock: '',
        warrantyEnabled: false,
        warrantyDurationDays: '',
        reorderLevel: '',
        safetyStock: '',
        leadTimeDays: '',
        image_url: '',
        groupId: '',
        subgroupId: '',
        unitType: 'none' as CompoundUnitType,
    });
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);

    useEffect(() => {
        if (!isOpen) return;

        const loadCategoryOptions = async () => {
            try {
                const [groupData, subgroupData] = await Promise.all([
                    api.getProductGroups(),
                    api.getProductSubgroups(),
                ]);
                setGroups(groupData);
                setSubgroups(subgroupData);
            } catch (error) {
                console.error('Failed to load product categories', error);
            }
        };

        loadCategoryOptions();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (mode === 'edit' && initialProduct) {
            setFormData({
                name: initialProduct.name || '',
                sku: initialProduct.sku || '',
                price: String(initialProduct.price ?? ''),
                initialStock: '',
                warrantyEnabled: Boolean(initialProduct.warranty_enabled),
                warrantyDurationDays: initialProduct.warranty_duration_days != null ? String(initialProduct.warranty_duration_days) : '',
                reorderLevel: initialProduct.reorder_level != null ? String(initialProduct.reorder_level) : '',
                safetyStock: initialProduct.safety_stock != null ? String(initialProduct.safety_stock) : '',
                leadTimeDays: initialProduct.lead_time_days != null ? String(initialProduct.lead_time_days) : '',
                image_url: initialProduct.image_url || '',
                groupId: initialProduct.group?.id || '',
                subgroupId: initialProduct.subgroup?.id || '',
                unitType: (initialProduct.unit_type as CompoundUnitType) || 'none',
            });
        }

        if (mode === 'create') {
            setFormData({
                name: '',
                sku: '',
                price: '',
                initialStock: '',
                warrantyEnabled: false,
                warrantyDurationDays: '',
                reorderLevel: '',
                safetyStock: '',
                leadTimeDays: '',
                image_url: '',
                groupId: '',
                subgroupId: '',
                unitType: 'none',
            });
        }
    }, [isOpen, mode, initialProduct]);

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup) => !formData.groupId || subgroup.group_id === formData.groupId),
        [subgroups, formData.groupId],
    );

    if (!isOpen) return null;

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const { url } = await api.uploadFile(file);
            setFormData({ ...formData, image_url: url });
        } catch (error) {
            console.error('Upload failed', error);
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const parseOptionalInt = (value: string) => (value === '' ? undefined : parseInt(value, 10));
            await onSubmit({
                ...formData,
                price: parseFloat(formData.price),
                initialStock: mode === 'create' ? parseInt(formData.initialStock) || 0 : undefined,
                warrantyEnabled: formData.warrantyEnabled,
                warrantyDurationDays: formData.warrantyEnabled ? parseOptionalInt(formData.warrantyDurationDays) : undefined,
                reorderLevel: parseOptionalInt(formData.reorderLevel),
                safetyStock: parseOptionalInt(formData.safetyStock),
                leadTimeDays: parseOptionalInt(formData.leadTimeDays),
                groupId: formData.groupId || undefined,
                subgroupId: formData.subgroupId || undefined,
                unitType: formData.unitType,
            });
            onClose();
        } catch (error) {
            console.error('Failed to add product', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-xl font-bold tracking-tight text-gray-900">{mode === 'edit' ? 'Edit Product' : 'Add New Product'}</h2>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-all">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="space-y-4">
                        {/* Image Upload */}
                        <div className="flex justify-center mb-6">
                            <div className="relative group">
                                <div className="w-24 h-24 bg-gray-100 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-blue-400">
                                    {formData.image_url ? (
                                        <img src={formData.image_url} alt="Preview" className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="text-center">
                                            <Camera className="w-6 h-6 text-gray-400 mx-auto" />
                                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Upload</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={handleImageUpload}
                                    disabled={uploading}
                                />
                                {uploading && (
                                    <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Product Name</label>
                            <input
                                required
                                type="text"
                                placeholder="e.g., Wireless Mechanical Keyboard"
                                className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">SKU</label>
                                <input
                                    type="text"
                                    placeholder="WH-KB-1032"
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-mono"
                                    value={formData.sku}
                                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Sale Price ($)</label>
                                <input
                                    required
                                    type="number"
                                    step="0.01"
                                    placeholder="120.00"
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Initial Stock Level</label>
                            <input
                                required={mode === 'create'}
                                type="number"
                                placeholder="50"
                                disabled={mode === 'edit'}
                                className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                value={formData.initialStock}
                                onChange={(e) => setFormData({ ...formData, initialStock: e.target.value })}
                            />
                        </div>

                        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.warrantyEnabled}
                                    onChange={(e) => setFormData({ ...formData, warrantyEnabled: e.target.checked, warrantyDurationDays: e.target.checked ? formData.warrantyDurationDays : '' })}
                                    className="rounded border-gray-300"
                                />
                                Warranty Enabled
                            </label>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Warranty Duration (Days)</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="e.g. 365"
                                    disabled={!formData.warrantyEnabled}
                                    className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold disabled:bg-gray-100"
                                    value={formData.warrantyDurationDays}
                                    onChange={(e) => setFormData({ ...formData, warrantyDurationDays: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Reorder Level</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="Use global"
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                    value={formData.reorderLevel}
                                    onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Safety Stock</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="Use global"
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                    value={formData.safetyStock}
                                    onChange={(e) => setFormData({ ...formData, safetyStock: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Lead Time Days</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="Use global"
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                    value={formData.leadTimeDays}
                                    onChange={(e) => setFormData({ ...formData, leadTimeDays: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Quantity Unit</label>
                            <select
                                className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                value={formData.unitType}
                                onChange={(e) => setFormData({ ...formData, unitType: e.target.value as CompoundUnitType })}
                            >
                                {(Object.keys(COMPOUND_UNIT_DEFS) as CompoundUnitType[]).map((key) => (
                                    <option key={key} value={key}>{COMPOUND_UNIT_DEFS[key].label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Group</label>
                                <select
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                    value={formData.groupId}
                                    onChange={(e) =>
                                        setFormData((current) => ({
                                            ...current,
                                            groupId: e.target.value,
                                            subgroupId:
                                                current.subgroupId &&
                                                !subgroups.some(
                                                    (subgroup) =>
                                                        subgroup.id === current.subgroupId && subgroup.group_id === e.target.value,
                                                )
                                                    ? ''
                                                    : current.subgroupId,
                                        }))
                                    }
                                >
                                    <option value="">Uncategorized</option>
                                    {groups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Subgroup</label>
                                <select
                                    className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                    value={formData.subgroupId}
                                    onChange={(e) => setFormData({ ...formData, subgroupId: e.target.value })}
                                    disabled={!filteredSubgroups.length}
                                >
                                    <option value="">None</option>
                                    {filteredSubgroups.map((subgroup) => (
                                        <option key={subgroup.id} value={subgroup.id}>
                                            {subgroup.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 flex space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-white border border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 py-3 rounded-xl font-bold text-sm transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={loading || uploading}
                            type="submit"
                            className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:translate-y-0"
                        >
                            {loading ? (mode === 'edit' ? 'Saving Changes...' : 'Creating Product...') : (mode === 'edit' ? 'Save Changes' : 'Confirm & Add Product')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
