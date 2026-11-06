'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Plus, Tag, Pencil, Trash2, X, Upload, Eye, Star, Percent, Package, FolderTree } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { routes } from '@/lib/routes';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { ConfirmDialog, PageShell, StatusBadge, buttonClassName } from '@/components/ui';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', required: false },
];

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

/** The discount chip's values: the list's overall discount type, or none. */
type DiscountKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'NONE';

const discountKindOf = (list: PriceList): DiscountKind =>
    list.overall_discount_type && list.overall_discount_value != null && Number(list.overall_discount_value) > 0
        ? list.overall_discount_type
        : 'NONE';
/** The overall discount as the list shows it; null when the list has none. */
function discountLabel(list: PriceList, locale: string): string | null {
    const kind = discountKindOf(list);
    if (kind === 'NONE') return null;
    const value = Number(list.overall_discount_value);
    return kind === 'PERCENTAGE' ? `${value}%` : formatBDT(value, { locale });
}
const productsOf = (list: PriceList) => list._count?.items ?? 0;
const groupsOf = (list: PriceList) => list._count?.customerGroups ?? 0;

/**
 * The price-list master. Every list is loaded — a shop keeps a few — so the
 * toolbar chips and the strip work on the rows in the browser.
 */
export default function PriceListsPage() {
    const { t, fmt, locale } = useI18n();
    const copy = t.salesMasterLists.priceLists;
    const [lists, setLists] = useState<PriceList[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingList, setEditingList] = useState<PriceList | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<PriceList | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [search, setSearch] = useState('');
    const [discountKinds, setDiscountKinds] = useState<string[]>([]);
    const [productCount, setProductCount] = useState<NumberCondition | null>(null);
    const [groupCount, setGroupCount] = useState<NumberCondition | null>(null);

    useEffect(() => { void loadLists(); }, []);

    const loadLists = async () => {
        try {
            const data = await api.getPriceLists();
            setLists(Array.isArray(data) ? data : []);
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
        void loadLists();
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deletePriceList(deleteTarget.id);
            setDeleteTarget(null);
            toast.success(copy.deleted);
            void loadLists();
        } catch (err: any) {
            toast.error(err?.message || t.priceLists.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const filtered = useMemo(
        () => lists.filter((list) => {
            if (!matchesAnyOf(discountKinds, discountKindOf(list))) return false;
            if (!matchesNumberCondition(productsOf(list), productCount)) return false;
            if (!matchesNumberCondition(groupsOf(list), groupCount)) return false;
            return matchesSearch(search, list.name, list.description);
        }),
        [lists, discountKinds, productCount, groupCount, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'discount',
            type: 'multi-select',
            label: t.priceLists.overallDiscount,
            value: discountKinds,
            onChange: setDiscountKinds,
            options: [
                { value: 'PERCENTAGE', label: copy.discountTypes.percentage },
                { value: 'FIXED_AMOUNT', label: copy.discountTypes.fixed },
                { value: 'NONE', label: copy.discountTypes.none },
            ],
        },
        {
            id: 'products',
            type: 'number',
            label: t.priceLists.columns.products,
            value: productCount,
            onChange: setProductCount,
        },
        {
            id: 'groups',
            type: 'number',
            label: t.priceLists.columns.groups,
            value: groupCount,
            onChange: setGroupCount,
        },
    ], [t, copy, discountKinds, productCount, groupCount]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const defaultList = filtered.find((list) => list.is_default);
        const items: ListStat[] = [
            { id: 'count', icon: <Tag aria-hidden />, label: copy.stats.lists, value: n(filtered.length) },
            { id: 'default', icon: <Star aria-hidden />, label: copy.stats.defaultList, value: defaultList?.name ?? copy.none },
            {
                id: 'discount',
                icon: <Percent aria-hidden />,
                label: copy.stats.withDiscount,
                value: n(filtered.filter((list) => discountKindOf(list) !== 'NONE').length),
            },
            {
                id: 'products',
                icon: <Package aria-hidden />,
                label: copy.stats.products,
                value: n(filtered.reduce((sum, list) => sum + productsOf(list), 0)),
            },
            {
                id: 'groups',
                icon: <FolderTree aria-hidden />,
                label: copy.stats.groups,
                value: n(filtered.reduce((sum, list) => sum + groupsOf(list), 0)),
            },
        ];
        return { items, loading, label: copy.statsLabel };
    }, [filtered, loading, locale, copy]);

    const columns: ColumnDef<PriceList, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.priceLists.columns.name,
                cell: (info) => {
                    const list = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="flex items-center gap-2">
                                <Link href={routes.sales.priceListDetail(list.id)} className="text-blue-600 hover:underline">
                                    {list.name}
                                </Link>
                                {list.is_default && <StatusBadge tone="info">{t.priceLists.defaultBadge}</StatusBadge>}
                            </span>
                            {list.description && <span className="block truncate text-gray-500">{list.description}</span>}
                        </div>
                    );
                },
                size: 260,
            }),
            columnHelper.accessor((row) => Number(row.overall_discount_value ?? 0), {
                id: 'overallDiscount',
                header: t.priceLists.columns.overallDiscount,
                cell: (info) => discountLabel(info.row.original, locale) ?? <span className="text-gray-400">—</span>,
                size: 150,
                meta: { align: 'end' },
            }),
            columnHelper.accessor(productsOf, {
                id: 'products',
                header: t.priceLists.columns.products,
                cell: (info) => info.getValue().toLocaleString(locale),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor(groupsOf, {
                id: 'groups',
                header: t.priceLists.columns.groups,
                cell: (info) => info.getValue().toLocaleString(locale),
                size: 140,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const list = info.row.original;
                    const blocked = list.is_default ? copy.defaultLocked : groupsOf(list) > 0 ? copy.inUse : null;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={routes.sales.priceListDetail(list.id)} />
                            <RowActionButton
                                icon={<Pencil />}
                                label={t.common.edit}
                                onClick={() => { setEditingList(list); setIsFormOpen(true); }}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={blocked ?? t.common.delete}
                                intent="danger"
                                disabled={blocked !== null}
                                onClick={() => setDeleteTarget(list)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 130,
            }),
        ],
        [t, copy, locale],
    );

    return (
        <PageShell>
            <PageHeader
                title={t.priceLists.title}
                subtitle={t.priceLists.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.priceLists.title,
                    'sales',
                )}
                actions={(
                    <>
                        <button type="button" onClick={() => setImportOpen(true)} className={buttonClassName({ variant: 'secondary' })}>
                            <Upload className="w-4 h-4" />
                            {t.common.import}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setEditingList(null); setIsFormOpen(true); }}
                            className={buttonClassName()}
                        >
                            <Plus className="w-4 h-4" />
                            {t.priceLists.newList}
                        </button>
                    </>
                )}
            />

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
                data={filtered}
                title={t.priceLists.title}
                isLoading={loading}
                emptyMessage={t.priceLists.emptyMessage}
                emptyIcon={<Tag className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.priceLists.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                title={fmt(copy.deleteTitle, { name: deleteTarget?.name ?? '' })}
                prompt={copy.deletePrompt}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => { if (!deleting) setDeleteTarget(null); }}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={t.priceLists.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importPriceLists(rows, mode)}
                onSuccess={() => void loadLists()}
            />
        </PageShell>
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
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm">{list ? t.priceLists.editList : t.priceLists.newList}</h3>
                <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.priceLists.placeholders.name} />
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
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all disabled:opacity-50">
                    {loading ? t.priceLists.saving : list ? t.common.update : t.common.create}
                </button>
            </form>
        </div>
    );
}