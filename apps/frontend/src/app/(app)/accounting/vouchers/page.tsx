'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Copy, Eye, FileText, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { DataTable, createdAtColumn } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api, type VoucherListFilterParams, type VoucherListSummary } from '@/lib/api';
import { BranchFilter, Button, ConfirmDialog, Field, Textarea, buttonClassName } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { fetchMe } from '@/hooks/use-me';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { sheetPaper } from '@/lib/print';
import { resolvePrintPaper } from '@/lib/hooks/useSalePrintPrefs';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { printVoucher } from '@/lib/voucher-printer';
import { hasPermission, isOwner } from '@/lib/permissions';
import { VoucherApprovalBadge } from '@/components/accounting/VoucherApprovalBadge';
import { toast } from '@/lib/toast';
import { notifyVoucherApprovalChanged } from '@/hooks/usePendingVoucherCount';
import { getWorkspaceItem } from '@/lib/session-store';
import { toPaginated, useVoucherListFilters, useVoucherSummaryStats, voucherTypeLabel } from './voucher-list-filters';

type VoucherRow = {
    id: string;
    voucher_number: string;
    voucher_type: string;
    reference_number?: string | null;
    description?: string | null;
    date: string;
    created_at: string;
    total_amount: number;
    approval_status?: string | null;
    source?: { module: string | null; type: string | null; id: string | null };
};

/** Who a rejection is for: one row's action, or the pending rows of a selection. */
type RejectTarget = { rows: VoucherRow[]; single: boolean };

const columnHelper = createColumnHelper<VoucherRow>();

function VouchersListLoading() {
    const { t } = useI18n();
    return <div className="p-4 text-sm text-gray-500">{t.vouchers.loading}</div>;
}

export default function AccountingVouchersListPage() {
    return (
        <Suspense fallback={<VouchersListLoading />}>
            <AccountingVouchersListPageContent />
        </Suspense>
    );
}

function AccountingVouchersListPageContent() {
    const { t, locale, fmt } = useI18n();
    const copy = t.accountingVouchersUi;
    const branch = useBranchScope();
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('VOUCHER');
    const router = useRouter();
    const searchParams = useSearchParams();
    const [canApprove, setCanApprove] = useState(false);
    const [bulkWorking, setBulkWorking] = useState(false);
    const [clearSelection, setClearSelection] = useState(0);
    const [deleteTarget, setDeleteTarget] = useState<VoucherRow | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejecting, setRejecting] = useState(false);

    // `?approvalStatus=PENDING` turns this page into the approval queue, which is
    // what the sidebar/settings copy points at rather than a second list page.
    const [initialApproval] = useState(() =>
        (searchParams.get('approvalStatus') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    );
    const { search, setSearch, filterParams, filters } = useVoucherListFilters({ initialApprovalStatus: initialApproval });

    const createdVoucherNumber = searchParams.get('voucher');

    useEffect(() => {
        fetchMe()
            .then((me) => {
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === getWorkspaceItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setCanApprove(isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'APPROVE_VOUCHER'));
            })
            .catch(() => setCanApprove(false));
    }, []);

    // One set of filters for the rows and the stats strip above them.
    const scopedParams = useMemo<VoucherListFilterParams>(
        () => ({ ...filterParams, storeId: branch.apiStoreId }),
        [filterParams, branch.apiStoreId],
    );

    const { items: vouchers, loading, error: listError, serverPagination, reload } = useServerList<VoucherRow>({
        tableId: 'accounting-vouchers-list',
        initialSort: { id: 'date', desc: true },
        deps: [scopedParams],
        enabled: branch.ready,
        fetch: async (params) => toPaginated<VoucherRow>(await api.getVouchers({ ...params, ...scopedParams })),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        VoucherListFilterParams,
        VoucherListSummary
    >({ fetch: api.getVouchersSummary, params: scopedParams, enabled: branch.ready });

    const refresh = useCallback(() => {
        void reload();
        reloadSummary();
    }, [reload, reloadSummary]);

    useEffect(() => {
        if (createdVoucherNumber) {
            toast.success(t.vouchers.voucherCreated.replace('{voucherNumber}', createdVoucherNumber));
            router.replace('/accounting/vouchers');
        }
    }, [createdVoucherNumber, router, t.vouchers.voucherCreated]);

    const handlePrint = useCallback(async (voucher: VoucherRow) => {
        try {
            const detail = await api.getVoucher(voucher.id);
            // The voucher's branch letterhead when it has one; company paper otherwise.
            const [header, chosenPaper] = await Promise.all([
                printHeader.resolve(detail.store_id ?? undefined),
                resolvePrintPaper(),
            ]);
            // The paper Print settings chose on this browser; a voucher has no
            // roll layout, so a till roll prints it on A4.
            const paper = sheetPaper(chosenPaper);
            printVoucher({
                businessName,
                headerConfig: header.headerConfig,
                voucherNumber: detail.voucher_number,
                voucherType: detail.voucher_type,
                date: formatDate(detail.date, locale),
                referenceNumber: detail.reference_number,
                description: detail.description,
                totalAmount: Number(detail.total_amount || voucher.total_amount || 0),
                lines: (detail.details ?? []).map((line: any) => ({
                    accountName: line.account?.name ?? '—',
                    accountCode: line.account?.code,
                    debit: Number(line.debit_amount || 0),
                    credit: Number(line.credit_amount || 0),
                    comment: line.comment,
                })),
                labels: {
                    title: t.vouchers.list.printTitle,
                    voucherNumber: t.journal.columns.voucherNumber,
                    date: t.accountingShared.date,
                    type: t.accountingShared.type,
                    reference: t.accountingShared.reference,
                    narration: t.accountingShared.narration,
                    account: t.accountingShared.account,
                    debit: t.accountingShared.debit,
                    credit: t.accountingShared.credit,
                    total: t.accountingShared.amount,
                    footer: t.vouchers.list.printFooter,
                },
            }, paper);
        } catch {
            toast.error(t.vouchers.list.printFailed);
        }
    }, [businessName, printHeader, locale, t]);

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteVoucher(deleteTarget.id);
            toast.success(t.vouchers.list.deleteSuccess);
            setDeleteTarget(null);
            refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.vouchers.list.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const handleApprove = useCallback(async (voucher: VoucherRow) => {
        try {
            await api.approveVoucher(voucher.id);
            toast.success(t.vouchers.approval.approveSuccess);
            notifyVoucherApprovalChanged();
            refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.vouchers.approval.approveFailed);
        }
    }, [refresh, t]);

    const openReject = useCallback((target: RejectTarget) => {
        setRejectReason('');
        setRejectTarget(target);
    }, []);

    const closeReject = () => {
        if (!rejecting) setRejectTarget(null);
    };

    const reportBulk = useCallback((action: 'approve' | 'reject', result: any, ids: string[]) => {
        toast.success(
            (action === 'approve' ? t.vouchers.approval.bulkApproved : t.vouchers.approval.bulkRejected)
                .replace('{count}', String(result?.updated ?? ids.length)),
        );
        // Approving into a closed month is refused per voucher rather than
        // failing the batch, so say which rows were left behind — otherwise
        // "3 vouchers approved" out of 4 selected looks like a lost click.
        if (result?.lockedPeriod > 0) {
            toast.info(t.vouchers.approval.bulkLockedPeriod.replace('{count}', String(result.lockedPeriod)));
        }
    }, [t]);

    const handleReject = async () => {
        if (!rejectTarget) return;
        const reason = rejectReason.trim() || undefined;
        setRejecting(true);
        try {
            if (rejectTarget.single) {
                await api.rejectVoucher(rejectTarget.rows[0].id, reason);
                toast.success(t.vouchers.approval.rejectSuccess);
            } else {
                setBulkWorking(true);
                const ids = rejectTarget.rows.map((row) => row.id);
                reportBulk('reject', await api.bulkRejectVouchers(ids, reason), ids);
                setClearSelection((n) => n + 1);
            }
            setRejectTarget(null);
            notifyVoucherApprovalChanged();
            refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.vouchers.approval.rejectFailed);
        } finally {
            setRejecting(false);
            setBulkWorking(false);
        }
    };

    const runBulk = useCallback(async (action: 'approve' | 'reject', rows: VoucherRow[]) => {
        // Only PENDING rows are actionable; the backend counts the rest as
        // skipped, but filtering here keeps the confirmation honest.
        const pending = rows.filter((row) => row.approval_status === 'PENDING');
        if (pending.length === 0) {
            toast.info(t.vouchers.approval.bulkNoPending);
            return;
        }
        if (action === 'reject') {
            openReject({ rows: pending, single: false });
            return;
        }

        setBulkWorking(true);
        try {
            const ids = pending.map((row) => row.id);
            reportBulk('approve', await api.bulkApproveVouchers(ids), ids);
            setClearSelection((n) => n + 1);
            notifyVoucherApprovalChanged();
            refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.vouchers.approval.approveFailed);
        } finally {
            setBulkWorking(false);
        }
    }, [openReject, refresh, reportBulk, t]);

    const columns: ColumnDef<VoucherRow, any>[] = useMemo(
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
                header: t.accountingShared.date,
                // The toolbar date chip filters this on the server.
                enableColumnFilter: false,
                cell: (info) => formatDate(info.getValue(), locale),
                size: 110,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false, hideOnMobile: true }),
            columnHelper.accessor('voucher_type', {
                header: t.accountingShared.type,
                enableColumnFilter: false,
                cell: (info) => voucherTypeLabel(t, info.getValue()),
                size: 130,
            }),
            columnHelper.accessor('reference_number', {
                header: t.accountingShared.reference,
                cell: (info) => info.getValue() || '—',
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('description', {
                header: t.accountingShared.narration,
                // Searched through the toolbar box; there is no column sort for prose.
                enableSorting: false,
                cell: (info) => {
                    const narration = info.getValue();
                    return (
                        <span className="block max-w-[22rem] truncate text-gray-600" title={narration || undefined}>
                            {narration || '—'}
                        </span>
                    );
                },
                size: 220,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.accountingShared.amount,
                // The sum of the voucher's lines, not a stored column the server can sort.
                enableSorting: false,
                enableColumnFilter: false,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('approval_status', {
                header: t.vouchers.approval.status,
                enableColumnFilter: false,
                cell: (info) => <VoucherApprovalBadge status={info.getValue()} />,
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.vouchers.list.actions,
                cell: ({ row }) => {
                    const voucher = row.original;
                    const isSystem = Boolean(voucher.source?.module);
                    const isPending = voucher.approval_status === 'PENDING';
                    return (
                        <RowActions>
                            {canApprove && isPending ? (
                                <>
                                    <RowActionButton
                                        icon={<Check />}
                                        label={t.vouchers.approval.approve}
                                        intent="success"
                                        onClick={() => void handleApprove(voucher)}
                                    />
                                    <RowActionButton
                                        icon={<X />}
                                        label={t.vouchers.approval.reject}
                                        intent="danger"
                                        onClick={() => openReject({ rows: [voucher], single: true })}
                                    />
                                </>
                            ) : null}
                            <RowActionButton icon={<Eye />} label={t.common.view} href={`/accounting/vouchers/${voucher.id}`} />
                            <RowActionButton
                                icon={<Copy />}
                                label={t.vouchers.list.duplicate}
                                href={`/accounting/vouchers/new?duplicate=${voucher.id}`}
                            />
                            <RowActionButton
                                icon={<Pencil />}
                                // A system-posted voucher belongs to the document that posted it.
                                label={isSystem ? t.vouchers.list.systemVoucherLocked : t.common.edit}
                                disabled={isSystem}
                                href={`/accounting/vouchers/new?edit=${voucher.id}`}
                            />
                            <RowActionButton
                                icon={<Printer />}
                                label={t.vouchers.list.print}
                                onClick={() => void handlePrint(voucher)}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={isSystem ? t.vouchers.list.systemVoucherLocked : t.common.delete}
                                intent="danger"
                                disabled={isSystem}
                                onClick={() => setDeleteTarget(voucher)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 210,
            }),
        ],
        [canApprove, handleApprove, handlePrint, openReject, locale, t],
    );

    const stats = useVoucherSummaryStats(summary, summaryLoading, copy.stats.vouchersLabel);

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.vouchers.list.title}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.vouchers.list.title,
                    'accounting',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <Link href="/accounting/vouchers/new" className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.vouchers.list.newVoucher}
                        </Link>
                    </>
                )}
            />

            <DataTable<VoucherRow>
                tableId="accounting-vouchers-list"
                columns={columns}
                data={vouchers}
                title={t.vouchers.list.title}
                isLoading={loading}
                emptyMessage={t.vouchers.list.emptyMessage}
                emptyIcon={<FileText className="w-10 h-10 text-gray-200" />}
                searchPlaceholder={copy.common.searchVouchers}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
                getRowId={(row) => row.id}
                enableRowSelection={canApprove}
                clearSelectionSignal={clearSelection}
                bulkActionsDisabled={bulkWorking}
                bulkActions={canApprove ? [
                    { label: t.vouchers.approval.bulkApprove, onClick: (rows) => void runBulk('approve', rows) },
                    { label: t.vouchers.approval.bulkReject, tone: 'danger', onClick: (rows) => void runBulk('reject', rows) },
                ] : undefined}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                title={copy.vouchers.deleteTitle}
                prompt={fmt(copy.vouchers.deleteBody, { voucherNumber: deleteTarget?.voucher_number ?? '' })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!deleting) setDeleteTarget(null); }}
            />

            {rejectTarget && (
                <ModalShell size="sm" onBackdropClick={closeReject}>
                    <ModalHeader
                        title={rejectTarget.single
                            ? fmt(copy.vouchers.rejectTitle, { voucherNumber: rejectTarget.rows[0].voucher_number })
                            : copy.vouchers.bulkRejectTitle}
                        subtitle={rejectTarget.single
                            ? undefined
                            : fmt(copy.vouchers.bulkRejectBody, { count: rejectTarget.rows.length })}
                        onClose={closeReject}
                        closeLabel={t.common.close}
                    />
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleReject();
                        }}
                    >
                        <div className="p-4">
                            <Field label={t.vouchers.approval.rejectPrompt}>
                                <Textarea
                                    rows={3}
                                    maxLength={500}
                                    value={rejectReason}
                                    onChange={(event) => setRejectReason(event.target.value)}
                                    autoFocus
                                />
                            </Field>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={closeReject} disabled={rejecting}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" variant="danger" loading={rejecting}>
                                {t.vouchers.approval.reject}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
