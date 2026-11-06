'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import { api, type VoucherListFilterParams, type VoucherListSummary } from '@/lib/api';
import { BranchFilter } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toPaginated, useVoucherListFilters, useVoucherSummaryStats, voucherTypeLabel } from '../vouchers/voucher-list-filters';

type JournalEntry = {
    id: string;
    voucher_number: string;
    voucher_type: string;
    description?: string | null;
    date: string;
    total_amount: number;
};

const columnHelper = createColumnHelper<JournalEntry>();

/**
 * The journal: every voucher, newest first, as one compact feed. The same
 * vouchers and filters as the voucher list, without its approval and edit
 * actions — a row opens the voucher.
 */
export default function AccountingJournalPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const { search, setSearch, filterParams, filters } = useVoucherListFilters();

    const scopedParams = useMemo<VoucherListFilterParams>(
        () => ({ ...filterParams, storeId: branch.apiStoreId }),
        [filterParams, branch.apiStoreId],
    );

    const { items, loading, error, serverPagination } = useServerList<JournalEntry>({
        tableId: 'accounting-journal',
        initialPageSize: 30,
        initialSort: { id: 'date', desc: true },
        deps: [scopedParams],
        enabled: branch.ready,
        fetch: async (params) => toPaginated<JournalEntry>(await api.getVouchers({ ...params, ...scopedParams })),
    });
    useBranchForbiddenReset(error, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading } = useListSummary<VoucherListFilterParams, VoucherListSummary>({
        fetch: api.getVouchersSummary,
        params: scopedParams,
        enabled: branch.ready,
    });
    const stats = useVoucherSummaryStats(summary, summaryLoading, t.accountingVouchersUi.stats.journalLabel);

    const columns: ColumnDef<JournalEntry, any>[] = useMemo(
        () => [
            columnHelper.accessor('voucher_number', {
                header: t.journal.columns.voucherNumber,
                cell: (info) => (
                    <Link
                        href={`/accounting/vouchers/${info.row.original.id}`}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 130,
            }),
            columnHelper.accessor('date', {
                header: t.journal.columns.date,
                cell: (info) => formatDate(info.getValue(), locale),
                size: 110,
            }),
            columnHelper.accessor('voucher_type', {
                header: t.journal.columns.type,
                cell: (info) => voucherTypeLabel(t, info.getValue()),
                size: 130,
            }),
            columnHelper.accessor('description', {
                header: t.journal.columns.description,
                enableSorting: false,
                cell: (info) => {
                    const narration = info.getValue();
                    return (
                        <span className="block max-w-[28rem] truncate text-gray-600" title={narration || undefined}>
                            {narration || t.accountingShared.noNarration}
                        </span>
                    );
                },
                size: 280,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.journal.columns.amount,
                // The sum of the voucher's lines, not a stored column the server can sort.
                enableSorting: false,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
        ],
        [t, locale],
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.journal.title}
                subtitle={t.journal.compactSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.journal.title,
                    'accounting',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<JournalEntry>
                tableId="accounting-journal"
                columns={columns}
                data={items}
                title={t.journal.accountingJournal}
                isLoading={loading}
                emptyMessage={t.journal.emptyMessage}
                emptyIcon={<ClipboardList className="w-10 h-10 text-gray-200" />}
                searchPlaceholder={t.accountingVouchersUi.common.searchVouchers}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />
        </AccountingPageShell>
    );
}
