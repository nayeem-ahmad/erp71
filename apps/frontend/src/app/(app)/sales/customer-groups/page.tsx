'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { Plus, FolderTree, Pencil, Trash2, X, Upload, Users, Tag, Percent } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { ConfirmDialog, PageShell, buttonClassName } from '@/components/ui';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'discount_percent', label: 'Discount %', required: false },
];

interface CustomerGroup {
    id: string;
    name: string;
    description?: string | null;
    default_discount_pct?: string | number | null;
    price_list_id?: string | null;
    priceList?: { id: string; name: string } | null;
    _count?: { customers?: number };
}

const columnHelper = createColumnHelper<CustomerGroup>();

/** The price-list chip's value for a group that uses the default prices. */
const NONE = '__none__';

const customersOf = (group: CustomerGroup) => group._count?.customers ?? 0;
const discountOf = (group: CustomerGroup) => Number(group.default_discount_pct || 0);

/**
 * The customer-group master. Every group is loaded — a shop has a handful — so
 * the toolbar chips and the strip work on the rows in the browser.
 */
export default function CustomerGroupsPage() {
    const { t, fmt, locale } = useI18n();
    const copy = t.salesMasterLists.groups;
    const [groups, setGroups] = useState<CustomerGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingGroup, setEditingGroup] = useState<CustomerGroup | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<CustomerGroup | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [search, setSearch] = useState('');
    const [priceListFilter, setPriceListFilter] = useState<string[]>([]);
    const [discountFilter, setDiscountFilter] = useState<NumberCondition | null>(null);
    const [customerCount, setCustomerCount] = useState<NumberCondition | null>(null);

    useEffect(() => { void loadGroups(); }, []);

    const loadGroups = async () => {
        try {
            const data = await api.getCustomerGroups();
            setGroups(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load groups', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (data: any) => {
        if (editingGroup) {
            await api.updateCustomerGroup(editingGroup.id, data);
        } else {
            await api.createCustomerGroup(data);
        }
        setIsFormOpen(false);
        setEditingGroup(null);
        void loadGroups();
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteCustomerGroup(deleteTarget.id);
            setDeleteTarget(null);
            toast.success(copy.deleted);
            void loadGroups();
        } catch (err: any) {
            toast.error(err?.message || t.customerGroups.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const openEdit = (group: CustomerGroup) => {
        setEditingGroup(group);
        setIsFormOpen(true);
    };

    const openCreate = () => {
        setEditingGroup(null);
        setIsFormOpen(true);
    };

    const priceListOptions = useMemo(() => {
        const named = new Map<string, string>();
        groups.forEach((group) => { if (group.priceList) named.set(group.priceList.id, group.priceList.name); });
        return [...named].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    }, [groups]);

    const filtered = useMemo(
        () => groups.filter((group) => {
            if (!matchesAnyOf(priceListFilter, group.priceList?.id ?? NONE)) return false;
            if (!matchesNumberCondition(discountOf(group), discountFilter)) return false;
            if (!matchesNumberCondition(customersOf(group), customerCount)) return false;
            return matchesSearch(search, group.name, group.description, group.priceList?.name);
        }),
        [groups, priceListFilter, discountFilter, customerCount, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'priceList',
            type: 'multi-select',
            label: t.customerGroups.priceList,
            value: priceListFilter,
            onChange: setPriceListFilter,
            options: [{ value: NONE, label: copy.noPriceList }, ...priceListOptions],
        },
        {
            id: 'discount',
            type: 'number',
            label: t.customerGroups.discountPct,
            value: discountFilter,
            onChange: setDiscountFilter,
        },
        {
            id: 'customers',
            type: 'number',
            label: t.customerGroups.columns.customers,
            value: customerCount,
            onChange: setCustomerCount,
        },
    ], [t, copy, priceListFilter, priceListOptions, discountFilter, customerCount]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const items: ListStat[] = [
            { id: 'count', icon: <FolderTree aria-hidden />, label: copy.stats.groups, value: n(filtered.length) },
            {
                id: 'customers',
                icon: <Users aria-hidden />,
                label: copy.stats.customers,
                value: n(filtered.reduce((sum, group) => sum + customersOf(group), 0)),
            },
            {
                id: 'priceList',
                icon: <Tag aria-hidden />,
                label: copy.stats.withPriceList,
                value: n(filtered.filter((group) => group.priceList).length),
            },
            {
                id: 'discount',
                icon: <Percent aria-hidden />,
                label: copy.stats.withDiscount,
                value: n(filtered.filter((group) => discountOf(group) > 0).length),
            },
        ];
        return { items, loading, label: copy.statsLabel };
    }, [filtered, loading, locale, copy]);

    const columns: ColumnDef<CustomerGroup, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.customerGroups.columns.group,
                cell: (info) => {
                    const group = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block">{group.name}</span>
                            <span className="block truncate text-gray-500">{group.description || t.customerGroups.noDescription}</span>
                        </div>
                    );
                },
                size: 240,
            }),
            columnHelper.accessor(customersOf, {
                id: 'customers',
                header: t.customerGroups.columns.customers,
                cell: (info) => info.getValue().toLocaleString(locale),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.priceList?.name ?? '', {
                id: 'priceList',
                header: t.customerGroups.priceList,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.customerGroups.noPriceList}</span>,
                size: 180,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor(discountOf, {
                id: 'default_discount_pct',
                header: t.customerGroups.defaultDiscount,
                cell: (info) => {
                    const value = info.getValue();
                    return value > 0 ? `${value}%` : <span className="text-gray-400">{t.common.none}</span>;
                },
                size: 140,
                meta: { align: 'end' },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const group = info.row.original;
                    const inUse = customersOf(group) > 0;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(group)} />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={inUse ? copy.inUse : t.common.delete}
                                intent="danger"
                                disabled={inUse}
                                onClick={() => setDeleteTarget(group)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 100,
            }),
        ],
        [t, copy, locale],
    );

    return (
        <PageShell>
            <PageHeader
                title={t.customerGroups.title}
                subtitle={t.customerGroups.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.customerGroups.title,
                    'sales',
                )}
                actions={(
                    <>
                        <button type="button" onClick={() => setImportOpen(true)} className={buttonClassName({ variant: 'secondary' })}>
                            <Upload className="w-4 h-4" />
                            {t.common.import}
                        </button>
                        <button type="button" onClick={openCreate} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.customerGroups.newGroup}
                        </button>
                    </>
                )}
            />

            {isFormOpen && (
                <GroupForm
                    group={editingGroup}
                    onSave={handleSave}
                    onCancel={() => { setIsFormOpen(false); setEditingGroup(null); }}
                />
            )}

            <DataTable<CustomerGroup>
                tableId="customer-groups"
                columns={columns}
                data={filtered}
                title={t.customerGroups.title}
                isLoading={loading}
                emptyMessage={t.customerGroups.emptyMessage}
                emptyIcon={<FolderTree className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.customerGroups.searchPlaceholder}
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
                entityLabel={t.customerGroups.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importCustomerGroups(rows, mode)}
                onSuccess={() => void loadGroups()}
            />
        </PageShell>
    );
}

function GroupForm({ group, onSave, onCancel }: { group: any; onSave: (d: any) => Promise<void>; onCancel: () => void }) {
    const { t } = useI18n();
    const [name, setName] = useState(group?.name || '');
    const [description, setDescription] = useState(group?.description || '');
    const [discount, setDiscount] = useState(group?.default_discount_pct ? String(Number(group.default_discount_pct)) : '');
    const [priceListId, setPriceListId] = useState(group?.price_list_id || '');
    const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        api.getPriceLists().then(setPriceLists).catch(() => {});
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const payload: any = { name };
            if (description) payload.description = description;
            if (discount) payload.default_discount_pct = parseFloat(discount);
            payload.price_list_id = priceListId || null;
            await onSave(payload);
        } catch (err: any) {
            setError(err.message || t.customerGroups.saveFailed);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm">{group ? t.customerGroups.editGroup : t.customerGroups.newGroup}</h3>
                <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.customerGroups.placeholders.name} />
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.description} <span className="text-gray-300">({t.common.optional})</span></label>
                    <input value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.customerGroups.placeholders.description} />
                </div>
                <div className="w-44">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.customerGroups.priceList}</label>
                    <select value={priceListId} onChange={e => setPriceListId(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 font-bold text-sm">
                        <option value="">{t.customerGroups.noPriceList}</option>
                        {priceLists.map((list) => (
                            <option key={list.id} value={list.id}>{list.name}</option>
                        ))}
                    </select>
                </div>
                <div className="w-32">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.customerGroups.discountPct}</label>
                    <input type="number" min="0" max="100" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20" placeholder="0" />
                </div>
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all disabled:opacity-50">
                    {loading ? t.customerGroups.saving : group ? t.common.update : t.common.create}
                </button>
            </form>
        </div>
    );
}