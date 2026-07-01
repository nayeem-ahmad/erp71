'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Plus, Tag, Pencil, Trash2, X } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';

interface PriceList {
    id: string;
    name: string;
    description?: string | null;
    is_default: boolean;
    overall_discount_type?: 'PERCENTAGE' | 'FIXED_AMOUNT' | null;
    overall_discount_value?: string | number | null;
    _count?: { items?: number; customerGroups?: number };
}

const columnHelper = createColumnHelper<PriceList>();

function formatOverallDiscount(list: PriceList) {
    if (!list.overall_discount_type || list.overall_discount_value == null) return '—';
    const value = Number(list.overall_discount_value);
    if (list.overall_discount_type === 'PERCENTAGE') return `${value}%`;
    return `৳${value}`;
}

export default function PriceListsPage() {
    const { t } = useI18n();
    const [lists, setLists] = useState<PriceList[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingList, setEditingList] = useState<PriceList | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);

    useEffect(() => { loadLists(); }, []);

    const loadLists = async () => {
        try {
            const data = await api.getPriceLists();
            setLists(data);
        } catch (error) {
            console.error('Failed to load price lists', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (data: any) => {
        if (editingList) {
            await api.updatePriceList(editingList.id, data);
        } else {
            await api.createPriceList(data);
        }
        setIsFormOpen(false);
        setEditingList(null);
        loadLists();
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t.priceLists.deleteConfirm)) return;
        try {
            await api.deletePriceList(id);
            loadLists();
        } catch (err: any) {
            alert(err.message || t.priceLists.deleteFailed);
        }
    };

    const columns: ColumnDef<PriceList, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.priceLists.columns.name,
                cell: (info) => {
                    const list = info.row.original;
                    return (
                        <div>
                            <Link href={`/sales/price-lists/${list.id}`} className="block text-sm font-black text-blue-600 hover:text-blue-800">
                                {list.name}
                            </Link>
                            <span className="block text-xs text-gray-400">{list.description || '—'}</span>
                            {list.is_default && (
                                <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                                    {t.priceLists.defaultBadge}
                                </span>
                            )}
                        </div>
                    );
                },
            }),
            columnHelper.display({
                id: 'overallDiscount',
                header: t.priceLists.columns.overallDiscount,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatOverallDiscount(info.row.original)}
                    </span>
                ),
            }),
            columnHelper.display({
                id: 'products',
                header: t.priceLists.columns.products,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-600">
                        {info.row.original._count?.items ?? 0}
                    </span>
                ),
            }),
            columnHelper.display({
                id: 'groups',
                header: t.priceLists.columns.groups,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-600">
                        {info.row.original._count?.customerGroups ?? 0}
                    </span>
                ),
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: (info) => {
                    const list = info.row.original;
                    return (
                        <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => { setEditingList(list); setIsFormOpen(true); }} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600">
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(list.id)} className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
            }),
        ],
        [t],
    );

    return (
        <div className="min-h-screen bg-gray-50/50 p-6 md:p-10">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t.priceLists.title}</h1>
                        <p className="text-sm text-gray-500 font-medium mt-1">{t.priceLists.subtitle}</p>
                    </div>
                    <button onClick={() => { setEditingList(null); setIsFormOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0">
                        <Plus className="w-4 h-4 mr-2" /> {t.priceLists.newList}
                    </button>
                </div>

                {isFormOpen && (
                    <ListForm
                        list={editingList}
                        onSave={handleSave}
                        onCancel={() => { setIsFormOpen(false); setEditingList(null); }}
                    />
                )}

                <DataTable<PriceList>
                    tableId="price-lists"
                    columns={columns}
                    data={lists}
                    title={t.priceLists.title}
                    isLoading={loading}
                    emptyMessage={t.priceLists.emptyMessage}
                    emptyIcon={<Tag className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.priceLists.searchPlaceholder}
                />
            </div>
        </div>
    );
}

function ListForm({ list, onSave, onCancel }: { list: PriceList | null; onSave: (d: any) => Promise<void>; onCancel: () => void }) {
    const { t } = useI18n();
    const [name, setName] = useState(list?.name || '');
    const [description, setDescription] = useState(list?.description || '');
    const [isDefault, setIsDefault] = useState(list?.is_default ?? false);
    const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT' | ''>(list?.overall_discount_type || '');
    const [discountValue, setDiscountValue] = useState(
        list?.overall_discount_value != null ? String(Number(list.overall_discount_value)) : '',
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const payload: any = { name, is_default: isDefault };
            if (description) payload.description = description;
            if (discountType && discountValue) {
                payload.overall_discount_type = discountType;
                payload.overall_discount_value = parseFloat(discountValue);
            } else if (list) {
                payload.overall_discount_type = null;
                payload.overall_discount_value = null;
            }
            await onSave(payload);
        } catch (err: any) {
            setError(err.message || t.priceLists.saveFailed);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-sm">{list ? t.priceLists.editList : t.priceLists.newList}</h3>
                <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-black text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.priceLists.placeholders.name} />
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.description}</label>
                    <input value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.priceLists.placeholders.description} />
                </div>
                <div className="w-36">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.priceLists.overallDiscount}</label>
                    <select value={discountType} onChange={e => setDiscountType(e.target.value as any)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 font-bold text-sm">
                        <option value="">{t.priceLists.noDiscount}</option>
                        <option value="PERCENTAGE">{t.priceLists.percentage}</option>
                        <option value="FIXED_AMOUNT">{t.priceLists.fixedAmount}</option>
                    </select>
                </div>
                {discountType && (
                    <div className="w-28">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.amount}</label>
                        <input type="number" min="0" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-sm" />
                    </div>
                )}
                <label className="flex items-center gap-2 text-sm font-bold text-gray-600 pb-2.5">
                    <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded" />
                    {t.priceLists.defaultBadge}
                </label>
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all disabled:opacity-50">
                    {loading ? t.priceLists.saving : list ? t.common.update : t.common.create}
                </button>
            </form>
        </div>
    );
}