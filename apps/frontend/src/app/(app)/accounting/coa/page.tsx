'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import AccountFormModal, {
    ACCOUNT_CATEGORIES,
    ACCOUNT_TYPES,
    subgroupGroupId,
    type Account,
    type AccountGroup,
    type AccountSubgroup,
} from '@/components/accounting/AccountFormModal';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { COA_FIELD_HELP, COA_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages/types';
import { compactDensity } from '@/lib/ui/compact-density';

const columnHelper = createColumnHelper<Account>();

function AccountNameCell({ account, noCode }: { readonly account: Account; readonly noCode: string }) {
    return (
        <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-900">{account.name}</span>
            <span className="block font-mono text-xs text-gray-400 sm:hidden">
                {account.code || noCode}
            </span>
        </div>
    );
}

function ActionsCell({
    onEdit,
    onDelete,
    editLabel,
    deleteLabel,
}: Readonly<{ onEdit: () => void; onDelete: () => void; editLabel: string; deleteLabel: string }>) {
    return (
        <div className="flex items-center justify-end gap-1">
            <button
                type="button"
                onClick={onEdit}
                aria-label={editLabel}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            >
                <Pencil className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={onDelete}
                aria-label={deleteLabel}
                className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    );
}

function buildColumns(
    t: MessageDictionary,
    onEdit: (account: Account) => void,
    onDelete: (account: Account) => void,
): ColumnDef<Account, any>[] {
    return [
        columnHelper.accessor((row) => row.code ?? '', {
            id: 'code',
            header: t.coa.columns.code,
            cell: (info) => (
                <span className="font-mono text-xs text-gray-500">{info.getValue() || '—'}</span>
            ),
            size: 90,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('name', {
            header: t.coa.columns.account,
            cell: (info) => <AccountNameCell account={info.row.original} noCode={t.coa.noCode} />,
            size: 240,
        }),
        columnHelper.accessor('type', {
            header: t.coa.columns.type,
            cell: (info) => (
                <StatusBadge tone="info">
                    {t.accountingShared.accountTypes[info.getValue()]}
                </StatusBadge>
            ),
            size: 110,
        }),
        columnHelper.accessor('category', {
            header: t.coa.columns.category,
            cell: (info) => (
                <StatusBadge tone="neutral">
                    {t.accountingShared.accountCategories[info.getValue()]}
                </StatusBadge>
            ),
            size: 110,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.group?.name ?? '—', {
            id: 'group',
            header: t.coa.columns.group,
            cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
            size: 170,
        }),
        columnHelper.accessor((row) => row.subgroup?.name ?? t.coa.unassigned, {
            id: 'subgroup',
            header: t.coa.columns.subgroup,
            cell: (info) => <span className="text-sm text-gray-500">{info.getValue()}</span>,
            size: 170,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <ActionsCell
                    onEdit={() => onEdit(info.row.original)}
                    onDelete={() => onDelete(info.row.original)}
                    editLabel={t.common.edit}
                    deleteLabel={t.common.delete}
                />
            ),
            size: 90,
        }),
    ];
}

export default function ChartOfAccountsPage() {
    const { t } = useI18n();
    const [groups, setGroups] = useState<AccountGroup[]>([]);
    const [subgroups, setSubgroups] = useState<AccountSubgroup[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);

    const [groupFilter, setGroupFilter] = useState('');
    const [subgroupFilter, setSubgroupFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Account | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        void loadReferenceData();
    }, []);

    useEffect(() => {
        void loadAccounts();
    }, [groupFilter, typeFilter, categoryFilter]);

    // The subgroup filter is client-side: the accounts endpoint has no subgroupId param.
    useEffect(() => {
        setSubgroupFilter((current) => {
            if (!current) return current;
            const stillValid = subgroups.some(
                (subgroup) => subgroup.id === current && (!groupFilter || subgroupGroupId(subgroup) === groupFilter),
            );
            return stillValid ? current : '';
        });
    }, [groupFilter, subgroups]);

    const loadReferenceData = async () => {
        try {
            const [groupData, subgroupData] = await Promise.all([
                api.getAccountGroups(),
                api.getAccountSubgroups(),
            ]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error(t.coa.loadReferenceFailed, error);
        }
    };

    const loadAccounts = async () => {
        try {
            const accountData = await api.getAccounts({
                groupId: groupFilter || undefined,
                type: typeFilter || undefined,
                category: categoryFilter || undefined,
            });
            setAccounts(accountData);
        } catch (error) {
            console.error(t.coa.loadAccountsFailed, error);
        } finally {
            setLoading(false);
        }
    };

    const refreshAll = async () => {
        setLoading(true);
        await Promise.all([loadReferenceData(), loadAccounts()]);
        setLoading(false);
    };

    const handleDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteAccount(pendingDelete.id);
            toast.success(t.coa.accountDeleted);
            setPendingDelete(null);
            await refreshAll();
        } catch (error: any) {
            toast.error(error?.message || t.coa.deleteAccountFailed);
        } finally {
            setDeleting(false);
        }
    };

    const filterSubgroups = useMemo(
        () => subgroups.filter((subgroup) => !groupFilter || subgroupGroupId(subgroup) === groupFilter),
        [subgroups, groupFilter],
    );

    const visibleAccounts = useMemo(
        () => (subgroupFilter ? accounts.filter((account) => account.subgroup?.id === subgroupFilter) : accounts),
        [accounts, subgroupFilter],
    );

    const columns = useMemo(
        () =>
            buildColumns(
                t,
                (account) => {
                    setEditing(account);
                    setFormOpen(true);
                },
                (account) => setPendingDelete(account),
            ),
        [t],
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.coa.title}
                subtitle={t.coa.pageSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.coa.title,
                    'accounting',
                )}
                actions={(
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href={routes.accounting.accountGroups}
                            className={`${compactDensity.btnSecondary} min-h-touch`}
                        >
                            <FolderTree className="h-4 w-4" />
                            {t.coa.manageGroups}
                        </Link>
                        <button
                            type="button"
                            onClick={() => {
                                setEditing(null);
                                setFormOpen(true);
                            }}
                            className={`${compactDensity.btnPrimary} min-h-touch bg-blue-600 text-white hover:bg-blue-700`}
                        >
                            <Plus className="h-4 w-4" />
                            {t.coa.newAccount}
                        </button>
                    </div>
                )}
            />
            <AccountingToolbar help={COA_FIELD_HELP.page} />

            <ContextualHelpPanel {...COA_HELP} />

            <CompactSection>
                <div className={`${compactDensity.filterBar} mb-3`}>
                    <FilterSelect
                        label={t.coa.filterByGroup}
                        value={groupFilter}
                        onChange={setGroupFilter}
                        allLabel={t.common.all}
                        options={groups.map((group) => ({ value: group.id, label: group.name }))}
                    />
                    <FilterSelect
                        label={t.coa.filterBySubgroup}
                        value={subgroupFilter}
                        onChange={setSubgroupFilter}
                        allLabel={t.common.all}
                        options={filterSubgroups.map((subgroup) => ({
                            value: subgroup.id,
                            label: subgroup.name,
                        }))}
                    />
                    <FilterSelect
                        label={t.coa.filterByType}
                        value={typeFilter}
                        onChange={setTypeFilter}
                        allLabel={t.common.all}
                        options={ACCOUNT_TYPES.map((type) => ({
                            value: type,
                            label: t.accountingShared.accountTypes[type],
                        }))}
                        helpText={COA_FIELD_HELP.accountType}
                    />
                    <FilterSelect
                        label={t.coa.filterByCategory}
                        value={categoryFilter}
                        onChange={setCategoryFilter}
                        allLabel={t.common.all}
                        options={ACCOUNT_CATEGORIES.map((category) => ({
                            value: category,
                            label: t.accountingShared.accountCategories[category],
                        }))}
                        helpText={COA_FIELD_HELP.accountCategory}
                    />
                </div>

                <DataTable<Account>
                    tableId="accounting-coa-accounts"
                    columns={columns}
                    data={visibleAccounts}
                    title={t.coa.title}
                    isLoading={loading}
                    emptyMessage={t.coa.emptyMessage}
                    emptyIcon={<BookOpen className="h-10 w-10 text-gray-200" />}
                    searchPlaceholder={t.coa.searchPlaceholder}
                />
            </CompactSection>

            {formOpen ? (
                <AccountFormModal
                    account={editing}
                    groups={groups}
                    subgroups={subgroups}
                    onClose={() => {
                        setEditing(null);
                        setFormOpen(false);
                    }}
                    onSaved={async () => {
                        setEditing(null);
                        setFormOpen(false);
                        await refreshAll();
                    }}
                />
            ) : null}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={formatMessage(t.coa.deleteAccountConfirm, { name: pendingDelete?.name ?? '' })}
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

function FilterSelect({
    label,
    value,
    onChange,
    options,
    allLabel,
    helpText,
}: Readonly<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    allLabel: string;
    helpText?: string;
}>) {
    return (
        <div className="space-y-1">
            <span className={`${compactDensity.formLabel} inline-flex items-center gap-1.5`}>
                {label}
                {helpText ? <HelpTooltip text={helpText} side="top" /> : null}
            </span>
            <select
                aria-label={label}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={`${compactDensity.formField} min-w-[160px]`}
            >
                <option value="">{allLabel}</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
