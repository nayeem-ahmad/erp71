'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { formatBDT } from '@/lib/format';
import { PageShell } from '@/components/ui';

interface PriceListItem {
    id: string;
    product_id: string;
    selling_price: number | null;
    discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | null;
    discount_value: number | null;
    base_price: number;
    final_price: number;
    product: { id: string; name: string; sku: string | null };
}

const columnHelper = createColumnHelper<PriceListItem>();

export default function PriceListDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const listId = params?.id as string;

    const [listName, setListName] = useState('');
    const [items, setItems] = useState<PriceListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editMode, setEditMode] = useState<'price' | 'discount'>('price');
    const [editPrice, setEditPrice] = useState('');
    const [editDiscountType, setEditDiscountType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
    const [editDiscountValue, setEditDiscountValue] = useState('');
    const [saving, setSaving] = useState(false);

    const loadData = async () => {
        try {
            const [list, itemsResult] = await Promise.all([
                api.getPriceList(listId),
                api.getPriceListItems(listId, { limit: 500 }),
            ]);
            setListName(list.name);
            setItems(itemsResult?.items ?? itemsResult ?? []);
        } catch (error) {
            console.error('Failed to load price list', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (listId) loadData();
    }, [listId]);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await api.syncPriceListProducts(listId);
            alert(t.priceLists.syncComplete.replace('{count}', String(result.added ?? 0)));
            await loadData();
        } catch (err: any) {
            alert(err.message || 'Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    const startEdit = (item: PriceListItem) => {
        setEditingId(item.product_id);
        if (item.selling_price != null) {
            setEditMode('price');
            setEditPrice(String(item.selling_price));
            setEditDiscountValue('');
        } else if (item.discount_type) {
            setEditMode('discount');
            setEditDiscountType(item.discount_type);
            setEditDiscountValue(item.discount_value != null ? String(item.discount_value) : '');
            setEditPrice('');
        } else {
            setEditMode('price');
            setEditPrice('');
            setEditDiscountValue('');
        }
    };

    const saveEdit = async (productId: string) => {
        setSaving(true);
        try {
            const payload: any = {};
            if (editMode === 'price') {
                payload.selling_price = editPrice ? parseFloat(editPrice) : null;
                payload.discount_type = null;
                payload.discount_value = null;
            } else {
                payload.selling_price = null;
                payload.discount_type = editDiscountType;
                payload.discount_value = editDiscountValue ? parseFloat(editDiscountValue) : null;
            }
            await api.updatePriceListItem(listId, productId, payload);
            setEditingId(null);
            await loadData();
        } catch (err: any) {
            alert(err.message || t.priceLists.itemSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    const clearOverride = async (productId: string) => {
        setSaving(true);
        try {
            await api.updatePriceListItem(listId, productId, {
                selling_price: null,
                discount_type: null,
                discount_value: null,
            });
            setEditingId(null);
            await loadData();
        } catch (err: any) {
            alert(err.message || t.priceLists.itemSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    const columns: ColumnDef<PriceListItem, any>[] = useMemo(
        () => [
            columnHelper.accessor(row => row.product.name, {
                id: 'product',
                header: t.common.name,
                cell: (info) => {
                    const item = info.row.original;
                    return (
                        <div>
                            <span className="block text-sm font-bold text-gray-900">{item.product.name}</span>
                            {item.product.sku && <span className="block text-xs text-gray-400">{item.product.sku}</span>}
                        </div>
                    );
                },
            }),
            columnHelper.accessor('base_price', {
                header: t.priceLists.basePrice,
                cell: (info) => <span className="text-sm font-bold text-gray-500">{formatBDT(info.getValue())}</span>,
            }),
            columnHelper.display({
                id: 'override',
                header: t.priceLists.overallDiscount,
                cell: (info) => {
                    const item = info.row.original;
                    if (editingId === item.product_id) {
                        return (
                            <div className="flex flex-col gap-2 min-w-[220px]">
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setEditMode('price')} className={`text-xs font-bold px-2 py-1 rounded ${editMode === 'price' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{t.priceLists.setPrice}</button>
                                    <button type="button" onClick={() => setEditMode('discount')} className={`text-xs font-bold px-2 py-1 rounded ${editMode === 'discount' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{t.priceLists.applyDiscount}</button>
                                </div>
                                {editMode === 'price' ? (
                                    <input type="number" min="0" step="0.01" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-lg py-1.5 px-3 text-sm font-bold" placeholder="৳" />
                                ) : (
                                    <div className="flex gap-2">
                                        <select value={editDiscountType} onChange={e => setEditDiscountType(e.target.value as any)} className="bg-gray-50 border border-gray-100 rounded-lg py-1.5 px-2 text-xs font-bold">
                                            <option value="PERCENTAGE">%</option>
                                            <option value="FIXED_AMOUNT">৳</option>
                                        </select>
                                        <input type="number" min="0" step="0.01" value={editDiscountValue} onChange={e => setEditDiscountValue(e.target.value)} className="flex-1 bg-gray-50 border border-gray-100 rounded-lg py-1.5 px-3 text-sm font-bold" />
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button disabled={saving} onClick={() => saveEdit(item.product_id)} className="text-xs font-bold text-blue-600">{t.common.save}</button>
                                    <button disabled={saving} onClick={() => clearOverride(item.product_id)} className="text-xs font-bold text-gray-400">{t.priceLists.clearOverride}</button>
                                    <button onClick={() => setEditingId(null)} className="text-xs font-bold text-gray-400">{t.common.cancel}</button>
                                </div>
                            </div>
                        );
                    }

                    if (item.selling_price != null) {
                        return <span className="text-sm font-bold text-gray-700">{formatBDT(item.selling_price)}</span>;
                    }
                    if (item.discount_type && item.discount_value != null) {
                        const label = item.discount_type === 'PERCENTAGE'
                            ? `${item.discount_value}%`
                            : formatBDT(item.discount_value);
                        return <span className="text-sm font-bold text-amber-700">−{label}</span>;
                    }
                    return <span className="text-sm text-gray-300">—</span>;
                },
            }),
            columnHelper.accessor('final_price', {
                header: t.priceLists.finalPrice,
                cell: (info) => <span className="text-sm font-bold text-gray-900">{formatBDT(info.getValue())}</span>,
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: (info) => (
                    <button onClick={() => startEdit(info.row.original)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                        {t.common.edit}
                    </button>
                ),
            }),
        ],
        [t, editingId, editMode, editPrice, editDiscountType, editDiscountValue, saving],
    );

    return (
        <PageShell>
                <PageHeader
                    title={listName || t.priceLists.detailTitle}
                    subtitle={t.priceLists.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        'sales',
                        [{ label: t.priceLists.title, href: routes.sales.priceLists }],
                        listName || t.priceLists.detailTitle,
                    )}
                    actions={
                        <button onClick={handleSync} disabled={syncing} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2">
                            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                            {syncing ? t.priceLists.syncing : t.priceLists.syncProducts}
                        </button>
                    }
                />

                <DataTable<PriceListItem>
                    tableId={`price-list-${listId}`}
                    columns={columns}
                    data={items}
                    title={t.priceLists.title}
                    isLoading={loading}
                    emptyMessage={t.priceLists.emptyMessage}
                    searchPlaceholder={t.priceLists.searchPlaceholder}
                />
            
        </PageShell>
    );
}