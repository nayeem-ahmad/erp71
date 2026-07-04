'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { X, Camera, Bold, Italic, List, ListOrdered, Trash2 } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { api } from '@/lib/api';
import { COMPOUND_UNIT_DEFS, CompoundUnitType } from '@/lib/compound-units';
import { useI18n } from '@/lib/i18n';

interface AddProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode?: 'create' | 'edit';
    initialProduct?: any | null;
    onSubmit: (product: any) => Promise<void> | void;
}

export default function AddProductModal({ isOpen, onClose, mode = 'create', initialProduct = null, onSubmit }: AddProductModalProps) {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<'basic' | 'storefront'>('basic');
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        price: '',
        initialStock: '',
        isFeatured: false,
        warrantyEnabled: false,
        warrantyDurationDays: '',
        reorderLevel: '',
        safetyStock: '',
        leadTimeDays: '',
        image_url: '',
        brandId: '',
        groupId: '',
        subgroupId: '',
        unitType: 'none' as CompoundUnitType,
        description: '',
        images_gallery: [] as string[],
    });
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadingGallery, setUploadingGallery] = useState(false);
    const [brands, setBrands] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);

    useEffect(() => {
        if (!isOpen) return;

        const loadCategoryOptions = async () => {
            try {
                const [brandData, groupData, subgroupData] = await Promise.all([
                    api.getBrands(),
                    api.getProductGroups(),
                    api.getProductSubgroups(),
                ]);
                setBrands(brandData);
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
                isFeatured: Boolean(initialProduct.is_featured),
                warrantyEnabled: Boolean(initialProduct.warranty_enabled),
                warrantyDurationDays: initialProduct.warranty_duration_days != null ? String(initialProduct.warranty_duration_days) : '',
                reorderLevel: initialProduct.reorder_level != null ? String(initialProduct.reorder_level) : '',
                safetyStock: initialProduct.safety_stock != null ? String(initialProduct.safety_stock) : '',
                leadTimeDays: initialProduct.lead_time_days != null ? String(initialProduct.lead_time_days) : '',
                image_url: initialProduct.image_url || '',
                brandId: initialProduct.brand?.id || '',
                groupId: initialProduct.group?.id || '',
                subgroupId: initialProduct.subgroup?.id || '',
                unitType: (initialProduct.unit_type as CompoundUnitType) || 'none',
                description: initialProduct.description || '',
                images_gallery: initialProduct.images_gallery || [],
            });
        }

        if (mode === 'create') {
            setFormData({
                name: '',
                sku: '',
                price: '',
                initialStock: '',
                isFeatured: false,
                warrantyEnabled: false,
                warrantyDurationDays: '',
                reorderLevel: '',
                safetyStock: '',
                leadTimeDays: '',
                image_url: '',
                brandId: '',
                groupId: '',
                subgroupId: '',
                unitType: 'none',
                description: '',
                images_gallery: [],
            });
        }
        setActiveTab('basic');
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

    const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploadingGallery(true);
        try {
            const promises = Array.from(files).map((file) => api.uploadFile(file));
            const results = await Promise.all(promises);
            const urls = results.map((r) => r.url);
            setFormData((prev) => ({
                ...prev,
                images_gallery: [...prev.images_gallery, ...urls],
            }));
        } catch (error) {
            console.error('Gallery upload failed', error);
        } finally {
            setUploadingGallery(false);
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
                isFeatured: formData.isFeatured,
                warrantyEnabled: formData.warrantyEnabled,
                warrantyDurationDays: formData.warrantyEnabled ? parseOptionalInt(formData.warrantyDurationDays) : undefined,
                reorderLevel: parseOptionalInt(formData.reorderLevel),
                safetyStock: parseOptionalInt(formData.safetyStock),
                leadTimeDays: parseOptionalInt(formData.leadTimeDays),
                brandId: formData.brandId || undefined,
                groupId: formData.groupId || undefined,
                subgroupId: formData.subgroupId || undefined,
                unitType: formData.unitType,
                description: formData.description || undefined,
                images_gallery: formData.images_gallery,
            });
            onClose();
        } catch (error) {
            console.error('Failed to add product', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModalShell size="xl" onBackdropClick={onClose}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h2 className="text-xl font-bold tracking-tight text-gray-900">{mode === 'edit' ? t.addProductModal.editTitle : t.addProductModal.addTitle}</h2>
                <button onClick={onClose} type="button" className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-all">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                {/* Tab switcher */}
                <div className="flex items-center border-b border-gray-100 px-6 gap-2 bg-white flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => setActiveTab('basic')}
                        className={`relative py-3.5 px-3 text-sm font-semibold transition-colors ${
                            activeTab === 'basic'
                                ? 'text-blue-600 font-bold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {(t.addProductModal as any).basicTab || "Basic Details"}
                        {activeTab === 'basic' && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-blue-600" />
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('storefront')}
                        className={`relative py-3.5 px-3 text-sm font-semibold transition-colors ${
                            activeTab === 'storefront'
                                ? 'text-blue-600 font-bold'
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {(t.addProductModal as any).storefrontTab || "Storefront (Ecommerce)"}
                        {activeTab === 'storefront' && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-blue-600" />
                        )}
                    </button>
                </div>

                <div className="space-y-6 overflow-y-auto px-6 py-6 flex-1 min-h-[350px]">
                    {activeTab === 'basic' ? (
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                            {/* Left Column: Basic Info & Categories */}
                            <div className="md:col-span-7 space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.productName}</label>
                                    <input
                                        required
                                        type="text"
                                        placeholder={t.addProductModal.placeholders.name}
                                        className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">SKU</label>
                                        <input
                                            type="text"
                                            placeholder={t.addProductModal.placeholders.sku}
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-mono"
                                            value={formData.sku}
                                            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.salePrice}</label>
                                        <input
                                            required
                                            type="number"
                                            step="0.01"
                                            placeholder={t.addProductModal.placeholders.price}
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold"
                                            value={formData.price}
                                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.brand}</label>
                                        <select
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                            value={formData.brandId}
                                            onChange={(e) => setFormData({ ...formData, brandId: e.target.value })}
                                        >
                                            <option value="">{t.addProductModal.noBrand}</option>
                                            {brands.map((brand) => (
                                                <option key={brand.id} value={brand.id}>
                                                    {brand.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.quantityUnit}</label>
                                        <select
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                            value={formData.unitType}
                                            onChange={(e) => setFormData({ ...formData, unitType: e.target.value as CompoundUnitType })}
                                        >
                                            {(Object.keys(COMPOUND_UNIT_DEFS) as CompoundUnitType[]).map((key) => (
                                                <option key={key} value={key}>{COMPOUND_UNIT_DEFS[key].label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.group}</label>
                                        <select
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
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
                                            <option value="">{t.addProductModal.uncategorized}</option>
                                            {groups.map((group) => (
                                                <option key={group.id} value={group.id}>
                                                    {group.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.subgroup}</label>
                                        <select
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                            value={formData.subgroupId}
                                            onChange={(e) => setFormData({ ...formData, subgroupId: e.target.value })}
                                            disabled={!filteredSubgroups.length}
                                        >
                                            <option value="">{t.common.none}</option>
                                            {filteredSubgroups.map((subgroup) => (
                                                <option key={subgroup.id} value={subgroup.id}>
                                                    {subgroup.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Upload, Stock, Settings & Limits */}
                            <div className="md:col-span-5 space-y-4">
                                <div className="flex gap-4 items-start">
                                    {/* Image Upload */}
                                    <div className="relative group flex-shrink-0">
                                        <div className="w-20 h-20 bg-gray-100 rounded-xl border border-dashed border-gray-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-blue-400">
                                            {formData.image_url ? (
                                                <img src={formData.image_url} alt="Preview" className="w-full h-full object-cover" loading="lazy" />
                                            ) : (
                                                <div className="text-center p-1">
                                                    <Camera className="w-5 h-5 text-gray-400 mx-auto mb-0.5" />
                                                    <span className="text-[7px] font-black uppercase tracking-widest text-gray-400 block">{t.addProductModal.upload}</span>
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
                                            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center rounded-xl">
                                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Initial Stock */}
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.addProductModal.initialStock}</label>
                                        <input
                                            required={mode === 'create'}
                                            type="number"
                                            placeholder={t.addProductModal.placeholders.initialStock}
                                            disabled={mode === 'edit'}
                                            className="w-full bg-gray-50 border-none rounded-xl py-2.5 px-3.5 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold disabled:opacity-50"
                                            value={formData.initialStock}
                                            onChange={(e) => setFormData({ ...formData, initialStock: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="bg-gray-50 rounded-2xl p-4 space-y-3 border border-gray-100">
                                    <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={formData.warrantyEnabled}
                                            onChange={(e) => setFormData({ ...formData, warrantyEnabled: e.target.checked, warrantyDurationDays: e.target.checked ? formData.warrantyDurationDays : '' })}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        {t.addProductModal.warrantyEnabled}
                                    </label>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1 ml-1">{t.addProductModal.warrantyDuration}</label>
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder={t.addProductModal.placeholders.warrantyDays}
                                            disabled={!formData.warrantyEnabled}
                                            className="w-full bg-white border-none rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-bold disabled:bg-gray-100 disabled:opacity-50"
                                            value={formData.warrantyDurationDays}
                                            onChange={(e) => setFormData({ ...formData, warrantyDurationDays: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="bg-gray-50/50 rounded-2xl p-4 border border-gray-100/50 space-y-3">
                                    <span className="block text-xs font-bold text-gray-700 ml-1">Inventory Alert & Lead Times</span>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <label className="block text-[10px] font-medium text-gray-400 mb-0.5 ml-1 truncate" title={t.addProductModal.reorderLevel}>
                                                {t.addProductModal.reorderLevel}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder={t.addProductModal.useGlobal}
                                                className="w-full bg-white border-none rounded-xl py-2.5 px-2 text-xs focus:ring-2 focus:ring-blue-500/10 transition-all font-bold text-center"
                                                value={formData.reorderLevel}
                                                onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-medium text-gray-400 mb-0.5 ml-1 truncate" title={t.addProductModal.safetyStock}>
                                                {t.addProductModal.safetyStock}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder={t.addProductModal.useGlobal}
                                                className="w-full bg-white border-none rounded-xl py-2.5 px-2 text-xs focus:ring-2 focus:ring-blue-500/10 transition-all font-bold text-center"
                                                value={formData.safetyStock}
                                                onChange={(e) => setFormData({ ...formData, safetyStock: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-medium text-gray-400 mb-0.5 ml-1 truncate" title={t.addProductModal.leadTimeDays}>
                                                {t.addProductModal.leadTimeDays}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder={t.addProductModal.useGlobal}
                                                className="w-full bg-white border-none rounded-xl py-2.5 px-2 text-xs focus:ring-2 focus:ring-blue-500/10 transition-all font-bold text-center"
                                                value={formData.leadTimeDays}
                                                onChange={(e) => setFormData({ ...formData, leadTimeDays: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Featured toggle card */}
                            <div className="bg-blue-50/30 rounded-2xl p-5 border border-blue-100 flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-black text-blue-900 mb-1">{t.addProductModal.featuredLabel || "Featured Product"}</h4>
                                    <p className="text-xs text-blue-700/60">Highlight this product in trending items on the web storefront.</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={formData.isFeatured}
                                        onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            {/* Rich Text Description */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">
                                    {(t.addProductModal as any).description || "Product Description"}
                                </label>
                                <RichTextEditor
                                    value={formData.description}
                                    onChange={(val) => setFormData((prev) => ({ ...prev, description: val }))}
                                    placeholder="Enter full product storefront description..."
                                />
                            </div>

                            {/* Image Gallery */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">
                                    {(t.addProductModal as any).imageGallery || "Image Gallery"}
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                                    {formData.images_gallery.map((url, index) => (
                                        <div key={url + index} className="relative group aspect-square rounded-2xl border border-gray-150 overflow-hidden bg-gray-50 shadow-sm transition-all hover:shadow-md">
                                            <img src={url} alt={`Gallery image ${index + 1}`} className="w-full h-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newGallery = formData.images_gallery.filter((_, i) => i !== index);
                                                    setFormData((prev) => ({ ...prev, images_gallery: newGallery }));
                                                }}
                                                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-white rounded-2xl"
                                            >
                                                <Trash2 className="w-5 h-5 hover:scale-110 transition-all text-rose-400" />
                                            </button>
                                        </div>
                                    ))}

                                    {/* Uploader Card */}
                                    <div className="relative aspect-square bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center transition-all hover:border-blue-400 group cursor-pointer">
                                        <Camera className="w-6 h-6 text-gray-400 mb-1 group-hover:text-blue-500 group-hover:scale-105 transition-all" />
                                        <span className="text-[10px] font-bold text-gray-400 group-hover:text-blue-500">Add Image</span>
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            onChange={handleGalleryUpload}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                            disabled={uploadingGallery}
                                        />
                                        {uploadingGallery && (
                                            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                                                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-100 px-6 py-4 flex space-x-3 bg-white flex-shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 bg-white border border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 py-2.5 rounded-xl font-bold text-sm transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={loading || uploading || uploadingGallery}
                        type="submit"
                        className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:translate-y-0"
                    >
                        {loading ? (mode === 'edit' ? t.addProductModal.savingChanges : t.addProductModal.creatingProduct) : (mode === 'edit' ? t.common.saveChanges : t.addProductModal.confirmAdd)}
                    </button>
                </div>
            </form>
        </ModalShell>
    );
}

// Local Rich Text Editor Helper Component
function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    const editorRef = useRef<HTMLDivElement>(null);
    const initialRender = useRef(true);

    useEffect(() => {
        if (editorRef.current && initialRender.current) {
            editorRef.current.innerHTML = value || '';
            initialRender.current = false;
        }
    }, [value]);

    const handleInput = () => {
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const execCommand = (e: React.MouseEvent, command: string) => {
        e.preventDefault(); // Prevent text selection focus loss
        document.execCommand(command, false);
        handleInput();
    };

    return (
        <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
            <div className="flex items-center gap-1 bg-gray-50 border-b border-gray-100 p-2">
                <button
                    type="button"
                    onMouseDown={(e) => execCommand(e, 'bold')}
                    className="p-2 rounded-lg hover:bg-gray-200 text-gray-700 transition-colors"
                    title="Bold"
                >
                    <Bold className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onMouseDown={(e) => execCommand(e, 'italic')}
                    className="p-2 rounded-lg hover:bg-gray-200 text-gray-700 transition-colors"
                    title="Italic"
                >
                    <Italic className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-gray-300 mx-1.5" />
                <button
                    type="button"
                    onMouseDown={(e) => execCommand(e, 'insertUnorderedList')}
                    className="p-2 rounded-lg hover:bg-gray-200 text-gray-700 transition-colors"
                    title="Bullet List"
                >
                    <List className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onMouseDown={(e) => execCommand(e, 'insertOrderedList')}
                    className="p-2 rounded-lg hover:bg-gray-200 text-gray-700 transition-colors"
                    title="Numbered List"
                >
                    <ListOrdered className="w-4 h-4" />
                </button>
            </div>
            <div
                ref={editorRef}
                contentEditable
                onInput={handleInput}
                className="p-4 min-h-[160px] outline-none prose max-w-none text-sm text-gray-800"
                data-placeholder={placeholder}
                style={{ minHeight: '160px' }}
            />
        </div>
    );
}
