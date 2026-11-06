'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
    BookOpen,
    Building,
    FolderTree,
    Landmark,
    Pencil,
    Plus,
    Scale,
    Trash2,
    TrendingDown,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { AccountingPageShell, AccountingToolbar } from '@/components/accounting/compact';
import AccountFormModal, {
    ACCOUNT_CATEGORIES,
    ACCOUNT_TYPES,
    subgroupGroupId,
    type Account,
    type AccountGroup,
    type AccountSubgroup,
    type AccountCategory,
    type AccountType,
} from '@/components/accounting/AccountFormModal';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, Button, buttonClassName, ConfirmDialog, StatusBadge } from '@/components/ui';
import { useBranchScope } from '@/lib/branch-scope';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { COA_FIELD_HELP, COA_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages/types';

const columnHelper = createColumnHelper<Account>();

/** The subgroup chip's value for an account that hangs straight off its group. */
const NONE = '__none__';
const SIDES = ['debit', 'credit', 'neutral'] as const;

/** Assets and expenses sit on the debit side; the rest on the credit side. */
const NATURAL_DEBIT = new Set<AccountType>(['asset', 'expense']);

const TYPE_ICONS: Record<AccountType, ReactNode> = {
    asset: <Wallet aria-hidden />,
    liability: <Landmark aria-hidden />,
    equity: <Building aria-hidden />,
    revenue: <TrendingUp aria-hidden />,
    expense: <TrendingDown aria-hidden />,
};

const sideOf = (account: Account) => account.balance_side ?? 'neutral';

/** The balance on the side the account's type normally sits — a contra balance counts against it. */
function naturalBalance(account: Account): number {
    const amount = account.balance ?? 0;
    const side = sideOf(account);
    if (side === 'neutral' || amount === 0) return 0;
    const onDebit = side === 'debit';
    return onDebit === NATURAL_DEBIT.has(account.type) ? amount : -amount;
}

function AccountBalanceCell({
    account,
    locale,
    debitLabel,
    creditLabel,
}: Readonly<{ account: Account; locale: string; debitLabel: string; creditLabel: string }>) {
    const sideLabels: Record<string, string> = { debit: debitLabel, credit: creditLabel };
    const sideLabel = sideLabels[sideOf(account)] ?? null;

    return (
        <div className="text-end">
            <span className="block tabular-nums">{formatBDT(account.balance ?? 0, { locale })}</span>
            {sideLabel ? <span className="block text-xs text-gray-500">{sideLabel}</span> : null}
        </div>
    );
}

function buildColumns(
    t: MessageDictionary,
    locale: string,
    onEdit: (account: Account) => void,
    onDelete: (account: Account) => void,
): ColumnDef<Account, any>[] {
    return [
        columnHelper.accessor((row) => row.code ?? '', {
            id: 'code',
            header: t.coa.columns.code,
            cell: (info) => <span className="font-mono text-gray-500">{info.getValue() || '—'}</span>,
            size: 90,
        }),
        columnHelper.accessor('name', {
            header: t.coa.columns.account,
            cell: (info) => <span className="block truncate text-gray-900">{info.getValue()}</span>,
            size: 240,
        }),
        columnHelper.accessor('type', {
            header: t.coa.columns.type,
            cell: (info) => (
                <StatusBadge tone="info">{t.accountingShared.accountTypes[info.getValue() as AccountType]}</StatusBadge>
            ),
            size: 110,
        }),
        columnHelper.accessor('category', {
            header: t.coa.columns.category,
            cell: (info) => (
                <StatusBadge tone="neutral">
                    {t.accountingMastersUi.coa.categories[info.getValue() as AccountCategory]}
                </StatusBadge>
            ),
            size: 110,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.group?.name ?? '—', {
            id: 'group',
            header: t.coa.columns.group,
            cell: (info) => <span className="text-gray-700">{info.getValue()}</span>,
            size: 170,
        }),
        columnHelper.accessor((row) => row.subgroup?.name ?? t.coa.unassigned, {
            id: 'subgroup',
            header: t.coa.columns.subgroup,
            cell: (info) => <span className="text-gray-500">{info.getValue()}</span>,
            size: 170,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.balance ?? 0, {
            id: 'balance',
            header: t.coa.columns.balance,
            cell: (info) => (
                <AccountBalanceCell
                    account={info.row.original}
                    locale={locale}
                    debitLabel={t.accountingShared.debit}
                    creditLabel={t.accountingShared.credit}
                />
            ),
            size: 130,
            meta: { align: 'end' },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <RowActions>
                    <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => onEdit(info.row.original)} />
                    <RowActionButton
                        icon={<Trash2 />}
                        label={t.common.delete}
                        intent="danger"
                        onClick={() => onDelete(info.row.original)}
                    />
                </RowActions>
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
    ];
}

export default function ChartOfAccountsPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.accountingMastersUi.coa;
    const branch = useBranchScope();
    const [groups, setGroups] = useState<AccountGroup[]>([]);
    const [subgroups, setSubgroups] = useState<AccountSubgroup[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<string[]>([]);
    const [typeExclude, setTypeExclude] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
    const [groupFilter, setGroupFilter] = useState<string[]>([]);
    const [subgroupFilter, setSubgroupFilter] = useState<string[]>([]);
    const [balanceFilter, setBalanceFilter] = useState<NumberCondition | null>(null);
    const [sideFilter, setSideFilter] = useState<string[]>([]);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Account | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        void loadReferenceData();
        // Reference data is loaded once; the loader reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Every chip filters the loaded accounts, so only the branch asks the server again.
    useEffect(() => {
        if (!branch.ready) return;
        void loadAccounts();
        // loadAccounts reads the branch from this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    // A subgroup chosen under a group that is no longer chosen drops out of the chip.
    useEffect(() => {
        if (groupFilter.length === 0) return;
        setSubgroupFilter((current) => {
            const next = current.filter(
                (id) => id === NONE || subgroups.some((s) => s.id === id && groupFilter.includes(subgroupGroupId(s))),
            );
            return next.length === current.length ? current : next;
        });
    }, [groupFilter, subgroups]);

    const loadReferenceData = async () => {
        try {
            const [groupData, subgroupData] = await Promise.all([api.getAccountGroups(), api.getAccountSubgroups()]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error(t.coa.loadReferenceFailed, error);
        }
    };

    const loadAccounts = async () => {
        try {
            const accountData = await api.getAccounts({ storeId: branch.apiStoreId });
            setAccounts(Array.isArray(accountData) ? accountData : []);
        } catch (error) {
            console.error(t.coa.loadAccountsFailed, error);
            toast.error(t.coa.loadAccountsFailed);
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

    const visibleAccounts = useMemo(
        () =>
            accounts.filter((account) => {
                if (!matchesAnyOf(typeFilter, account.type, typeExclude)) return false;
                if (!matchesAnyOf(categoryFilter, account.category)) return false;
                if (!matchesAnyOf(groupFilter, account.group?.id)) return false;
                if (!matchesAnyOf(subgroupFilter, account.subgroup?.id ?? NONE)) return false;
                if (!matchesAnyOf(sideFilter, sideOf(account))) return false;
                if (!matchesNumberCondition(account.balance ?? 0, balanceFilter)) return false;
                return matchesSearch(
                    search,
                    account.code,
                    account.legacy_code,
                    account.name,
                    account.group?.name,
                    account.subgroup?.name,
                );
            }),
        [accounts, typeFilter, typeExclude, categoryFilter, groupFilter, subgroupFilter, sideFilter, balanceFilter, search],
    );

    const filters = useMemo<ListFilter[]>(() => {
        const subgroupOptions = subgroups
            .filter((s) => groupFilter.length === 0 || groupFilter.includes(subgroupGroupId(s)))
            .map((s) => ({ value: s.id, label: s.code ? `${s.code} · ${s.name}` : s.name }));
        return [
            {
                id: 'type',
                type: 'multi-select',
                label: t.coa.columns.type,
                value: typeFilter,
                onChange: setTypeFilter,
                exclude: { value: typeExclude, onChange: setTypeExclude },
                options: ACCOUNT_TYPES.map((type) => ({ value: type, label: t.accountGroups.typeSections[type] })),
            },
            {
                id: 'category',
                type: 'multi-select',
                label: t.coa.columns.category,
                value: categoryFilter,
                onChange: setCategoryFilter,
                options: ACCOUNT_CATEGORIES.map((category) => ({ value: category, label: m.categories[category] })),
            },
            {
                id: 'group',
                type: 'multi-select',
                label: t.coa.columns.group,
                value: groupFilter,
                onChange: setGroupFilter,
                options: groups.map((group) => ({ value: group.id, label: group.code ? `${group.code} · ${group.name}` : group.name })),
            },
            {
                id: 'balance',
                type: 'number',
                label: t.coa.columns.balance,
                value: balanceFilter,
                onChange: setBalanceFilter,
                money: true,
            },
            {
                id: 'subgroup',
                type: 'multi-select',
                label: t.coa.columns.subgroup,
                value: subgroupFilter,
                onChange: setSubgroupFilter,
                options: [{ value: NONE, label: t.coa.unassigned }, ...subgroupOptions],
                more: true,
            },
            {
                id: 'side',
                type: 'multi-select',
                label: m.balanceSide,
                value: sideFilter,
                onChange: setSideFilter,
                options: SIDES.map((side) => ({
                    value: side,
                    label: side === 'debit' ? t.accountingShared.debit : side === 'credit' ? t.accountingShared.credit : m.zeroBalance,
                })),
                more: true,
            },
        ];
    }, [t, m, groups, subgroups, typeFilter, typeExclude, categoryFilter, groupFilter, subgroupFilter, balanceFilter, sideFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const withBalance = visibleAccounts.filter((a) => (a.balance ?? 0) !== 0 && sideOf(a) !== 'neutral').length;
        const items: ListStat[] = [
            {
                id: 'accounts',
                icon: <BookOpen aria-hidden />,
                label: m.accounts,
                value: n(visibleAccounts.length),
                hint: fmt(m.withBalance, { count: n(withBalance) }),
            },
            ...ACCOUNT_TYPES.map((type): ListStat => {
                const ofType = visibleAccounts.filter((a) => a.type === type);
                return {
                    id: type,
                    icon: TYPE_ICONS[type],
                    label: t.accountGroups.typeSections[type],
                    value: money(ofType.reduce((sum, a) => sum + naturalBalance(a), 0)),
                    hint: fmt(m.accountsCount, { count: n(ofType.length) }),
                };
            }),
        ];
        return { items, loading, label: m.statsLabel };
    }, [visibleAccounts, loading, locale, m, t, fmt]);

    const columns = useMemo(
        () =>
            buildColumns(
                t,
                locale,
                (account) => {
                    setEditing(account);
                    setFormOpen(true);
                },
                (account) => setPendingDelete(account),
            ),
        [t, locale],
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
                    <>
                        <BranchFilter scope={branch} />
                        <Link href={routes.accounting.accountGroups} className={buttonClassName({ variant: 'secondary' })}>
                            <FolderTree className="h-4 w-4" />
                            {t.coa.manageGroups}
                        </Link>
                        <Button
                            variant="primary"
                            icon={<Plus className="h-4 w-4" />}
                            onClick={() => {
                                setEditing(null);
                                setFormOpen(true);
                            }}
                        >
                            {t.coa.newAccount}
                        </Button>
                    </>
                )}
            />
            <AccountingToolbar help={COA_FIELD_HELP.page} />

            <ContextualHelpPanel {...COA_HELP} />

            <DataTable<Account>
                tableId="accounting-coa-accounts"
                columns={columns}
                data={visibleAccounts}
                title={t.coa.title}
                isLoading={loading}
                emptyMessage={t.coa.emptyMessage}
                emptyIcon={<Scale className="h-10 w-10 text-gray-200" />}
                searchPlaceholder={t.coa.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.id}
            />

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
