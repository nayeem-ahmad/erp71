'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BookOpen, FolderTree, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    ACCOUNT_TYPES,
    subgroupGroupId,
    type AccountGroup,
    type AccountSubgroup,
    type AccountType,
} from '@/components/accounting/AccountFormModal';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages/types';
import { compactDensity } from '@/lib/ui/compact-density';

const subgroupColumnHelper = createColumnHelper<AccountSubgroup>();

type PendingDelete = { kind: 'group' | 'subgroup'; id: string; name: string };

function buildSubgroupColumns(
    t: MessageDictionary,
    onEdit: (subgroup: AccountSubgroup) => void,
    onDelete: (subgroup: AccountSubgroup) => void,
): ColumnDef<AccountSubgroup, any>[] {
    return [
        subgroupColumnHelper.accessor('code', {
            header: t.coa.columns.code,
            cell: (info) => (
                <span className="font-mono text-xs text-gray-500">{info.getValue()}</span>
            ),
            size: 70,
        }),
        subgroupColumnHelper.accessor('name', {
            header: t.accountGroups.columns.subgroup,
            cell: (info) => (
                <span className="text-sm font-semibold text-gray-900">{info.getValue()}</span>
            ),
            size: 260,
        }),
        subgroupColumnHelper.accessor((row) => row._count?.accounts ?? 0, {
            id: 'accounts',
            header: t.accountGroups.columns.accounts,
            cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
            size: 100,
        }),
        subgroupColumnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <div className="flex items-center justify-end gap-1">
                    <button
                        type="button"
                        onClick={() => onEdit(info.row.original)}
                        aria-label={t.common.edit}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
                    >
                        <Pencil className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(info.row.original)}
                        aria-label={t.common.delete}
                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            ),
            size: 90,
        }),
    ];
}

export default function AccountGroupsPage() {
    const { t } = useI18n();
    const [groups, setGroups] = useState<AccountGroup[]>([]);
    const [subgroups, setSubgroups] = useState<AccountSubgroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedGroupId, setSelectedGroupId] = useState('');

    const [groupFormOpen, setGroupFormOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<AccountGroup | null>(null);
    const [subgroupFormOpen, setSubgroupFormOpen] = useState(false);
    const [editingSubgroup, setEditingSubgroup] = useState<AccountSubgroup | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const [groupData, subgroupData] = await Promise.all([
                api.getAccountGroups(),
                api.getAccountSubgroups(),
            ]);
            setGroups(groupData);
            setSubgroups(subgroupData);
            // Keep a valid selection: fall back to the first group when the selected
            // one was just deleted, or on the very first load.
            setSelectedGroupId((current) => {
                if (current && groupData.some((group: AccountGroup) => group.id === current)) {
                    return current;
                }
                return groupData[0]?.id ?? '';
            });
        } catch (error: any) {
            toast.error(error?.message || t.accountGroups.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

    const groupsByType = useMemo(
        () =>
            ACCOUNT_TYPES.map((type) => ({
                type,
                items: groups.filter((group) => group.type === type),
            })).filter((section) => section.items.length > 0),
        [groups],
    );

    const visibleSubgroups = useMemo(
        () => subgroups.filter((subgroup) => subgroupGroupId(subgroup) === selectedGroupId),
        [subgroups, selectedGroupId],
    );

    const handleDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            if (pendingDelete.kind === 'group') {
                await api.deleteAccountGroup(pendingDelete.id);
                toast.success(t.accountGroups.groupDeleted);
            } else {
                await api.deleteAccountSubgroup(pendingDelete.id);
                toast.success(t.accountGroups.subgroupDeleted);
            }
            setPendingDelete(null);
            await load();
        } catch (error: any) {
            const fallback =
                pendingDelete.kind === 'group'
                    ? t.accountGroups.deleteGroupFailed
                    : t.accountGroups.deleteSubgroupFailed;
            toast.error(error?.message || fallback);
        } finally {
            setDeleting(false);
        }
    };

    const subgroupColumns = useMemo(
        () =>
            buildSubgroupColumns(
                t,
                (subgroup) => {
                    setEditingSubgroup(subgroup);
                    setSubgroupFormOpen(true);
                },
                (subgroup) =>
                    setPendingDelete({ kind: 'subgroup', id: subgroup.id, name: subgroup.name }),
            ),
        [t],
    );

    const deletePrompt = pendingDelete
        ? formatMessage(
              pendingDelete.kind === 'group'
                  ? t.accountGroups.deleteGroupConfirm
                  : t.accountGroups.deleteSubgroupConfirm,
              { name: pendingDelete.name },
          )
        : '';

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.accountGroups.title}
                subtitle={t.accountGroups.pageSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accountGroups.title,
                    'accounting',
                )}
                actions={(
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href={routes.accounting.coa}
                            className={`${compactDensity.btnSecondary} min-h-touch`}
                        >
                            <BookOpen className="h-4 w-4" />
                            {t.accountGroups.viewAccounts}
                        </Link>
                        <button
                            type="button"
                            disabled={groups.length === 0}
                            onClick={() => {
                                setEditingSubgroup(null);
                                setSubgroupFormOpen(true);
                            }}
                            className={`${compactDensity.btnSecondary} min-h-touch disabled:opacity-60`}
                        >
                            <Layers className="h-4 w-4" />
                            {t.accountGroups.newSubgroup}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingGroup(null);
                                setGroupFormOpen(true);
                            }}
                            className={`${compactDensity.btnPrimary} min-h-touch bg-blue-600 text-white hover:bg-blue-700`}
                        >
                            <Plus className="h-4 w-4" />
                            {t.accountGroups.newGroup}
                        </button>
                    </div>
                )}
            />

            <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
                <CompactSection className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
                    {(() => {
                        if (loading) {
                            return <p className="py-6 text-center text-sm text-gray-400">{t.common.loading}</p>;
                        }
                        if (groupsByType.length === 0) {
                            return (
                                <p className="py-6 text-center text-sm text-gray-400">
                                    {t.accountGroups.emptyGroups}
                                </p>
                            );
                        }
                        return (
                            <div className="space-y-4">
                                {groupsByType.map((section) => (
                                    <div key={section.type}>
                                        <p className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                                            {t.accountGroups.typeSections[section.type]}
                                        </p>
                                        <div className="space-y-1">
                                            {section.items.map((group) => (
                                                <GroupRailItem
                                                    key={group.id}
                                                    group={group}
                                                    selected={group.id === selectedGroupId}
                                                    meta={formatMessage(t.accountGroups.groupMeta, {
                                                        subgroups: group._count?.subgroups ?? 0,
                                                        accounts: group._count?.accounts ?? 0,
                                                    })}
                                                    editLabel={t.common.edit}
                                                    deleteLabel={t.common.delete}
                                                    onSelect={() => setSelectedGroupId(group.id)}
                                                    onEdit={() => {
                                                        setEditingGroup(group);
                                                        setGroupFormOpen(true);
                                                    }}
                                                    onDelete={() =>
                                                        setPendingDelete({
                                                            kind: 'group',
                                                            id: group.id,
                                                            name: group.name,
                                                        })
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </CompactSection>

                <div>
                    {selectedGroup ? (
                        <CompactSection
                            title={formatMessage(t.accountGroups.subgroupsIn, {
                                group: selectedGroup.name,
                            })}
                        >
                            <div className="mb-3 flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingSubgroup(null);
                                        setSubgroupFormOpen(true);
                                    }}
                                    className={`${compactDensity.btnSecondary} min-h-touch`}
                                >
                                    <Plus className="h-4 w-4" />
                                    {t.accountGroups.addSubgroup}
                                </button>
                            </div>

                            <DataTable<AccountSubgroup>
                                tableId="accounting-account-subgroups"
                                columns={subgroupColumns}
                                data={visibleSubgroups}
                                title={t.accountGroups.title}
                                isLoading={loading}
                                emptyMessage={t.accountGroups.emptySubgroups}
                                emptyIcon={<Layers className="h-10 w-10 text-gray-200" />}
                                searchPlaceholder={t.accountGroups.searchSubgroups}
                            />
                        </CompactSection>
                    ) : (
                        <CompactSection className="py-10 text-center">
                            <FolderTree className="mx-auto mb-2 h-10 w-10 text-gray-200" />
                            <p className="text-sm text-gray-400">
                                {loading ? t.common.loading : t.accountGroups.selectGroupPrompt}
                            </p>
                        </CompactSection>
                    )}
                </div>
            </div>

            {groupFormOpen ? (
                <GroupFormModal
                    group={editingGroup}
                    onClose={() => {
                        setEditingGroup(null);
                        setGroupFormOpen(false);
                    }}
                    onSaved={async (savedId) => {
                        setEditingGroup(null);
                        setGroupFormOpen(false);
                        setSelectedGroupId(savedId);
                        await load();
                    }}
                />
            ) : null}

            {subgroupFormOpen ? (
                <SubgroupFormModal
                    subgroup={editingSubgroup}
                    groups={groups}
                    defaultGroupId={selectedGroupId}
                    onClose={() => {
                        setEditingSubgroup(null);
                        setSubgroupFormOpen(false);
                    }}
                    onSaved={async (groupId) => {
                        setEditingSubgroup(null);
                        setSubgroupFormOpen(false);
                        setSelectedGroupId(groupId);
                        await load();
                    }}
                />
            ) : null}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={deletePrompt}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => setPendingDelete(null)}
            />
        </AccountingPageShell>
    );
}

function GroupRailItem({
    group,
    selected,
    meta,
    editLabel,
    deleteLabel,
    onSelect,
    onEdit,
    onDelete,
}: Readonly<{
    group: AccountGroup;
    selected: boolean;
    meta: string;
    editLabel: string;
    deleteLabel: string;
    onSelect: () => void;
    onEdit: () => void;
    onDelete: () => void;
}>) {
    return (
        <div
            className={`flex items-center gap-1 rounded-lg border transition-colors ${
                selected
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
            }`}
        >
            <button
                type="button"
                onClick={onSelect}
                aria-current={selected ? 'true' : undefined}
                className="min-h-touch min-w-0 flex-1 px-3 py-2 text-left"
            >
                <span
                    className={`block truncate text-sm font-semibold ${
                        selected ? 'text-blue-900' : 'text-gray-900'
                    }`}
                >
                    <span className="mr-1.5 font-mono text-xs font-normal text-gray-400">
                        {group.code}
                    </span>
                    {group.name}
                </span>
                <span className={`block text-xs ${selected ? 'text-blue-700' : 'text-gray-500'}`}>
                    {meta}
                </span>
            </button>
            <div className="flex items-center gap-0.5 pr-1.5">
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label={`${editLabel} — ${group.name}`}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-white"
                >
                    <Pencil className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    aria-label={`${deleteLabel} — ${group.name}`}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

function GroupFormModal({
    group,
    onClose,
    onSaved,
}: Readonly<{
    group: AccountGroup | null;
    onClose: () => void;
    onSaved: (savedId: string) => Promise<void> | void;
}>) {
    const { t } = useI18n();
    const [name, setName] = useState(group?.name ?? '');
    const [type, setType] = useState<AccountType>(group?.type ?? 'asset');
    const [code, setCode] = useState(group?.code ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    /**
     * Suggest the next free code for the chosen type. Only on create: a group's
     * code is its accounts' prefix, so re-coding one would strand every account
     * beneath it — the API rejects the attempt outright.
     */
    useEffect(() => {
        if (group) return;

        let cancelled = false;
        api.getNextAccountGroupCode(type)
            .then((result: { code: string }) => {
                if (!cancelled) setCode(result.code);
            })
            .catch(() => {
                // A suggestion is a convenience; the server allocates on its own.
            });

        return () => {
            cancelled = true;
        };
    }, [group, type]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');

        try {
            if (group) {
                // The API accepts a rename only — see UpdateAccountGroupDto.
                const saved = await api.updateAccountGroup(group.id, { name: name.trim() });
                toast.success(t.accountGroups.groupUpdated);
                await onSaved(saved?.id ?? group.id);
            } else {
                const saved = await api.createAccountGroup({
                    name: name.trim(),
                    type,
                    code: code.trim() || undefined,
                });
                toast.success(t.accountGroups.groupCreated);
                await onSaved(saved?.id ?? '');
            }
        } catch (submitError: any) {
            setError(
                submitError?.message ||
                    (group ? t.accountGroups.saveGroupFailed : t.accountGroups.createGroupFailed),
            );
        } finally {
            setSaving(false);
        }
    };

    let submitLabel: string;
    if (saving) {
        submitLabel = group ? t.accountGroups.saving : t.accountGroups.creating;
    } else {
        submitLabel = group ? t.accountGroups.updateGroup : t.accountGroups.createGroup;
    }

    return (
        <ModalShell size="sm" onBackdropClick={saving ? undefined : onClose}>
            <ModalHeader
                title={group ? t.accountGroups.editGroup : t.accountGroups.newGroup}
                subtitle={group?.name}
                onClose={saving ? undefined : onClose}
                closeLabel={t.common.close}
            />

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {error ? (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    ) : null}

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.groupCode}
                        </span>
                        <input
                            aria-label={t.accountGroups.groupCode}
                            value={code}
                            onChange={(event) => setCode(event.target.value.toUpperCase())}
                            maxLength={2}
                            disabled={group !== null}
                            className={`${compactDensity.formField} font-mono disabled:opacity-60`}
                            placeholder="11"
                        />
                        <span className="mt-1 block text-xs text-gray-400">
                            {group ? t.accountGroups.codeLocked : t.accountGroups.codeHint}
                        </span>
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.groupName}
                        </span>
                        <input
                            aria-label={t.accountGroups.groupName}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                            className={compactDensity.formField}
                            placeholder={t.accountGroups.currentAssets}
                        />
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.groupType}
                        </span>
                        <select
                            aria-label={t.accountGroups.groupType}
                            value={type}
                            onChange={(event) => setType(event.target.value as AccountType)}
                            disabled={group !== null}
                            className={`${compactDensity.formField} disabled:opacity-60`}
                        >
                            {ACCOUNT_TYPES.map((option) => (
                                <option key={option} value={option}>
                                    {t.accountingShared.accountTypes[option]}
                                </option>
                            ))}
                        </select>
                        {group ? (
                            <span className="mt-1 block text-xs text-gray-400">
                                {t.accountGroups.typeLocked}
                            </span>
                        ) : null}
                    </label>
                </div>

                <ModalFooter>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className={`${compactDensity.btnSecondary} min-h-touch disabled:opacity-60`}
                    >
                        {t.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !name.trim()}
                        className={`${compactDensity.btnPrimary} min-h-touch bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60`}
                    >
                        {submitLabel}
                    </button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

function SubgroupFormModal({
    subgroup,
    groups,
    defaultGroupId,
    onClose,
    onSaved,
}: Readonly<{
    subgroup: AccountSubgroup | null;
    groups: AccountGroup[];
    defaultGroupId: string;
    onClose: () => void;
    onSaved: (groupId: string) => Promise<void> | void;
}>) {
    const { t } = useI18n();
    const [groupId, setGroupId] = useState(
        subgroup ? subgroupGroupId(subgroup) : defaultGroupId,
    );
    const [name, setName] = useState(subgroup?.name ?? '');
    const [code, setCode] = useState(subgroup?.code ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    /**
     * Suggest the next free code under the chosen group. Only on create — a
     * subgroup's code prefixes its accounts', so it is fixed once allocated.
     */
    useEffect(() => {
        if (subgroup || !groupId) return;

        let cancelled = false;
        api.getNextAccountSubgroupCode(groupId)
            .then((result: { code: string }) => {
                if (!cancelled) setCode(result.code);
            })
            .catch(() => {
                // A suggestion is a convenience; the server allocates on its own.
            });

        return () => {
            cancelled = true;
        };
    }, [subgroup, groupId]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');

        try {
            if (subgroup) {
                // The API accepts a rename only — re-parenting would strand the
                // subgroup's accounts under a group that no longer owns it.
                await api.updateAccountSubgroup(subgroup.id, { name: name.trim() });
                toast.success(t.accountGroups.subgroupUpdated);
                await onSaved(subgroupGroupId(subgroup));
            } else {
                await api.createAccountSubgroup({
                    groupId,
                    name: name.trim(),
                    code: code.trim() || undefined,
                });
                toast.success(t.accountGroups.subgroupCreated);
                await onSaved(groupId);
            }
        } catch (submitError: any) {
            setError(
                submitError?.message ||
                    (subgroup
                        ? t.accountGroups.saveSubgroupFailed
                        : t.accountGroups.createSubgroupFailed),
            );
        } finally {
            setSaving(false);
        }
    };

    let submitLabel: string;
    if (saving) {
        submitLabel = subgroup ? t.accountGroups.saving : t.accountGroups.creating;
    } else {
        submitLabel = subgroup ? t.accountGroups.updateSubgroup : t.accountGroups.createSubgroup;
    }

    return (
        <ModalShell size="sm" onBackdropClick={saving ? undefined : onClose}>
            <ModalHeader
                title={subgroup ? t.accountGroups.editSubgroup : t.accountGroups.newSubgroup}
                subtitle={subgroup?.name}
                onClose={saving ? undefined : onClose}
                closeLabel={t.common.close}
            />

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {error ? (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    ) : null}

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.subgroupCode}
                        </span>
                        <input
                            aria-label={t.accountGroups.subgroupCode}
                            value={code}
                            onChange={(event) => setCode(event.target.value.toUpperCase())}
                            maxLength={4}
                            disabled={subgroup !== null || !groupId}
                            className={`${compactDensity.formField} font-mono disabled:opacity-60`}
                            placeholder="1101"
                        />
                        <span className="mt-1 block text-xs text-gray-400">
                            {subgroup ? t.accountGroups.codeLocked : t.accountGroups.subgroupCodeHint}
                        </span>
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.parentGroup}
                        </span>
                        <select
                            aria-label={t.accountGroups.parentGroup}
                            value={groupId}
                            onChange={(event) => setGroupId(event.target.value)}
                            required
                            disabled={subgroup !== null}
                            className={`${compactDensity.formField} disabled:opacity-60`}
                        >
                            <option value="">{t.accountGroups.selectGroup}</option>
                            {groups.map((group) => (
                                <option key={group.id} value={group.id}>
                                    {group.code ? `${group.code} — ` : ''}{group.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.accountGroups.subgroupName}
                        </span>
                        <input
                            aria-label={t.accountGroups.subgroupName}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                            className={compactDensity.formField}
                            placeholder={t.accountGroups.cashAndBank}
                        />
                    </label>
                </div>

                <ModalFooter>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className={`${compactDensity.btnSecondary} min-h-touch disabled:opacity-60`}
                    >
                        {t.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !name.trim() || !groupId}
                        className={`${compactDensity.btnPrimary} min-h-touch bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60`}
                    >
                        {submitLabel}
                    </button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
