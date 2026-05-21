'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, ClipboardCheck, Package, Pencil, Plus, Settings2, ShoppingBasket, Tag, Trash2, Truck, TrendingUp } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT } from '../../../lib/format';
import AddProductModal from './AddProductModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreatePurchaseModal from '../purchases/CreatePurchaseModal';

interface Product {
    id: string;
    name: string;
    sku?: string | null;
    price: string | number;
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

export default function InventoryPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
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
        if (!window.confirm('Are you sure you want to delete this product?')) return;

        try {
            await api.deleteProduct(id);
            setProducts((prev) => prev.filter((product) => product.id !== id));
        } catch (error: any) {
            alert(error.message || 'Failed to delete product');
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

    const columns: ColumnDef<Product, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: 'Product',
                cell: (info) => {
                    const product = info.row.original;
                    return (
                        <div className="flex items-center space-x-3">
                            <div className="w-9 h-9 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center text-[10px] font-black text-gray-500 uppercase">
                                {product.image_url ? (
                                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
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
                header: 'SKU',
                cell: (info) => (
                    <span className="text-sm font-mono text-gray-500">{info.getValue() || '-'}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('price', {
                header: 'Price',
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">
                        {formatBDT(Number(info.getValue() || 0))}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.getValue('price') || 0) - Number(b.getValue('price') || 0),
                size: 120,
            }),
            columnHelper.accessor((row) => (row.warranty_enabled ? `${row.warranty_duration_days ?? 0} days` : 'Disabled'), {
                id: 'warranty',
                header: 'Warranty',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 120,
            }),
            columnHelper.accessor((row) => Number(row.stocks?.[0]?.quantity || 0), {
                id: 'stock',
                header: 'Current Stock',
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
                    header: 'Stock Value',
                    cell: (info) => (
                        <span className="text-sm font-bold text-gray-700">
                            {formatBDT(Number(info.getValue() || 0))}
                        </span>
                    ),
                    sortingFn: (a, b) => Number(a.getValue('stock_value')) - Number(b.getValue('stock_value')),
                    size: 130,
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
                    header: 'Status',
                    cell: (info) => {
                        const status = info.getValue();
                        const classes =
                            status === 'OUT'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : status === 'LOW'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        const label = status === 'OUT' ? 'Out of Stock' : status === 'LOW' ? 'Low Stock' : 'In Stock';

                        return (
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${classes}`}>
                                {label}
                            </span>
                        );
                    },
                    size: 130,
                },
            ),
            columnHelper.accessor((row) => row.group?.name || 'Uncategorized', {
                id: 'group',
                header: 'Group',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 140,
            }),
            columnHelper.accessor((row) => row.subgroup?.name || '-', {
                id: 'subgroup',
                header: 'Subgroup',
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => (
                    <div className="flex items-center justify-end space-x-1">
                        <button
                            onClick={() => openEditProduct(info.row.original)}
                            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Edit product"
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => openAddStock(info.row.original)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Add Stock"
                        >
                            <ShoppingBasket className="w-4 h-4" />
                        </button>
                        <Link
                            href={`/dashboard/inventory/transfers?productId=${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title="View transfer history"
                        >
                            <Truck className="w-4 h-4" />
                        </Link>
                        <button
                            onClick={() => handleDelete(info.row.original.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
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
        [],
    );

    const filterPresets = useMemo(
        () => [
            { label: 'In Stock', filters: [{ id: 'status', value: 'IN' }] },
            { label: 'Low Stock', filters: [{ id: 'status', value: 'LOW' }] },
            { label: 'Out of Stock', filters: [{ id: 'status', value: 'OUT' }] },
        ],
        [],
    );

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup) => !selectedGroupId || subgroup.group_id === selectedGroupId),
        [subgroups, selectedGroupId],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Products</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Manage catalog pricing and stock positions
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/dashboard/inventory/ledger"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <BookOpen className="w-4 h-4 mr-2" />
                            Stock Ledger
                        </Link>
                        <Link
                            href="/dashboard/inventory/settings"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Settings2 className="w-4 h-4 mr-2" />
                            Settings
                        </Link>
                        <Link
                            href="/dashboard/inventory/categories"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Tag className="w-4 h-4 mr-2" />
                            Manage Categories
                        </Link>
                        <Link
                            href="/dashboard/inventory/transfers"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <Truck className="w-4 h-4 mr-2" />
                            Transfers
                        </Link>
                        <Link
                            href="/dashboard/inventory/shrinkage"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <AlertTriangle className="w-4 h-4 mr-2" />
                            Shrinkage
                        </Link>
                        <Link
                            href="/dashboard/inventory/stock-takes"
                            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                        >
                            <ClipboardCheck className="w-4 h-4 mr-2" />
                            Stock Takes
                        </Link>
                        {hasAdvancedInventoryReports ? (
                            <>
                                <Link
                                    href="/dashboard/inventory/reports/reorder"
                                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                                >
                                    <TrendingUp className="w-4 h-4 mr-2" />
                                    Reorder Report
                                </Link>
                                <Link
                                    href="/dashboard/inventory/reports/shrinkage"
                                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                                >
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    Shrinkage Report
                                </Link>
                            </>
                        ) : (
                            <Link
                                href="/dashboard/billing"
                                className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:border-amber-300 hover:bg-amber-100"
                            >
                                <TrendingUp className="w-4 h-4 mr-2" />
                                Upgrade for Advanced Reports
                            </Link>
                        )}
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Product
                        </button>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Group Filter</label>
                        <select
                            value={selectedGroupId}
                            onChange={(e) => {
                                setSelectedGroupId(e.target.value);
                                setSelectedSubgroupId('');
                                setShowUncategorized(false);
                            }}
                            className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        >
                            <option value="">All Groups</option>
                            {groups.map((group) => (
                                <option key={group.id} value={group.id}>
                                    {group.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-[220px] flex-1">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Subgroup Filter</label>
                        <select
                            value={selectedSubgroupId}
                            onChange={(e) => {
                                setSelectedSubgroupId(e.target.value);
                                setShowUncategorized(false);
                            }}
                            className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        >
                            <option value="">All Subgroups</option>
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
                        Show only uncategorized
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
                    title="Products"
                    isLoading={loading}
                    emptyMessage="No products found"
                    emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by product, SKU, stock status..."
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
