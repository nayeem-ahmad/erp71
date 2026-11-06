'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Gift, History, Loader2, Minus, Plus, SlidersHorizontal, Users, Coins, TrendingUp, TrendingDown } from 'lucide-react';
import { api, fetchWithAuth, type LoyaltyCustomerListFilterParams, type LoyaltyCustomerListSummary } from '@/lib/api';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, BranchFilter, Button, Field, Input, PageShell, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';

interface LoyaltyCustomer {
    id: string;
    name: string;
    phone: string | null;
    loyalty_points: number;
    last_transaction_at: string | null;
}

interface LoyaltyTransaction {
    id: string;
    type: string;
    points: number;
    description: string | null;
    created_at: string;
}

interface CustomerDetail {
    id: string;
    name: string;
    phone: string;
    loyalty_points: number;
    transactions: LoyaltyTransaction[];
}

const ACTIVITY_TYPES = ['EARN', 'REDEEM', 'ADJUST'] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];
const ACTIVITY_TONES: Record<ActivityType, StatusBadgeTone> = { EARN: 'success', REDEEM: 'info', ADJUST: 'warning' };

const columnHelper = createColumnHelper<LoyaltyCustomer>();

function AdjustPointsModal({
    customer,
    onClose,
    onSuccess,
}: {
    customer: LoyaltyCustomer;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const { t } = useI18n();
    const [points, setPoints] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [pointsError, setPointsError] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const pts = parseInt(points, 10);
        if (isNaN(pts) || pts === 0) {
            setPointsError(t.shared.form.nonZeroPoints);
            return;
        }
        setSaving(true);
        setError('');
        try {
            await fetchWithAuth(`/loyalty/customers/${customer.id}/adjust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: pts, description: description || undefined }),
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err?.message || t.shared.errors.adjustPoints);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
                <ModalHeader
                    title={t.loyalty.adjustPoints}
                    subtitle={`${customer.name} · ${t.loyalty.currentBalance} ${customer.loyalty_points} ${t.loyalty.pointsSuffix}`}
                    onClose={onClose}
                />

                <div className="p-4 space-y-4 overflow-y-auto">
                    {error && <Alert tone="danger">{error}</Alert>}
                    <Field label={t.loyalty.pointsAdjustment} hint={t.shared.form.pointsHint} error={pointsError} htmlFor="loyalty-adjust-points">
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                title="+/−"
                                onClick={() => {
                                    const v = parseInt(points || '0', 10);
                                    if (!isNaN(v)) setPoints(String(-v));
                                }}
                            >
                                <Plus className="w-3 h-3" />/<Minus className="w-3 h-3" />
                            </Button>
                            <Input
                                id="loyalty-adjust-points"
                                type="number"
                                value={points}
                                onChange={(e) => { setPoints(e.target.value); setPointsError(''); }}
                                placeholder={t.shared.form.pointsPlaceholder}
                                error={!!pointsError}
                                className="flex-1"
                            />
                        </div>
                    </Field>

                    <Field label={t.shared.form.descriptionOptional} htmlFor="loyalty-adjust-description">
                        <Input
                            id="loyalty-adjust-description"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t.shared.form.reasonOptional}
                            className="w-full"
                        />
                    </Field>
                </div>

                <ModalFooter>
                    <Button type="button" variant="secondary" size="md" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" variant="primary" size="md" loading={saving}>
                        {saving ? t.loyalty.saving : t.loyalty.adjustPointsButton}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

/** A customer's latest points activity, from the History row action. */
function PointsHistoryModal({ customer, onClose }: { customer: LoyaltyCustomer; onClose: () => void }) {
    const { t, locale } = useI18n();
    const [detail, setDetail] = useState<CustomerDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        api.getCustomerLoyaltyPoints(customer.id)
            .then((data: CustomerDetail) => { if (!cancelled) setDetail(data); })
            .catch((err: any) => toast.error(err?.message || t.shared.errors.loadTransactions))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [customer.id, t]);

    const typeLabel = (type: string) =>
        (t.shared.statuses.loyalty as Record<string, string>)[type] ?? type;

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader
                title={t.loyalty.listUi.history}
                subtitle={`${customer.name} · ${customer.loyalty_points.toLocaleString(locale)} ${t.loyalty.pointsSuffix}`}
                onClose={onClose}
            />
            <div className="p-4 overflow-y-auto">
                {loading ? (
                    <p className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t.shared.loading.transactions}
                    </p>
                ) : !detail ? (
                    <p className="text-sm text-gray-500">{t.shared.empty.noData}</p>
                ) : detail.transactions.length === 0 ? (
                    <p className="text-sm text-gray-500">{t.shared.empty.noTransactionsYet}</p>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {detail.transactions.map((tx) => (
                            <li key={tx.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="flex min-w-0 items-center gap-2">
                                    <StatusBadge tone={ACTIVITY_TONES[tx.type as ActivityType] ?? 'neutral'}>{typeLabel(tx.type)}</StatusBadge>
                                    <span className="truncate text-gray-600">{tx.description || '—'}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                                    <span className={tx.points > 0 ? 'text-emerald-700' : 'text-red-600'}>
                                        {tx.points > 0 ? '+' : ''}
                                        {tx.points.toLocaleString(locale)}
                                    </span>
                                    <span className="w-24 text-end text-xs text-gray-500">{formatDate(tx.created_at, locale)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <ModalFooter>
                <Button type="button" variant="secondary" size="md" onClick={onClose}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

/**
 * Customers' reward points. Paged on the server — a shop's customer book runs
 * to thousands — with the filters and the strip counted there over the same
 * customers.
 */
export default function LoyaltyPage() {
    const { t, locale } = useI18n();
    const copy = t.loyalty.listUi;
    // Points belong to the customer, so a member who sees every branch starts
    // on all of them, as on the customers list.
    const branch = useBranchScope({ startOnAll: true });
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [pointsFilter, setPointsFilter] = useState<NumberCondition | null>(null);
    const [activeRange, setActiveRange] = useState<CreatedRange | null>(null);
    const [activityTypes, setActivityTypes] = useState<string[]>([]);
    const [adjustCustomer, setAdjustCustomer] = useState<LoyaltyCustomer | null>(null);
    const [historyCustomer, setHistoryCustomer] = useState<LoyaltyCustomer | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const filterParams = useMemo<LoyaltyCustomerListFilterParams>(() => {
        const active = applyCreatedRangeQuery(activeRange);
        return {
            search: debouncedSearch || undefined,
            points: pointsFilter,
            activeFrom: active.createdFrom,
            activeTo: active.createdTo,
            activityTypes,
            storeId: branch.apiStoreId,
        };
    }, [debouncedSearch, pointsFilter, activeRange, activityTypes, branch.apiStoreId]);

    const { items: customers, loading, error: listError, serverPagination, reload } = useServerList<LoyaltyCustomer>({
        tableId: 'loyalty-customers',
        initialSort: { id: 'loyalty_points', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getLoyaltyCustomersPaged({ ...filterParams, ...params }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        LoyaltyCustomerListFilterParams,
        LoyaltyCustomerListSummary
    >({ fetch: api.getLoyaltyCustomersSummary, params: filterParams, enabled: branch.ready });

    const handleAdjustSuccess = () => {
        toast.success(t.shared.success.pointsAdjusted);
        void reload();
        reloadSummary();
    };

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'points',
            type: 'number',
            label: t.shared.columns.points,
            value: pointsFilter,
            onChange: setPointsFilter,
        },
        {
            id: 'activity',
            type: 'date-range',
            label: copy.activity,
            value: activeRange,
            onChange: setActiveRange,
            operators: true,
        },
        {
            id: 'activityType',
            type: 'multi-select',
            label: copy.activityType,
            value: activityTypes,
            onChange: setActivityTypes,
            options: ACTIVITY_TYPES.map((type) => ({ value: type, label: t.shared.statuses.loyalty[type] })),
            more: true,
        },
    ], [t, copy, pointsFilter, activeRange, activityTypes]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const dash = '—';
        const windowed = summary?.windowed ?? false;
        const items: ListStat[] = [
            { id: 'count', icon: <Users aria-hidden />, label: copy.stats.customers, value: summary ? n(summary.count) : dash },
            { id: 'members', icon: <Gift aria-hidden />, label: copy.stats.members, value: summary ? n(summary.members) : dash },
            { id: 'points', icon: <Coins aria-hidden />, label: copy.stats.points, value: summary ? n(summary.points) : dash },
            {
                id: 'earned',
                icon: <TrendingUp aria-hidden />,
                label: windowed ? copy.stats.earned : copy.stats.earnedMonth,
                value: summary ? n(summary.earned) : dash,
            },
            {
                id: 'redeemed',
                icon: <TrendingDown aria-hidden />,
                label: windowed ? copy.stats.redeemed : copy.stats.redeemedMonth,
                value: summary ? n(summary.redeemed) : dash,
            },
        ];
        return { items, loading: summaryLoading && !summary, label: copy.statsLabel };
    }, [summary, summaryLoading, locale, copy]);

    const columns: ColumnDef<LoyaltyCustomer, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.shared.columns.customer,
                cell: (info) => info.getValue(),
                size: 220,
            }),
            columnHelper.accessor('phone', {
                header: t.shared.columns.phone,
                cell: (info) => info.getValue() || '—',
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('loyalty_points', {
                header: t.shared.columns.points,
                cell: (info) => Number(info.getValue() || 0).toLocaleString(locale),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('last_transaction_at', {
                header: t.shared.columns.lastTransaction,
                // The latest of each customer's activity, not a customer column.
                enableSorting: false,
                cell: (info) => {
                    const at = info.getValue();
                    return at ? formatDate(at, locale) : <span className="text-gray-400">—</span>;
                },
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.shared.columns.actions,
                cell: (info) => (
                    <RowActions>
                        <RowActionButton icon={<History />} label={copy.history} onClick={() => setHistoryCustomer(info.row.original)} />
                        <RowActionButton
                            icon={<SlidersHorizontal />}
                            label={t.loyalty.adjust}
                            onClick={() => setAdjustCustomer(info.row.original)}
                        />
                    </RowActions>
                ),
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
                title={t.loyalty.title}
                subtitle={t.loyalty.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.loyalty.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<LoyaltyCustomer>
                tableId="loyalty-customers"
                columns={columns}
                data={customers}
                title={t.loyalty.title}
                isLoading={loading}
                emptyMessage={t.shared.empty.noCustomers}
                emptyIcon={<Gift className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.loyalty.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />

            {adjustCustomer && (
                <AdjustPointsModal
                    customer={adjustCustomer}
                    onClose={() => setAdjustCustomer(null)}
                    onSuccess={handleAdjustSuccess}
                />
            )}

            {historyCustomer && (
                <PointsHistoryModal customer={historyCustomer} onClose={() => setHistoryCustomer(null)} />
            )}
        </PageShell>
    );
}
