'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Package, Pencil, Plus, ShoppingBasket, Trash2, Truck, Upload } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import AddProductModal from '../AddProductModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import CreatePurchaseModal from '../../purchases/CreatePurchaseModal';
import ProductImage from '@/components/ProductImage';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, Input, Select } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useServerList } from '@/hooks/useServerList';

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
    description?: string | null;
    images_gallery?: string[] | null;
    created_at: string;
}

const columnHelper = createColumnHelper<Product>();

function pluralize(count: number, singular: string, plural: string) {
    return count === 1 ? singular : plural;
}

export default function InventoryPage() {
    const { t, locale } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
    const [subgroups, setSubgroups] = useState<Array<{ id: string; name: string; group_id: string }>>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [selectedSubgroupId, setSelectedSubgroupId] = useState('');
    const [showUncategorized, setShowUncategorized] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [stockStatus, setStockStatus] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    // Debounce typing so each keystroke doesn't fire a query
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const {
        items: products,
        loading,
        serverPagination,
        reload: loadProducts,
        setItems: setProducts,
    } = useServerList<Product>({
        tableId: 'products',
        fetch: (p) => api.getProductsPaged({
            groupId: showUncategorized ? undefined : selectedGroupId || undefined,
            subgroupId: showUncategorized ? undefined : selectedSubgroupId || undefined,
            uncategorized: showUncategorized,
            search: debouncedSearch || undefined,
            stockStatus: stockStatus || undefined,
            ...applyCreatedRangeQuery(createdRange),
            ...p,
        }),
        deps: [selectedGroupId, selectedSubgroupId, showUncategorized, debouncedSearch, stockStatus, createdRange],
        initialSort: { id: 'name', desc: false },
    });

    useEffect(() => {
        void loadCategoryOptions();
    }, []);

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
                            <div className="w-9 h-9 rounded-xl bg-gray-100 relative overflow-hidden flex items-center justify-center text-[10px] font-bold text-gray-500 uppercase">
                                {product.image_url ? (
                                    <ProductImage src={product.image_url} alt={product.name} fallbackClassName="w-full h-full flex items-center justify-center" />
                                ) : (
                                    product.name.slice(0, 2)
                                )}
                            </div>
                            <span className="text-sm font-bold text-gray-900">{product.name}</span>
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
                    <span className="text-sm font-bold text-blue-600">
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
                                ? 'bg-danger-light text-danger-text border-red-200'
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
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${classes}`}>
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
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.display({
                id: 'actions',
                header: t.inventory.columns.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end space-x-1">
                        <button
                            onClick={() => openEditProduct(info.row.original)}
                            className="p-1.5 rounded-lg text-primary hover:bg-primary-light transition-colors"
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
        [t, locale],
    );

    // Server-side equivalents of the old client-side filter presets. They must be sent to
    // the API rather than applied to the loaded rows — a client filter would only ever
    // narrow the current page, so "low stock" would miss every low-stock product on page 2.
    const stockStatusOptions = useMemo(
        () => [
            { value: 'IN', label: t.inventory.filterPresets.inStock },
            { value: 'LOW', label: t.inventory.filterPresets.lowStock },
            { value: 'OUT', label: t.inventory.filterPresets.outOfStock },
        ],
        [t],
    );

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup) => !selectedGroupId || subgroup.group_id === selectedGroupId),
        [subgroups, selectedGroupId],
    );

    return (
        <PageShell>
                <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleCsvFileChange}
                />

                <PageHeader
                    title={t.inventory.title}
                    subtitle={t.inventory.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventory.title,
                        'inventory',
                    )}
                    actions={(
                        <>
                    <div className="flex items-center gap-2 md:hidden">
                        <Button onClick={() => setIsModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
                            {t.inventory.addProduct}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => csvInputRef.current?.click()}
                            disabled={isImporting}
                            icon={<Upload className="w-4 h-4" />}
                        />
                    </div>

                    <div className="hidden md:flex flex-wrap items-center justify-end gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => csvInputRef.current?.click()}
                            disabled={isImporting}
                            icon={<Upload className="w-4 h-4" />}
                        >
                            {isImporting ? t.inventory.importing : t.inventory.importCsv}
                        </Button>
                        <Button onClick={() => setIsModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
                            {t.inventory.addProduct}
                        </Button>
                    </div>
                        </>
                    )}
                />

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
                            className="ml-4 text-current opacity-60 hover:opacity-100 font-bold text-base leading-none"
                            aria-label={t.common.dismiss}
                        >
                            ×
                        </button>
                    </div>
                )}

                <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.common.search}</label>
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t.inventory.dataTable.searchPlaceholder}
                        />
                    </div>
                    <div className="min-w-[180px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventory.columns.status}</label>
                        <Select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)}>
                            <option value="">{t.common.all}</option>
                            {stockStatusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventory.filters.groupFilter}</label>
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
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventory.filters.subgroupFilter}</label>
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
                    <div className="pb-0.5">
                        <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                    </div>
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
                    showSearch={false}
                    serverPagination={serverPagination}
                />
    </PageShell>
    );
}