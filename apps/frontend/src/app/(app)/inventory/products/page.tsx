'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import { Package, Plus, Upload } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { isOwner, hasPermission } from '@/lib/permissions';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import AddProductModal from '../AddProductModal';
import MergeProductModal from '../MergeProductModal';
import ProductRowActions from './ProductRowActions';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import ProductImage from '@/components/ProductImage';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, ConfirmDialog, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useServerList } from '@/hooks/useServerList';
import { toast } from '@/lib/toast';

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

type StockStatus = 'IN' | 'LOW' | 'OUT';

const stockTones: Record<StockStatus, StatusBadgeTone> = {
    IN: 'success',
    LOW: 'warning',
    OUT: 'danger',
};

export default function InventoryPage() {
    const { t, locale, fmt } = useI18n();
    const { role, permissions } = useTenantPlanFeatures();
    const canMerge = isOwner(role) || hasPermission(permissions, 'MANAGE_USERS');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
    const [deleting, setDeleting] = useState(false);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [mergeSource, setMergeSource] = useState<{ id: string; name: string } | null>(null);
    const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
    const [subgroups, setSubgroups] = useState<Array<{ id: string; name: string; group_id: string }>>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [selectedSubgroupId, setSelectedSubgroupId] = useState('');
    const [showUncategorized, setShowUncategorized] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [stockStatus, setStockStatus] = useState<string | null>(null);
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
        columnFilters: true,
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

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteProduct(pendingDelete.id);
            setProducts((prev) => prev.filter((product) => product.id !== pendingDelete.id));
            setPendingDelete(null);
            toast.success(t.common.deleted);
        } catch (error: any) {
            toast.error(error?.message || t.inventory.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const openEditProduct = (product: Product) => {
        setEditingProduct(product);
        setIsEditModalOpen(true);
    };

    const openMergeProduct = (product: { id: string; name: string }) => {
        setMergeSource({ id: product.id, name: product.name });
    };

    const handleMerged = (result: { targetId: string; targetName: string }) => {
        const keeperName =
            result.targetName || products.find((product) => product.id === result.targetId)?.name || '';
        toast.success(fmt(t.inventory.merge.success, { name: keeperName }));
        setMergeSource(null);
        void loadProducts();
    };

    const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset the input so the same file can be re-selected if needed
        e.target.value = '';

        setIsImporting(true);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const result = await fetchWithAuth('/products/import', {
                method: 'POST',
                body: formData,
            });

            const imported = fmt(t.inventory.importSummaryImported, { count: result.created });
            const skipped = fmt(t.inventory.importSummarySkipped, { count: result.skipped });
            const errorPart = result.errors?.length
                ? ` ${fmt(t.inventory.importSummaryErrors, { count: result.errors.length })}`
                : '';
            const summary = `${imported}, ${skipped}${errorPart}.`;
            if (result.errors?.length) toast.info(summary);
            else toast.success(summary);
            await loadProducts();
        } catch (error: any) {
            toast.error(`${t.inventory.importFailed}${error?.message ?? t.common.error}`);
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
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 shrink-0 rounded-md bg-gray-100 relative overflow-hidden flex items-center justify-center text-[10px] font-semibold text-gray-500 uppercase">
                                {product.image_url ? (
                                    <ProductImage src={product.image_url} alt={product.name} fallbackClassName="w-full h-full flex items-center justify-center" />
                                ) : (
                                    product.name.slice(0, 2)
                                )}
                            </div>
                            <span className="truncate">{product.name}</span>
                        </div>
                    );
                },
                size: 240,
            }),
            columnHelper.accessor('sku', {
                header: t.inventory.columns.sku,
                cell: (info) => info.getValue() || '-',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('price', {
                header: t.inventory.columns.price,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                sortingFn: (a, b) => Number(a.getValue('price') || 0) - Number(b.getValue('price') || 0),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor(
                (row) =>
                    row.warranty_enabled
                        ? `${row.warranty_duration_days ?? 0} ${t.inventory.status.daysSuffix}`
                        : t.inventory.status.disabled,
                {
                id: 'warranty',
                header: t.inventory.columns.warranty,
                // A label built from two fields, not one the server could match.
                enableColumnFilter: false,
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => Number(row.stocks?.[0]?.quantity || 0), {
                id: 'stock',
                header: t.inventory.columns.currentStock,
                // Stock, its value and its status are worked out per row; the
                // stock-status filter in the toolbar is the filter for them.
                enableColumnFilter: false,
                sortingFn: (a, b) => Number(a.getValue('stock')) - Number(b.getValue('stock')),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor(
                (row) => Number(row.price || 0) * Number(row.stocks?.[0]?.quantity || 0),
                {
                    id: 'stock_value',
                    header: t.inventory.columns.stockValue,
                    enableColumnFilter: false,
                    cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                    sortingFn: (a, b) => Number(a.getValue('stock_value')) - Number(b.getValue('stock_value')),
                    size: 130,
                    meta: { hideOnMobile: true, align: 'end' },
                },
            ),
            columnHelper.accessor(
                (row): StockStatus => {
                    const quantity = Number(row.stocks?.[0]?.quantity || 0);
                    if (quantity === 0) return 'OUT';
                    if (quantity <= 10) return 'LOW';
                    return 'IN';
                },
                {
                    id: 'status',
                    header: t.inventory.columns.status,
                    enableColumnFilter: false,
                    cell: (info) => {
                        const status = info.getValue();
                        const label =
                            status === 'OUT'
                                ? t.inventory.status.outOfStock
                                : status === 'LOW'
                                  ? t.inventory.status.lowStock
                                  : t.inventory.status.inStock;
                        return <StatusBadge tone={stockTones[status]}>{label}</StatusBadge>;
                    },
                    size: 130,
                },
            ),
            columnHelper.accessor((row) => row.group?.name || t.inventory.status.uncategorized, {
                id: 'group',
                header: t.inventory.columns.group,
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.subgroup?.name || '-', {
                id: 'subgroup',
                header: t.inventory.columns.subgroup,
                size: 150,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.display({
                id: 'actions',
                header: t.inventory.columns.actions,
                cell: (info) => (
                    <ProductRowActions
                        product={info.row.original}
                        canMerge={canMerge}
                        onEdit={() => openEditProduct(info.row.original)}
                        onMerge={() => openMergeProduct(info.row.original)}
                        onDelete={() => setPendingDelete(info.row.original)}
                    />
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 170,
            }),
        ],
        [t, locale, canMerge],
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

    // Page-owned: each goes to the server with the page query. "Uncategorized"
    // and a group exclude each other, so each choice releases the other.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'stockStatus',
                type: 'select',
                label: t.inventory.columns.status,
                value: stockStatus,
                onChange: setStockStatus,
                options: stockStatusOptions,
            },
            {
                id: 'group',
                type: 'select',
                label: t.inventory.columns.group,
                value: selectedGroupId || null,
                onChange: (next) => {
                    setSelectedGroupId(next ?? '');
                    setSelectedSubgroupId('');
                    if (next) setShowUncategorized(false);
                },
                options: groups.map((group) => ({ value: group.id, label: group.name })),
            },
            {
                id: 'subgroup',
                type: 'select',
                label: t.inventory.columns.subgroup,
                value: selectedSubgroupId || null,
                onChange: (next) => {
                    setSelectedSubgroupId(next ?? '');
                    if (next) setShowUncategorized(false);
                },
                options: filteredSubgroups.map((subgroup) => ({ value: subgroup.id, label: subgroup.name })),
            },
            {
                id: 'uncategorized',
                type: 'toggle',
                control: 'checkbox',
                label: t.inventory.filters.showUncategorized,
                pressed: showUncategorized,
                onChange: (next) => {
                    setShowUncategorized(next);
                    if (next) {
                        setSelectedGroupId('');
                        setSelectedSubgroupId('');
                    }
                },
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange },
        ],
        [t, stockStatus, stockStatusOptions, selectedGroupId, groups, selectedSubgroupId, filteredSubgroups, showUncategorized, createdRange],
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
                    showMerge={canMerge}
                    onMergeClick={() => {
                        if (!editingProduct) return;
                        setIsEditModalOpen(false);
                        openMergeProduct(editingProduct);
                    }}
                />

                {mergeSource && (
                    <MergeProductModal
                        isOpen
                        source={mergeSource}
                        onClose={() => setMergeSource(null)}
                        onMerged={handleMerged}
                    />
                )}

                <DataTable<Product>
                    tableId="products"
                    columns={columns}
                    data={products}
                    title={t.inventory.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.inventory.dataTable.emptyMessage}
                    emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventory.dataTable.searchPlaceholder}
                    onSearchChange={setSearch}
                    filters={filters}
                    viewOptions
                    serverPagination={serverPagination}
                />

                <ConfirmDialog
                    open={pendingDelete !== null}
                    title={t.common.delete}
                    prompt={t.inventory.deleteConfirm}
                    confirmLabel={t.common.delete}
                    cancelLabel={t.common.cancel}
                    loading={deleting}
                    danger
                    onConfirm={() => void confirmDelete()}
                    onCancel={() => { if (!deleting) setPendingDelete(null); }}
                />
    </PageShell>
    );
}