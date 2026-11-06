'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { Plus, MapPin, Pencil, Trash2, X, Upload, Network, Layers, Users, CircleOff } from 'lucide-react';
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
];

interface Territory {
    id: string;
    name: string;
    parent_id?: string | null;
    parent?: { id: string; name: string } | null;
    description?: string | null;
    _count?: { customers?: number; children?: number };
}

const columnHelper = createColumnHelper<Territory>();

/** The parent chip's value for a top-level territory. */
const ROOT = '__root__';

const customersOf = (territory: Territory) => territory._count?.customers ?? 0;

/**
 * The territory master — a tree of areas customers are filed under. Every
 * territory is loaded, so the toolbar chips and the strip work on the rows in
 * the browser, and each row's level is worked out from its parents.
 */
export default function TerritoriesPage() {
    const { t, fmt, locale } = useI18n();
    const copy = t.salesMasterLists.territories;
    const [territories, setTerritories] = useState<Territory[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Territory | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [search, setSearch] = useState('');
    const [parentFilter, setParentFilter] = useState<string[]>([]);
    const [levelFilter, setLevelFilter] = useState<string[]>([]);
    const [customerCount, setCustomerCount] = useState<NumberCondition | null>(null);

    useEffect(() => { void loadTerritories(); }, []);

    const loadTerritories = async () => {
        try {
            const data = await api.getTerritories();
            setTerritories(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load territories', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (data: any) => {
        if (editingTerritory) {
            await api.updateTerritory(editingTerritory.id, data);
        } else {
            await api.createTerritory(data);
        }
        setIsFormOpen(false);
        setEditingTerritory(null);
        void loadTerritories();
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteTerritory(deleteTarget.id);
            setDeleteTarget(null);
            toast.success(copy.deleted);
            void loadTerritories();
        } catch (err: any) {
            toast.error(err?.message || t.territories.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const openEdit = (territory: Territory) => {
        setEditingTerritory(territory);
        setIsFormOpen(true);
    };

    const openCreate = () => {
        setEditingTerritory(null);
        setIsFormOpen(true);
    };

    const childrenCountByParent = useMemo(() => {
        const counts: Record<string, number> = {};
        territories.forEach((territory) => {
            if (territory.parent_id) {
                counts[territory.parent_id] = (counts[territory.parent_id] || 0) + 1;
            }
        });
        return counts;
    }, [territories]);

    const depthById = useMemo(() => {
        const territoryMap = new Map(territories.map((territory) => [territory.id, territory]));
        const result: Record<string, number> = {};

        const getDepth = (territory: Territory, seen: Set<string> = new Set()): number => {
            if (!territory.parent_id || seen.has(territory.id)) return 0;
            if (result[territory.id] !== undefined) return result[territory.id];
            seen.add(territory.id);

            const parent = territoryMap.get(territory.parent_id);
            const depth = parent ? getDepth(parent, seen) + 1 : 0;
            result[territory.id] = depth;
            return depth;
        };

        territories.forEach((territory) => {
            result[territory.id] = getDepth(territory);
        });

        return result;
    }, [territories]);

    const parentOptions = useMemo(() => {
        const named = new Map<string, string>();
        territories.forEach((territory) => { if (territory.parent) named.set(territory.parent.id, territory.parent.name); });
        return [...named].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    }, [territories]);

    const levelOptions = useMemo(() => {
        const deepest = territories.reduce((max, territory) => Math.max(max, (depthById[territory.id] || 0) + 1), 0);
        return Array.from({ length: deepest }, (_, index) => ({
            value: String(index + 1),
            label: fmt(copy.levelN, { level: index + 1 }),
        }));
    }, [territories, depthById, fmt, copy]);

    const filtered = useMemo(
        () => territories.filter((territory) => {
            if (!matchesAnyOf(parentFilter, territory.parent_id || ROOT)) return false;
            if (!matchesAnyOf(levelFilter, String((depthById[territory.id] || 0) + 1))) return false;
            if (!matchesNumberCondition(customersOf(territory), customerCount)) return false;
            return matchesSearch(search, territory.name, territory.description, territory.parent?.name);
        }),
        [territories, parentFilter, levelFilter, customerCount, search, depthById],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'parent',
            type: 'multi-select',
            label: t.territories.parent,
            value: parentFilter,
            onChange: setParentFilter,
            options: [{ value: ROOT, label: t.territories.root }, ...parentOptions],
        },
        {
            id: 'level',
            type: 'multi-select',
            label: t.territories.level,
            value: levelFilter,
            onChange: setLevelFilter,
            options: levelOptions,
        },
        {
            id: 'customers',
            type: 'number',
            label: t.territories.columns.customers,
            value: customerCount,
            onChange: setCustomerCount,
        },
    ], [t, parentFilter, parentOptions, levelFilter, levelOptions, customerCount]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const levels = new Set(filtered.map((territory) => depthById[territory.id] || 0)).size;
        const items: ListStat[] = [
            { id: 'count', icon: <MapPin aria-hidden />, label: copy.stats.territories, value: n(filtered.length) },
            {
                id: 'topLevel',
                icon: <Network aria-hidden />,
                label: copy.stats.topLevel,
                value: n(filtered.filter((territory) => !territory.parent_id).length),
            },
            { id: 'levels', icon: <Layers aria-hidden />, label: copy.stats.levels, value: n(levels) },
            {
                id: 'customers',
                icon: <Users aria-hidden />,
                label: copy.stats.customers,
                value: n(filtered.reduce((sum, territory) => sum + customersOf(territory), 0)),
            },
            {
                id: 'unused',
                icon: <CircleOff aria-hidden />,
                label: copy.stats.unused,
                // No customer filed under it and no area below it.
                value: n(filtered.filter((territory) => customersOf(territory) === 0 && !childrenCountByParent[territory.id]).length),
            },
        ];
        return { items, loading, label: copy.statsLabel };
    }, [filtered, loading, locale, copy, depthById, childrenCountByParent]);

    const columns: ColumnDef<Territory, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.territories.columns.territory,
                cell: (info) => {
                    const territory = info.row.original;
                    const depth = depthById[territory.id] || 0;
                    return (
                        <div className="min-w-0" style={{ paddingInlineStart: `${depth * 16}px` }}>
                            <span className="block">{territory.name}</span>
                            <span className="block truncate text-gray-500">{territory.description || t.customerGroups.noDescription}</span>
                        </div>
                    );
                },
                size: 280,
            }),
            columnHelper.accessor((row) => row.parent?.name ?? '', {
                id: 'parent',
                header: t.territories.parent,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.territories.root}</span>,
                size: 160,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => (depthById[row.id] || 0) + 1, {
                id: 'level',
                header: t.territories.level,
                cell: (info) => `L${info.getValue()}`,
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor(customersOf, {
                id: 'customers',
                header: t.territories.columns.customers,
                cell: (info) => info.getValue().toLocaleString(locale),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => childrenCountByParent[row.id] || 0, {
                id: 'children',
                header: t.territories.subTerritories,
                cell: (info) => info.getValue().toLocaleString(locale),
                size: 130,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const territory = info.row.original;
                    const inUse = customersOf(territory) > 0 || (childrenCountByParent[territory.id] || 0) > 0;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(territory)} />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={inUse ? copy.inUse : t.common.delete}
                                intent="danger"
                                disabled={inUse}
                                onClick={() => setDeleteTarget(territory)}
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
        [childrenCountByParent, depthById, t, copy, locale],
    );

    return (
        <PageShell>
            <PageHeader
                title={t.territories.title}
                subtitle={t.territories.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.territories.title,
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
                            {t.territories.newTerritory}
                        </button>
                    </>
                )}
            />

            {isFormOpen && (
                <TerritoryForm
                    territory={editingTerritory}
                    territories={territories}
                    onSave={handleSave}
                    onCancel={() => { setIsFormOpen(false); setEditingTerritory(null); }}
                />
            )}

            <DataTable<Territory>
                tableId="territories"
                columns={columns}
                data={filtered}
                title={t.territories.title}
                isLoading={loading}
                emptyMessage={t.territories.emptyMessage}
                emptyIcon={<MapPin className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.territories.searchPlaceholder}
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
                entityLabel={t.territories.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importTerritories(rows, mode)}
                onSuccess={() => void loadTerritories()}
            />
        </PageShell>
    );
}

function TerritoryForm({ territory, territories, onSave, onCancel }: {
    territory: any; territories: any[]; onSave: (d: any) => Promise<void>; onCancel: () => void;
}) {
    const { t } = useI18n();
    const [name, setName] = useState(territory?.name || '');
    const [parentId, setParentId] = useState(territory?.parent_id || '');
    const [description, setDescription] = useState(territory?.description || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const availableParents = territories.filter(item => item.id !== territory?.id);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const payload: any = { name };
            if (parentId) payload.parent_id = parentId;
            if (description) payload.description = description;
            await onSave(payload);
        } catch (err: any) {
            setError(err.message || t.territories.saveFailed);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm">{territory ? t.territories.editTerritory : t.territories.newTerritory}</h3>
                <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.territories.placeholders.name} />
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.territories.parentTerritory} <span className="text-gray-300">({t.common.optional})</span></label>
                    <select value={parentId} onChange={e => setParentId(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20">
                        <option value="">{t.territories.noneRoot}</option>
                        {availableParents.map(item => (
                            <option key={item.id} value={item.id}>{item.parent ? `${item.parent.name} > ` : ''}{item.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.description} <span className="text-gray-300">({t.common.optional})</span></label>
                    <input value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.territories.placeholders.description} />
                </div>
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all disabled:opacity-50">
                    {loading ? t.territories.saving : territory ? t.common.update : t.common.create}
                </button>
            </form>
        </div>
    );
}