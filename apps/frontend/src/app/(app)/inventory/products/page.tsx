'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, ClipboardCheck, MoreHorizontal, Package, Pencil, Plus, Settings2, ShoppingBasket, Tag, Trash2, Truck, TrendingUp, Upload } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import AddProductModal from '../AddProductModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreatePurchaseModal from '../../purchases/CreatePurchaseModal';
import ProductImage from '@/components/ProductImage';

interface Product {
    id: string;
    name: string;
    sku?: string | null;
    price: string | number;
    is_featured?: boolean;
    image_url?: string | null;
    warranty_enabled?: boolean;
    warranty_duration_days?: number | null;
    reorder_level?: number | null;
    safety_stock?: number | null;
    lead_time_days?: number | null;
    group?: { id: string; name: string } | null;
    subgroup?: { id: string; name: string } | null;
    stocks?: { quantity: number | string }[];
}

const columnHelper = createColumnHelper<Product>();

function pluralize(count: number, singular: string, plural: string) {
    return count === 1 ? singular : plural;
}

export default function InventoryPage() {
    const { t } = useI18n();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const mobileActionsRef = useRef<HTMLDivElement>(null);
    const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
    const [subgroups, setSubgroups] = useState<Array<{ id: string; name: string; group_id: string }>>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [selectedSubgroupId, setSelectedSubgroupId] = useState('');
    const [showUncategorized, setShowUncategorized] = useState(false);
    const [hasAdvancedInventoryReports, setHasAdvancedInventoryReports] = useState(false);

    useEffect(() => {
        void Promise.all([loadProducts(), loadCategoryOptions()]);
    }, []);

    useEffect(() => {
        void loadProducts();
    }, [selectedGroupId, selectedSubgroupId, showUncategorized]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const planCode = localStorage.getItem('subscription_plan_code');
            setHasAdvancedInventoryReports(planCode === 'STANDARD' || planCode === 'PREMIUM');
        }
    }, []);

    useEffect(() => {
        if (!mobileActionsOpen) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMobileActionsOpen(false);
        };
        const onPointer = (event: MouseEvent) => {
            if (mobileActionsRef.current && !mobileActionsRef.current.contains(event.target as Node)) {
                setMobileActionsOpen(false);
            }
        };

        window.addEventListener('keydown', onKey);
        const id = window.setTimeout(() => document.addEventListener('mousedown', onPointer), 0);

        return () => {
            window.removeEventListener('keydown', onKey);
            window.clearTimeout(id);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [mobileActionsOpen]);

    const loadProducts = async () => {
        try {
            const data = await api.getProducts({
                groupId: showUncategorized ? undefined : selectedGroupId || undefined,
                subgroupId: showUncategorized ? undefined : selectedSubgroupId || undefined,
                uncategorized: showUncategorized,
            });
            setProducts(data);
        } catch (error) {
            console.error('Failed to load products', error);
        } finally {
            setLoading(false);
        }
    };

    const loadCategoryOptions = async () => {
        try {
            const [groupData, subgroupData] = await Promise.all([api.getProductGroups(), api.getProductSubgroups()]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load category options', error);
        }
    };

    const handleAddProduct = async (productData: any) => {
        try {
            await api.createProduct(productData);
            await loadProducts();
        } catch (error) {
            console.error('Error adding product', error);
            throw error;
        }
    };

    const handleUpdateProduct = async (productData: any) => {
        if (!editingProduct) return;

        try {
            await api.updateProduct(editingProduct.id, productData);
            await loadProducts();
            setEditingProduct(null);
        } catch (error) {
            console.error('Error updating product', error);
            throw error;
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t.inventory.deleteConfirm)) return;

        try {
            await api.deleteProduct(id);
            setProducts((prev) => prev.filter((product) => product.id !== id));
        } catch (error: any) {
            alert(error.message || t.inventory.deleteFailed);
        }
    };

    const openAddStock = (product: Product) => {
        setSelectedProduct(product);
        setIsPurchaseModalOpen(true);
    };

    const openEditProduct = (product: Product) => {
        setEditingProduct(product);
        setIsEditModalOpen(true);
    };

    const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset the input so the same file can be re-selected if needed
        e.target.value = '';

        setIsImporting(true);
        setImportStatus(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const result = await fetchWithAuth('/products/import', {
                method: 'POST',
                body: formData,
            });

            const productWord = pluralize(
                result.created,
                t.inventory.importProductSingular,
                t.inventory.importProductPlural,
            );
            const imported = t.inventory.importSummaryImported
                .replace('{count}', String(result.created))
                .replace('{unit}', productWord);
            const skipped = t.inventory.importSummarySkipped.replace('{count}', String(result.skipped));
            let errorPart = '';
            if (result.errors?.length) {
                const errorWord = pluralize(
                    result.errors.length,
                    t.inventory.importErrorSingular,
                    t.inventory.importErrorPlural,
                );
                errorPart = ` ${t.inventory.importSummaryErrors
                    .replace('{count}', String(result.errors.length))
                    .replace('{unit}', errorWord)}`;
            }
            setImportStatus(`${imported}, ${skipped}${errorPart}.`);
            await loadProducts();
        } catch (error: any) {
            setImportStatus(`${t.inventory.importFailed}${error?.message ?? t.common.error}`);
        } finally {
            setIsImporting(false);
        }
    };

    const columns: ColumnDef<Product, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.inventory.columns.product,
                cell: (info) => {
                    const product = info.row.original;
                    return (
                        <div className="flex items-center space-x-3">
                            <div className="w-9 h-9 rounded-xl bg-gray-100 relative overflow-hidden flex items-center justify-center text-[10px] font-black text-gray-500 uppercase">
                                {product.image_url ? (
                                    <ProductImage src={product.image_url} alt={product.name} fallbackClassName="w-full h-full flex items-center justify-center" />
                                ) : (
                                    product.name.slice(0, 2)
                                )}
                            </div>
                            <span className="text-sm font-black text-gray-900">{product.name}</span>
                        </div>
                    );
                },
                size: 240,
            }),
            columnHelper.accessor('sku', {
                header: t.inventory.columns.sku,
                cell: (info) => (
                    <span className="text-sm font-mono text-gray-500">{info.getValue() || '-'}</span>
                ),
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('price', {
                header: t.inventory.columns.price,
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">
                        {formatBDT(Number(info.getValue() || 0))}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.getValue('price') || 0) - Number(b.getValue('price') || 0),
                size: 120,
            }),
            columnHelper.accessor(
                (row) =>
                    row.warranty_enabled
                        ? `${row.warranty_duration_days ?? 0} ${t.inventory.status.daysSuffix}`
                        : t.inventory.status.disabled,
                {
                id: 'warranty',
                header: t.inventory.columns.warranty,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => Number(row.stocks?.[0]?.quantity || 0), {
                id: 'stock',
                header: t.inventory.columns.currentStock,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>
                ),
                sortingFn: (a, b) => Number(a.getValue('stock')) - Number(b.getValue('stock')),
                size: 120,
            }),
            columnHelper.accessor(
                (row) => Number(row.price || 0) * Number(row.stocks?.[0]?.quantity || 0),
                {
                    id: 'stock_value',
                    header: t.inventory.columns.stockValue,
                    cell: (info) => (
                        <span className="text-sm font-bold text-gray-700">
                            {formatBDT(Number(info.getValue() || 0))}
                        </span>
                    ),
                    sortingFn: (a, b) => Number(a.getValue('stock_value')) - Number(b.getValue('stock_value')),
                    size: 130,
                    meta: { hideOnMobile: true },
                },
            ),
            columnHelper.accessor(
                (row) => {
                    const quantity = Number(row.stocks?.[0]?.quantity || 0);
                    if (quantity === 0) return 'OUT';
                    if (quantity <= 10) return 'LOW';
                    return 'IN';
                },
                {
                    id: 'status',
                    header: t.inventory.columns.status,
                    cell: (info) => {
                        const status = info.getValue();
                        const classes =
                            status === 'OUT'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : status === 'LOW'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        const label =
                            status === 'OUT'
                                ? t.inventory.status.outOfStock
                                : status === 'LOW'
                                  ? t.inventory.status.lowStock
                                  : t.inventory.status.inStock;

                        return (
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${classes}`}>
                                {label}
                            </span>
                        );
                    },
                    size: 130,
                },
            ),
            columnHelper.accessor((row) => row.group?.name || t.inventory.status.uncategorized, {
                id: 'group',
                header: t.inventory.columns.group,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.subgroup?.name || '-', {
                id: 'subgroup',
                header: t.inventory.columns.subgroup,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue()}</span>,
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.inventory.columns.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end space-x-1">
                        <button
                            onClick={() => openEditProduct(info.row.original)}
                            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title={t.inventory.actions.editProduct}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => openAddStock(info.row.original)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title={t.inventory.actions.addStock}
                        >
                            <ShoppingBasket className="w-4 h-4" />
                        </button>
                        <Link
                            href={`/inventory/transfers?productId=${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.inventory.actions.transferHistory}
                        >
                            <Truck className="w-4 h-4" />
                        </Link>
                        <button
                            onClick={() => handleDelete(info.row.original.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                            title={t.inventory.actions.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.inventory.filterPresets.inStock, filters: [{ id: 'status', value: 'IN' }] },
            { label: t.inventory.filterPresets.lowStock, filters: [{ id: 'status', value: 'LOW' }] },
            { label: t.inventory.filterPresets.outOfStock, filters: [{ id: 'status', value: 'OUT' }] },
        ],
        [t],
    );

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup) => !selectedGroupId || subgroup.group_id === selectedGroupId),
        [subgroups, selectedGroupId],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-4 md:p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{t.inventory.title}</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.inventory.subtitle}
                        </p>
                    </div>

                    <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleCsvFileChange}
                    />

                    <div className="flex items-center gap-2 md:hidden">
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.inventory.addProduct}
                        </button>
                        <button
                            onClick={() => csvInputRef.current?.click()}
                            disabled={isImporting}
                            className="bg-white border border-gray-200 text-gray-700 px-3 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Upload className="w-4 h-4" />
                        </button>
                        <div ref={mobileActionsRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setMobileActionsOpen((open) => !open)}
                                className="min-h-11 min-w-11 flex items-center justify-center bg-white border border-gray-200 text-gray-700 rounded-xl transition-all hover:border-blue-300 hover:text-blue-700"
                                aria-label={t.common.actions}
                                aria-expanded={mobileActionsOpen}
                            >
                                <MoreHorizontal className="w-5 h-5" />
                            </button>
                            {mobileActionsOpen ? (
                                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-gray-200 bg-white py-2 shadow-xl">
                                    <Link href="/inventory/ledger" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <BookOpen className="w-4 h-4" />
                                        {t.inventory.stockLedger}
                                    </Link>
                                    <Link href="/inventory/settings" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Settings2 className="w-4 h-4" />
                                        {t.inventory.settings}
                                    </Link>
                                    <Link href="/inventory/categories" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Tag className="w-4 h-4" />
                                        {t.inventory.manageCategories}
                                    </Link>
                                    <Link href="/inventory/transfers" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Truck className="w-4 h-4" />
                                        {t.inventory.transfers}
                                    </Link>
                                    <Link href="/inventory/shrinkage" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <AlertTriangle className="w-4 h-4" />
                                        {t.inventory.shrinkage}
                                    </Link>
                                    <Link href="/inventory/stock-takes" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <ClipboardCheck className="w-4 h-4" />
                                        {t.inventory.stockTakes}
                                    </Link>
                                    {hasAdvancedInventoryReports ? (
                                        <>
                                            <Link href="/inventory/reports/reorder" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                                <TrendingUp className="w-4 h-4" />
                                                {t.inventory.reorderReport}
                                            </Link>
                                            <Link href="/inventory/reports/shrinkage" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                                <AlertTriangle className="w-4 h-4" />
                                                {t.inventory.shrinkageReport}
                                            </Link>
                                        </>
                                    ) : (
                                        <Link href="/billing" onClick={() => setMobileActionsOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50">
                                            <TrendingUp className="w-4 h-4" />
                                            {t.inventory.upgradeReports}
                                        </Link>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="hidden md:flex flex-wrap items-center justify-end gap-3">
                        <Link
                            href="/inventory/ledger"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <BookOpen className="w-4 h-4 mr-2" />
                            {t.inventory.stockLedger}
                        </Link>
                        <Link
                            href="/inventory/settings"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Settings2 className="w-4 h-4 mr-2" />
                            {t.inventory.settings}
                        </Link>
                        <Link
                            href="/inventory/categories"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Tag className="w-4 h-4 mr-2" />
                            {t.inventory.manageCategories}
                        </Link>
                        <Link
                            href="/inventory/transfers"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Truck className="w-4 h-4 mr-2" />
                            {t.inventory.transfers}
                        </Link>
                        <Link
                            href="/inventory/shrinkage"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <AlertTriangle className="w-4 h-4 mr-2" />
                            {t.inventory.shrinkage}
                        </Link>
                        <Link
                            href="/inventory/stock-takes"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <ClipboardCheck className="w-4 h-4 mr-2" />
                            {t.inventory.stockTakes}
                        </Link>
                        {hasAdvancedInventoryReports ? (
                            <>
                                <Link
                                    href="/inventory/reports/reorder"
                                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                                >
                                    <TrendingUp className="w-4 h-4 mr-2" />
                                    {t.inventory.reorderReport}
                                </Link>
                                <Link
                                    href="/inventory/reports/shrinkage"
                                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                                >
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    {t.inventory.shrinkageReport}
                                </Link>
                            </>
                        ) : (
                            <Link
                                href="/billing"
                                className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-amber-300 hover:bg-amber-100"
                            >
                                <TrendingUp className="w-4 h-4 mr-2" />
                                {t.inventory.upgradeReports}
                            </Link>
                        )}
                        <button
                            onClick={() => csvInputRef.current?.click()}
                            disabled={isImporting}
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            {isImporting ? t.inventory.importing : t.inventory.importCsv}
                        </button>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.inventory.addProduct}
                        </button>
                    </div>
                </div>

                {importStatus && (
                    <div
                        className={`px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-between ${
                            importStatus.startsWith(t.inventory.importFailed)
                                ? 'bg-red-50 border border-red-200 text-red-700'
                                : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        }`}
                    >
                        <span>{importStatus}</span>
                        <button
                            onClick={() => setImportStatus(null)}
                            className="ml-4 text-current opacity-60 hover:opacity-100 font-black text-base leading-none"
                            aria-label={t.common.dismiss}
                        >
                            ×
                        </button>
                    </div>
                )}

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">{t.inventory.filters.groupFilter}</label>
                        <select
                            value={selectedGroupId}
                            onChange={(e) => {
                                setSelectedGroupId(e.target.value);
                                setSelectedSubgroupId('');
                                setShowUncategorized(false);
                            }}
                            className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        >
                            <option value="">{t.inventory.filters.allGroups}</option>
                            {groups.map((group) => (
                                <option key={group.id} value={group.id}>
                                    {group.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">{t.inventory.filters.subgroupFilter}</label>
                        <select
                            value={selectedSubgroupId}
                            onChange={(e) => {
                                setSelectedSubgroupId(e.target.value);
                                setShowUncategorized(false);
                            }}
                            className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        >
                            <option value="">{t.inventory.filters.allSubgroups}</option>
                            {filteredSubgroups.map((subgroup) => (
                                <option key={subgroup.id} value={subgroup.id}>
                                    {subgroup.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 px-2 pb-2">
                        <input
                            type="checkbox"
                            checked={showUncategorized}
                            onChange={(e) => {
                                setShowUncategorized(e.target.checked);
                                if (e.target.checked) {
                                    setSelectedGroupId('');
                                    setSelectedSubgroupId('');
                                }
                            }}
                            className="rounded border-gray-300"
                        />
                        {t.inventory.filters.showUncategorized}
                    </label>
                </div>

                <AddProductModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    mode="create"
                    onSubmit={handleAddProduct}
                />

                <AddProductModal
                    isOpen={isEditModalOpen}
                    onClose={() => {
                        setIsEditModalOpen(false);
                        setEditingProduct(null);
                    }}
                    mode="edit"
                    initialProduct={editingProduct}
                    onSubmit={handleUpdateProduct}
                />

                <CreatePurchaseModal
                    isOpen={isPurchaseModalOpen}
                    onClose={() => {
                        setIsPurchaseModalOpen(false);
                        setSelectedProduct(null);
                    }}
                    onSuccess={loadProducts}
                    initialProduct={
                        selectedProduct
                            ? {
                                  id: selectedProduct.id,
                                  name: selectedProduct.name,
                                  sku: selectedProduct.sku || '',
                                  price: Number(selectedProduct.price || 0),
                              }
                            : undefined
                    }
                />

                <DataTable<Product>
                    tableId="products"
                    columns={columns}
                    data={products}
                    title={t.inventory.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.inventory.dataTable.emptyMessage}
                    emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventory.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
