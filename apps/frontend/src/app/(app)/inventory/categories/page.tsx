'use client';

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FolderTree, Plus, Tag, Trash2, Pencil, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages/types';

interface ProductGroup {
    id: string;
    name: string;
    description?: string | null;
    is_featured?: boolean;
    image_url?: string | null;
    _count?: { subgroups?: number; products?: number };
}

interface ProductSubgroup {
    id: string;
    name: string;
    description?: string | null;
    group_id: string;
    group?: { id: string; name: string } | null;
    _count?: { products?: number };
}

const groupColumnHelper = createColumnHelper<ProductGroup>();
const subgroupColumnHelper = createColumnHelper<ProductSubgroup>();

function GroupNameCell({ group, noDescription, featured }: { readonly group: ProductGroup; readonly noDescription: string; readonly featured: string }) {
    return (
        <div>
            <span className="block text-sm font-black text-gray-900">{group.name}</span>
            <span className="block text-xs text-gray-400">{group.description || noDescription}</span>
            {group.is_featured && (
                <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    {featured}
                </span>
            )}
        </div>
    );
}

function SubgroupNameCell({ subgroup, noDescription }: { readonly subgroup: ProductSubgroup; readonly noDescription: string }) {
    return (
        <div>
            <span className="block text-sm font-black text-gray-900">{subgroup.name}</span>
            <span className="block text-xs text-gray-400">{subgroup.description || noDescription}</span>
        </div>
    );
}

function NumberCell({ value }: { readonly value: number }) {
    return <span className="text-sm font-bold text-gray-700">{value}</span>;
}

function ActionsCell({ onEdit, onDelete }: { readonly onEdit: () => void; readonly onDelete: () => void }) {
    return (
        <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={onEdit} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
                <Pencil className="w-4 h-4" />
            </button>
            <button type="button" onClick={onDelete} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}

function buildGroupColumns(
    t: MessageDictionary,
    onEditGroup: (group: ProductGroup) => void,
    onDeleteGroup: (id: string) => void,
): ColumnDef<ProductGroup, any>[] {
    return [
        groupColumnHelper.accessor('name', {
            header: t.inventoryCategories.columns.group,
            cell: (info) => <GroupNameCell group={info.row.original} noDescription={t.inventoryCategories.noDescription} featured={t.inventoryCategories.featured} />,
            size: 220,
        }),
        groupColumnHelper.accessor((row) => (row.is_featured ? 'Yes' : 'No'), {
            id: 'featured',
            header: t.inventoryCategories.columns.featured,
            cell: (info) => <NumberCell value={info.getValue() === 'Yes' ? 1 : 0} />,
            size: 100,
        }),
        groupColumnHelper.accessor((row) => row._count?.subgroups ?? 0, {
            id: 'subgroups',
            header: t.inventoryCategories.columns.subgroups,
            cell: (info) => <NumberCell value={info.getValue()} />,
            size: 100,
        }),
        groupColumnHelper.accessor((row) => row._count?.products ?? 0, {
            id: 'products',
            header: t.inventoryCategories.columns.products,
            cell: (info) => <NumberCell value={info.getValue()} />,
            size: 100,
        }),
        groupColumnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <ActionsCell
                    onEdit={() => onEditGroup(info.row.original)}
                    onDelete={() => onDeleteGroup(info.row.original.id)}
                />
            ),
            enableSorting: false,
            size: 100,
        }),
    ];
}

function buildSubgroupColumns(
    t: MessageDictionary,
    onEditSubgroup: (subgroup: ProductSubgroup) => void,
    onDeleteSubgroup: (id: string) => void,
): ColumnDef<ProductSubgroup, any>[] {
    return [
        subgroupColumnHelper.accessor('name', {
            header: t.inventoryCategories.columns.subgroup,
            cell: (info) => <SubgroupNameCell subgroup={info.row.original} noDescription={t.inventoryCategories.noDescription} />,
            size: 220,
        }),
        subgroupColumnHelper.accessor((row) => row.group?.name || '-', {
            id: 'group',
            header: t.inventoryCategories.parentGroup,
            cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
            size: 170,
        }),
        subgroupColumnHelper.accessor((row) => row._count?.products ?? 0, {
            id: 'products',
            header: t.inventoryCategories.columns.products,
            cell: (info) => <NumberCell value={info.getValue()} />,
            size: 100,
        }),
        subgroupColumnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <ActionsCell
                    onEdit={() => onEditSubgroup(info.row.original)}
                    onDelete={() => onDeleteSubgroup(info.row.original.id)}
                />
            ),
            enableSorting: false,
            size: 100,
        }),
    ];
}

export default function InventoryCategoriesPage() {
    const { t } = useI18n();
    const [groups, setGroups] = useState<ProductGroup[]>([]);
    const [subgroups, setSubgroups] = useState<ProductSubgroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupFormOpen, setGroupFormOpen] = useState(false);
    const [subgroupFormOpen, setSubgroupFormOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<ProductGroup | null>(null);
    const [editingSubgroup, setEditingSubgroup] = useState<ProductSubgroup | null>(null);

    useEffect(() => {
        void refreshAll();
    }, []);

    const refreshAll = async () => {
        setLoading(true);
        try {
            const [groupData, subgroupData] = await Promise.all([api.getProductGroups(), api.getProductSubgroups()]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load inventory categories', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteGroup = async (id: string) => {
        if (!globalThis.confirm(t.inventoryCategories.deleteGroupConfirm)) return;
        try {
            await api.deleteProductGroup(id);
            await refreshAll();
        } catch (error: any) {
            globalThis.alert(error.message || t.inventoryCategories.deleteGroupFailed);
        }
    };

    const handleDeleteSubgroup = async (id: string) => {
        if (!globalThis.confirm(t.inventoryCategories.deleteSubgroupConfirm)) return;
        try {
            await api.deleteProductSubgroup(id);
            await refreshAll();
        } catch (error: any) {
            globalThis.alert(error.message || t.inventoryCategories.deleteSubgroupFailed);
        }
    };

    const groupColumns = useMemo(
        () => buildGroupColumns(
            t,
            (group) => {
                setEditingGroup(group);
                setGroupFormOpen(true);
            },
            (id) => void handleDeleteGroup(id),
        ),
        [t, groups],
    );

    const subgroupColumns = useMemo(
        () => buildSubgroupColumns(
            t,
            (subgroup) => {
                setEditingSubgroup(subgroup);
                setSubgroupFormOpen(true);
            },
            (id) => void handleDeleteSubgroup(id),
        ),
        [t, subgroups],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventoryCategories.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.inventoryCategories.subtitle}
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                setEditingSubgroup(null);
                                setSubgroupFormOpen(true);
                            }}
                            className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center"
                        >
                            <Tag className="w-4 h-4 mr-2" />
                            {t.inventoryCategories.newSubgroup}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingGroup(null);
                                setGroupFormOpen(true);
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.inventoryCategories.newGroup}
                        </button>
                    </div>
                </div>

                {groupFormOpen && (
                    <ProductGroupForm
                        group={editingGroup}
                        onCancel={() => {
                            setEditingGroup(null);
                            setGroupFormOpen(false);
                        }}
                        onSaved={async () => {
                            setEditingGroup(null);
                            setGroupFormOpen(false);
                            await refreshAll();
                        }}
                    />
                )}

                {subgroupFormOpen && (
                    <ProductSubgroupForm
                        groups={groups}
                        subgroup={editingSubgroup}
                        onCancel={() => {
                            setEditingSubgroup(null);
                            setSubgroupFormOpen(false);
                        }}
                        onSaved={async () => {
                            setEditingSubgroup(null);
                            setSubgroupFormOpen(false);
                            await refreshAll();
                        }}
                    />
                )}

                <DataTable<ProductGroup>
                    tableId="product-groups"
                    columns={groupColumns}
                    data={groups}
                    title={t.inventoryCategories.productGroups}
                    isLoading={loading}
                    emptyMessage={t.inventoryCategories.emptyGroups}
                    emptyIcon={<FolderTree className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryCategories.searchGroups}
                />

                <DataTable<ProductSubgroup>
                    tableId="product-subgroups"
                    columns={subgroupColumns}
                    data={subgroups}
                    title={t.inventoryCategories.productSubgroups}
                    isLoading={loading}
                    emptyMessage={t.inventoryCategories.emptySubgroups}
                    emptyIcon={<Tag className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryCategories.searchSubgroups}
                />
            </div>
        </div>
    );
}

function ProductGroupForm({
    group,
    onCancel,
    onSaved,
}: Readonly<{
    group: ProductGroup | null;
    onCancel: () => void;
    onSaved: () => Promise<void>;
}>) {
    const { t } = useI18n();
    const [name, setName] = useState(group?.name ?? '');
    const [description, setDescription] = useState(group?.description ?? '');
    const [isFeatured, setIsFeatured] = useState(group?.is_featured ?? false);
    const [imageUrl, setImageUrl] = useState(group?.image_url ?? '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            const payload = {
                name,
                description: description || undefined,
                is_featured: isFeatured,
                image_url: imageUrl || undefined,
            };

            if (group) {
                await api.updateProductGroup(group.id, payload);
            } else {
                await api.createProductGroup(payload);
            }

            await onSaved();
        } catch (err: any) {
            setError(err.message || t.inventoryCategories.saveGroupFailed);
        } finally {
            setLoading(false);
        }
    };

    let submitLabel = t.inventoryCategories.createGroup;
    if (loading) {
        submitLabel = t.inventoryCategories.saving;
    } else if (group) {
        submitLabel = t.inventoryCategories.updateGroup;
    }

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-sm">{group ? t.inventoryCategories.editProductGroup : t.inventoryCategories.newProductGroup}</h3>
                <button type="button" onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                    <X className="w-4 h-4" />
                </button>
            </div>
            {error ? <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div> : null}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[220px]">
                    <label htmlFor="group-name" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input id="group-name" value={name} onChange={(event) => setName(event.target.value)} required className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm font-bold" />
                </div>
                <div className="flex-1 min-w-[260px]">
                    <label htmlFor="group-description" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.description}</label>
                    <input id="group-description" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm" />
                </div>
                <div className="min-w-[180px]">
                    <label htmlFor="group-image-url" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.inventoryCategories.categoryImageUrl}</label>
                    <input id="group-image-url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm" />
                </div>
                <label className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-700">
                    <input
                        type="checkbox"
                        checked={isFeatured}
                        onChange={(event) => setIsFeatured(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                    />
                    <span>{t.inventoryCategories.featured}</span>
                </label>
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                    {submitLabel}
                </button>
            </form>
        </div>
    );
}

function ProductSubgroupForm({
    groups,
    subgroup,
    onCancel,
    onSaved,
}: Readonly<{
    groups: ProductGroup[];
    subgroup: ProductSubgroup | null;
    onCancel: () => void;
    onSaved: () => Promise<void>;
}>) {
    const { t } = useI18n();
    const [groupId, setGroupId] = useState(subgroup?.group_id ?? groups[0]?.id ?? '');
    const [name, setName] = useState(subgroup?.name ?? '');
    const [description, setDescription] = useState(subgroup?.description ?? '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            const payload = { groupId, name, description: description || undefined };

            if (subgroup) {
                await api.updateProductSubgroup(subgroup.id, payload);
            } else {
                await api.createProductSubgroup(payload);
            }

            await onSaved();
        } catch (err: any) {
            setError(err.message || t.inventoryCategories.saveSubgroupFailed);
        } finally {
            setLoading(false);
        }
    };

    let submitLabel = t.inventoryCategories.createSubgroup;
    if (loading) {
        submitLabel = t.inventoryCategories.saving;
    } else if (subgroup) {
        submitLabel = t.inventoryCategories.updateSubgroup;
    }

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-sm">{subgroup ? t.inventoryCategories.editProductSubgroup : t.inventoryCategories.newProductSubgroup}</h3>
                <button type="button" onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                    <X className="w-4 h-4" />
                </button>
            </div>
            {error ? <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-4">{error}</div> : null}
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                <div className="min-w-[220px]">
                    <label htmlFor="subgroup-parent" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.inventoryCategories.parentGroup}</label>
                    <select id="subgroup-parent" value={groupId} onChange={(event) => setGroupId(event.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm font-bold">
                        {groups.map((group) => (
                            <option key={group.id} value={group.id}>
                                {group.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 min-w-[220px]">
                    <label htmlFor="subgroup-name" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.name}</label>
                    <input id="subgroup-name" value={name} onChange={(event) => setName(event.target.value)} required className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm font-bold" />
                </div>
                <div className="flex-1 min-w-[260px]">
                    <label htmlFor="subgroup-description" className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">{t.common.description}</label>
                    <input id="subgroup-description" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-4 text-sm" />
                </div>
                <button disabled={loading} type="submit" className="px-6 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                    {submitLabel}
                </button>
            </form>
        </div>
    );
}
