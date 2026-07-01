'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { Plus, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';

interface Territory {
    id: string;
    name: string;
    parent_id?: string | null;
    parent?: { id: string; name: string } | null;
    description?: string | null;
    _count?: { customers?: number };
}

const columnHelper = createColumnHelper<Territory>();

export default function TerritoriesPage() {
    const { t } = useI18n();
    const [territories, setTerritories] = useState<Territory[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);

    useEffect(() => { loadTerritories(); }, []);

    const loadTerritories = async () => {
        try {
            const data = await api.getTerritories();
            setTerritories(data);
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
        loadTerritories();
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t.territories.deleteConfirm)) return;
        try {
            await api.deleteTerritory(id);
            loadTerritories();
        } catch (err: any) {
            alert(err.message || t.territories.deleteFailed);
        }
    };

    const openEdit = (territory: any) => {
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

        const getDepth = (territory: Territory): number => {
            if (!territory.parent_id) return 0;
            if (result[territory.id] !== undefined) return result[territory.id];

            const parent = territoryMap.get(territory.parent_id);
            const depth = parent ? getDepth(parent) + 1 : 0;
            result[territory.id] = depth;
            return depth;
        };

        territories.forEach((territory) => {
            result[territory.id] = getDepth(territory);
        });

        return result;
    }, [territories]);

    const columns: ColumnDef<Territory, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.territories.columns.territory,
                cell: (info) => {
                    const territory = info.row.original;
                    const depth = depthById[territory.id] || 0;
                    return (
                        <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
                            <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                                <MapPin className="w-4 h-4" />
                            </div>
                            <div>
                                <span className="block text-sm font-black text-gray-900">{territory.name}</span>
                                <span className="block text-xs text-gray-400">{territory.description || t.customerGroups.noDescription}</span>
                            </div>
                        </div>
                    );
                },
                size: 280,
            }),
            columnHelper.accessor((row) => row.parent?.name ?? '', {
                id: 'parent',
                header: t.territories.parent,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-700">{info.getValue() || t.territories.root}</span>
                ),
                size: 160,
            }),
            columnHelper.accessor((row) => depthById[row.id] || 0, {
                id: 'level',
                header: t.territories.level,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">L{Number(info.getValue()) + 1}</span>
                ),
                sortingFn: (a, b) => Number(a.getValue('level')) - Number(b.getValue('level')),
                size: 90,
            }),
            columnHelper.accessor((row) => row._count?.customers ?? 0, {
                id: 'customers',
                header: t.territories.columns.customers,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>
                ),
                sortingFn: (a, b) => Number(a.getValue('customers')) - Number(b.getValue('customers')),
                size: 110,
            }),
            columnHelper.accessor((row) => childrenCountByParent[row.id] || 0, {
                id: 'children',
                header: t.territories.subTerritories,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>
                ),
                sortingFn: (a, b) => Number(a.getValue('children')) - Number(b.getValue('children')),
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const territory = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <button
                                onClick={() => openEdit(territory)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(territory.id)}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 110,
            }),
        ],
        [childrenCountByParent, depthById, t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.territories.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.territories.subtitle}
                        </p>
                    </div>
                    <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0">
                        <Plus className="w-4 h-4 mr-2" /> {t.territories.newTerritory}
                    </button>
                </div>

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
                    data={territories}
                    title={t.territories.title}
                    isLoading={loading}
                    emptyMessage={t.territories.emptyMessage}
                    emptyIcon={<MapPin className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.territories.searchPlaceholder}
                />
            </div>
        </div>
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
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-sm">{territory ? t.territories.editTerritory : t.territories.newTerritory}</h3>
                <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 font-black text-sm focus:ring-2 focus:ring-blue-500/20" placeholder={t.territories.placeholders.name} />
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
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all disabled:opacity-50">
                    {loading ? t.territories.saving : territory ? t.common.update : t.common.create}
                </button>
            </form>
        </div>
    );
}