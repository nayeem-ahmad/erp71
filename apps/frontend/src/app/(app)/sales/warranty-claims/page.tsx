'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Clock, Hourglass, Plus, RefreshCw, Search, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import { api, type SalesDocumentListFilterParams, type WarrantyClaimListSummary } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { WarrantyClaim } from '@erp71/shared-types';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { BranchFilter, Button, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { getWorkspaceItem } from '@/lib/session-store';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { customerListFilter } from '../components/customer-list-filter';

const STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'REPAIRED', 'REPLACED', 'COMPLETED'] as const;
type ClaimStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<ClaimStatus, StatusBadgeTone> = {
    SUBMITTED: 'warning',
    APPROVED: 'info',
    REJECTED: 'danger',
    REPAIRED: 'success',
    REPLACED: 'success',
    COMPLETED: 'neutral',
};

const STATUS_KEY = {
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REPAIRED: 'repaired',
    REPLACED: 'replaced',
    COMPLETED: 'completed',
} as const;

const NEXT_STATUSES: Record<string, string[]> = {
    SUBMITTED: ['APPROVED', 'REJECTED'],
    APPROVED: ['REPAIRED', 'REPLACED', 'COMPLETED'],
    REPAIRED: ['COMPLETED'],
    REPLACED: ['COMPLETED'],
    REJECTED: [],
    COMPLETED: [],
};

type LookupResult = {
    serial: any;
    product: any;
    customer: any;
    sale: any;
    warrantyDays: number;
    soldAt: string | null;
    expiresAt: string | null;
    isExpired: boolean;
    isClaimed: boolean;
    isClaimable: boolean;
};

const columnHelper = createColumnHelper<WarrantyClaim>();

export default function WarrantyClaimsPage() {
    const { t, locale } = useI18n();
    const ui = t.warrantyClaims.listUi;
    const branch = useBranchScope();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [statusModalClaim, setStatusModalClaim] = useState<WarrantyClaim | null>(null);

    // The list's filters, sent alike to the rows and the strip.
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [resolvedRange, setResolvedRange] = useState<CreatedRange | null>(null);
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [customerIds, setCustomerIds] = useState<string[]>([]);

    // New claim form state
    const [serialInput, setSerialInput] = useState('');
    const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [lookupLoading, setLookupLoading] = useState(false);
    const [reason, setReason] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Status update state
    const [newStatus, setNewStatus] = useState('');
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [replacementSerial, setReplacementSerial] = useState('');
    const [statusUpdating, setStatusUpdating] = useState(false);

    const storeId = typeof window !== 'undefined' ? getWorkspaceItem('store_id') ?? '' : '';

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const filterParams = useMemo<SalesDocumentListFilterParams>(() => {
        const resolved = applyCreatedRangeQuery(resolvedRange);
        return {
            search: debouncedSearch || undefined,
            ...applyCreatedRangeQuery(createdRange),
            // A claim's own date is the day it was resolved.
            dateFrom: resolved.createdFrom,
            dateTo: resolved.createdTo,
            status: statuses.length ? statuses.join(',') : undefined,
            statusExclude,
            customerIds,
            storeId: branch.apiStoreId,
        };
    }, [debouncedSearch, createdRange, resolvedRange, statuses, statusExclude, customerIds, branch.apiStoreId]);

    const { items: claims, loading, error: listError, serverPagination, reload } = useServerList<WarrantyClaim>({
        tableId: 'warranty-claims',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getWarrantyClaimsList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        SalesDocumentListFilterParams,
        WarrantyClaimListSummary
    >({ fetch: api.getWarrantyClaimsListSummary, params: filterParams, enabled: branch.ready });

    const refresh = () => {
        void reload();
        reloadSummary();
    };

    const statusLabel = (status: string) => {
        const key = STATUS_KEY[status as ClaimStatus];
        return key ? ui.statuses[key] : status;
    };

    const handleLookup = async () => {
        if (!serialInput.trim()) return;
        setLookupLoading(true);
        setLookupError('');
        setLookupResult(null);
        try {
            const result = await api.lookupWarrantySerial(serialInput.trim());
            setLookupResult(result);
        } catch (err: any) {
            setLookupError(err.message ?? t.shared.errors.serialNotFound);
        } finally {
            setLookupLoading(false);
        }
    };

    const handleSubmitClaim = async () => {
        if (!lookupResult?.isClaimable || !reason.trim()) return;
        setSubmitting(true);
        try {
            const claim = await api.createWarrantyClaim({
                storeId,
                serialNumber: serialInput.trim(),
                reason: reason.trim(),
                description: description.trim() || undefined,
            });
            toast.success(formatMessage(ui.claimSubmitted, { claim: claim?.claim_number ?? '' }));
            closeModal();
            refresh();
        } catch (err: any) {
            setLookupError(err.message ?? t.shared.errors.submitClaim);
        } finally {
            setSubmitting(false);
        }
    };

    const handleStatusUpdate = async () => {
        if (!statusModalClaim || !newStatus) return;
        setStatusUpdating(true);
        try {
            await api.updateWarrantyClaimStatus(statusModalClaim.id, {
                status: newStatus,
                resolutionNotes: resolutionNotes.trim() || undefined,
                replacementSerialNumber: newStatus === 'REPLACED' ? replacementSerial.trim() || undefined : undefined,
            });
            toast.success(ui.statusUpdated);
            setStatusModalClaim(null);
            setNewStatus('');
            setResolutionNotes('');
            setReplacementSerial('');
            refresh();
        } catch (err: any) {
            toast.error(err?.message || ui.statusUpdateFailed);
        } finally {
            setStatusUpdating(false);
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSerialInput('');
        setLookupResult(null);
        setLookupError('');
        setReason('');
        setDescription('');
    };

    const openStatusModal = (claim: WarrantyClaim) => {
        setStatusModalClaim(claim);
        setNewStatus(NEXT_STATUSES[claim.status]?.[0] ?? '');
        setResolutionNotes('');
        setReplacementSerial('');
    };

    const columns: ColumnDef<WarrantyClaim, any>[] = useMemo(
        () => [
            columnHelper.accessor('claim_number', {
                header: t.shared.columns.claimNumber,
                cell: (info) => <span className="font-mono font-medium text-gray-900">{info.getValue()}</span>,
                size: 130,
            }),
            createdAtColumn(columnHelper, { header: t.common.date, locale, enableColumnFilter: false, hideOnMobile: false }),
            columnHelper.accessor('serial_number', {
                header: t.shared.columns.serialNumberFull,
                cell: (info) => <span className="font-mono">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.product?.name ?? '', {
                id: 'product',
                header: t.shared.columns.product,
                cell: (info) => info.getValue() || <span className="text-gray-400">—</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.shared.columns.customer,
                cell: (info) => {
                    const customer = info.row.original.customer;
                    if (!customer) return <span className="text-gray-400">{ui.walkIn}</span>;
                    return (
                        <div className="min-w-0">
                            <span className="block truncate">{customer.name}</span>
                            {customer.phone ? <span className="block text-xs text-gray-500">{customer.phone}</span> : null}
                        </div>
                    );
                },
                size: 170,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('reason', {
                header: t.shared.columns.reason,
                enableSorting: false,
                cell: (info) => <span className="line-clamp-2">{info.getValue()}</span>,
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('status', {
                header: t.shared.columns.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue() as ClaimStatus] ?? 'neutral'}>
                        {statusLabel(info.getValue())}
                    </StatusBadge>
                ),
                size: 120,
            }),
            columnHelper.accessor('replacement_serial_number', {
                header: t.shared.columns.replacementSerial,
                enableSorting: false,
                cell: (info) => (info.getValue()
                    ? <span className="font-mono">{info.getValue()}</span>
                    : <span className="text-gray-400">—</span>),
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('resolved_at', {
                header: ui.resolved,
                cell: (info) => (info.getValue() ? formatDate(info.getValue() as string, locale) : <span className="text-gray-400">—</span>),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'sale',
                header: ui.sale,
                enableSorting: false,
                cell: (info) => {
                    const sale = info.row.original.sale;
                    return sale ? (
                        <Link href={routes.sales.detail(sale.id)} className="text-blue-600 hover:underline">
                            {sale.serial_number}
                        </Link>
                    ) : (
                        <span className="text-gray-400">—</span>
                    );
                },
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => {
                    const claim = row.original;
                    const next = NEXT_STATUSES[claim.status] ?? [];
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<RefreshCw />}
                                label={t.warrantyClaims.updateStatus}
                                disabled={next.length === 0}
                                onClick={() => openStatusModal(claim)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 80,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'created',
                type: 'date-range',
                label: t.common.date,
                value: createdRange,
                onChange: setCreatedRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.shared.columns.status,
                value: statuses,
                onChange: setStatuses,
                options: STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
                exclude: { value: statusExclude, onChange: setStatusExclude },
            },
            customerListFilter({
                label: t.shared.columns.customer,
                walkInLabel: ui.walkIn,
                value: customerIds,
                onChange: setCustomerIds,
                storeId: branch.apiStoreId,
            }),
            {
                id: 'resolved',
                type: 'date-range',
                label: ui.resolved,
                value: resolvedRange,
                onChange: setResolvedRange,
                operators: true,
                more: true,
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, createdRange, statuses, statusExclude, customerIds, resolvedRange, branch.apiStoreId],
    );

    const stats = useMemo(() => {
        const s = ui.stats;
        const count = (value: number | undefined) => (summary && value !== undefined ? value.toLocaleString(locale) : '—');
        const items: ListStat[] = [
            { id: 'count', icon: <ShieldCheck aria-hidden />, label: s.claims, value: count(summary?.count) },
            {
                id: 'awaiting',
                icon: <Hourglass aria-hidden />,
                label: s.awaiting,
                value: count(summary?.awaiting),
                tone: summary && summary.awaiting > 0 ? 'warning' : 'default',
            },
            { id: 'inProgress', icon: <Clock aria-hidden />, label: s.inProgress, value: count(summary?.inProgress) },
            {
                id: 'fixed',
                icon: <Wrench aria-hidden />,
                label: s.fixed,
                value: summary ? (summary.repaired + summary.replaced).toLocaleString(locale) : '—',
                hint: summary && summary.replaced > 0 ? formatMessage(s.replacedHint, { count: summary.replaced }) : undefined,
            },
            { id: 'completed', icon: <CheckCircle2 aria-hidden />, label: s.completed, value: count(summary?.completed) },
            {
                id: 'rejected',
                icon: <XCircle aria-hidden />,
                label: s.rejected,
                value: count(summary?.rejected),
                tone: summary && summary.rejected > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: ui.statsLabel };
    }, [summary, summaryLoading, locale, ui]);

    return (
        <PageShell>
            <PageHeader
                title={t.warrantyClaims.title}
                subtitle={t.warrantyClaims.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.warrantyClaims.title,
                    'sales',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button type="button" onClick={() => setIsModalOpen(true)} className={buttonClassName()}>
                            <Plus className="h-4 w-4" />
                            {t.warrantyClaims.newClaim}
                        </button>
                    </>
                )}
            />

            <DataTable<WarrantyClaim>
                tableId="warranty-claims"
                title={t.warrantyClaims.title}
                columns={columns}
                data={claims}
                isLoading={loading}
                emptyMessage={ui.emptyMessage}
                emptyIcon={<ShieldCheck className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={ui.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />

            {/* {t.warrantyClaims.newClaim} Modal */}
            {isModalOpen && (
                <ModalShell size="md" onBackdropClick={closeModal}>
                        <ModalHeader title={t.warrantyClaims.submitTitle} onClose={closeModal} />

                        <div className="p-5 space-y-4 overflow-y-auto">
                            {/* Serial number lookup */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.serialNumber}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={serialInput}
                                        onChange={(e) => {
                                            setSerialInput(e.target.value);
                                            setLookupResult(null);
                                            setLookupError('');
                                        }}
                                        onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                                        placeholder={t.warrantyClaims.enterSerial}
                                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                    <button
                                        onClick={handleLookup}
                                        disabled={lookupLoading || !serialInput.trim()}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                                    >
                                        <Search className="w-4 h-4" />
                                        {lookupLoading ? t.warrantyClaims.lookingUp : t.warrantyClaims.lookUp}
                                    </button>
                                </div>
                                {lookupError && (
                                    <p className="text-red-600 text-xs mt-1">{lookupError}</p>
                                )}
                            </div>

                            {/* Lookup result */}
                            {lookupResult && (
                                <div
                                    className={`rounded-lg border p-4 text-sm space-y-1.5 ${
                                        lookupResult.isClaimable
                                            ? 'border-emerald-200 bg-emerald-50'
                                            : 'border-red-200 bg-red-50'
                                    }`}
                                >
                                    <p className="font-medium text-gray-900">
                                        {lookupResult.product?.name}
                                    </p>
                                    {lookupResult.customer && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.customerLabel} {lookupResult.customer.name} ({lookupResult.customer.phone})
                                        </p>
                                    )}
                                    {lookupResult.soldAt && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.sold} {formatDate(lookupResult.soldAt, locale)} &nbsp;·&nbsp;
                                            {formatMessage(t.warrantyClaims.warrantyDays, { days: lookupResult.warrantyDays })}
                                        </p>
                                    )}
                                    {lookupResult.expiresAt && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.expires} {formatDate(lookupResult.expiresAt, locale)}
                                        </p>
                                    )}
                                    {lookupResult.isClaimed && (
                                        <p className="text-red-600 font-medium">
                                            {t.warrantyClaims.alreadyClaimed}
                                        </p>
                                    )}
                                    {lookupResult.isExpired && !lookupResult.isClaimed && (
                                        <p className="text-red-600 font-medium">{t.warrantyClaims.warrantyExpired}</p>
                                    )}
                                    {lookupResult.isClaimable && (
                                        <p className="text-emerald-700 font-medium">
                                            {t.warrantyClaims.eligible}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Claim form — only shown after a valid lookup */}
                            {lookupResult?.isClaimable && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t.warrantyClaims.reasonRequired} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder={t.warrantyClaims.reasonPlaceholder}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t.warrantyClaims.additionalDetails}
                                        </label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={3}
                                            placeholder={t.warrantyClaims.additionalDetailsPlaceholder}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <ModalFooter>
                            <Button type="button" variant="secondary" size="md" onClick={closeModal}>
                                {t.common.cancel}
                            </Button>
                            {lookupResult?.isClaimable && (
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="md"
                                    onClick={handleSubmitClaim}
                                    disabled={!reason.trim()}
                                    loading={submitting}
                                >
                                    {submitting ? t.warrantyClaims.submitting : t.warrantyClaims.submitClaim}
                                </Button>
                            )}
                        </ModalFooter>
                </ModalShell>
            )}

            {/* Status Update Modal */}
            {statusModalClaim && (
                <ModalShell size="sm" onBackdropClick={() => setStatusModalClaim(null)}>
                        <ModalHeader
                            title={t.warrantyClaims.updateClaimStatus}
                            onClose={() => setStatusModalClaim(null)}
                        />
                        <div className="p-5 space-y-4 overflow-y-auto">
                            <p className="text-sm text-gray-600">
                                {formatMessage(t.warrantyClaims.claimSerial, {
                                    claim: statusModalClaim.claim_number,
                                    serial: statusModalClaim.serial_number,
                                })}
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.newStatus}
                                </label>
                                <select
                                    value={newStatus}
                                    onChange={(e) => setNewStatus(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                >
                                    {NEXT_STATUSES[statusModalClaim.status]?.map((next) => (
                                        <option key={next} value={next}>
                                            {statusLabel(next)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {newStatus === 'REPLACED' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {t.warrantyClaims.replacementSerialRequired} <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={replacementSerial}
                                        onChange={(e) => setReplacementSerial(e.target.value)}
                                        placeholder={t.warrantyClaims.replacementSerialPlaceholder}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        {t.warrantyClaims.replacementHint}
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.resolutionNotes}
                                </label>
                                <textarea
                                    value={resolutionNotes}
                                    onChange={(e) => setResolutionNotes(e.target.value)}
                                    rows={3}
                                    placeholder={t.warrantyClaims.resolutionPlaceholder}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                                />
                            </div>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" size="md" onClick={() => setStatusModalClaim(null)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                size="md"
                                onClick={handleStatusUpdate}
                                disabled={
                                    !newStatus ||
                                    (newStatus === 'REPLACED' && !replacementSerial.trim())
                                }
                                loading={statusUpdating}
                            >
                                {statusUpdating ? t.warrantyClaims.saving : t.common.save}
                            </Button>
                        </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
