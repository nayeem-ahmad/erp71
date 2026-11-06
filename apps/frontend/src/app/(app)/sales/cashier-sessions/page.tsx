'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
    AlertCircle,
    ArrowDownLeft,
    ArrowUpRight,
    Banknote,
    CheckCircle2,
    Clock,
    DollarSign,
    Hash,
    Monitor,
    Receipt,
    RotateCcw,
    Scale,
    TrendingDown,
    TrendingUp,
    Vault,
    Wallet,
} from 'lucide-react';
import { api, type CashierOverviewRow } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, BranchFilter, Field, Input, Select, StatusBadge } from '@/components/ui';
import { DataTable, ListStats, type ListFilter, type ListStat } from '@/components/data-table';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { getWorkspaceItem } from '@/lib/session-store';
import { toast } from '@/lib/toast';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';

/** A cash movement typed in at the till; `amount` is signed, positive is cash in. */
interface CashTransaction {
    id: string;
    amount: string | number;
    type: string;
    description?: string | null;
    created_at: string;
}

const CASH_TYPES = ['DROP', 'LOAN', 'PAYOUT', 'OTHER'] as const;

/** The Counter chip's value for a till opened without a counter. */
const NO_COUNTER = '__none__';

/** How a closed till's count came out against what it should have held. */
type VarianceState = 'short' | 'over' | 'balanced' | 'notCounted';

function varianceState(row: CashierOverviewRow): VarianceState | null {
    if (row.status !== 'CLOSED') return null;
    if (row.variance === null) return 'notCounted';
    if (row.variance < -0.005) return 'short';
    if (row.variance > 0.005) return 'over';
    return 'balanced';
}

const tillColumn = createColumnHelper<CashierOverviewRow>();
const txColumn = createColumnHelper<CashTransaction>();

export default function CashierSessionsPage() {
    const { t, locale } = useI18n();
    const copy = t.cashierSessions;
    const ui = copy.listUi;
    const [session, setSession] = useState<any>(null);
    const [transactions, setTransactions] = useState<CashTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [openingCash, setOpeningCash] = useState<number>(0);
    const [closingCash, setClosingCash] = useState<number>(0);
    const [txAmount, setTxAmount] = useState<number>(0);
    const [txType, setTxType] = useState('DROP');
    const [txDescription, setTxDescription] = useState('');
    const [showOpenModal, setShowOpenModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showTxModal, setShowTxModal] = useState(false);
    const [counters, setCounters] = useState<any[]>([]);
    const [selectedCounterId, setSelectedCounterId] = useState<string>('');
    // What the shift actually took, from the API. The page used to compute
    // "expected cash" in the browser as opening + cash in − cash out, which
    // leaves out every cash sale — so a till that had sold anything always
    // read short by exactly its takings.
    const [summary, setSummary] = useState<any>(null);
    // Tills open now and shifts closed today, in the filtered branch.
    const [tills, setTills] = useState<CashierOverviewRow[]>([]);
    const [tillsLoading, setTillsLoading] = useState(true);
    // The branch filter picks whose floor the tills list shows. Your own
    // shift and opening one stay on the header branch: a till is opened where
    // you are signed in to sell, not wherever you are looking.
    const branch = useBranchScope({ allowAll: false });
    const floorStoreId = branch.apiStoreId;

    // The tills list's chips — all over today's rows, held here.
    const [tillSearch, setTillSearch] = useState('');
    const [tillStatuses, setTillStatuses] = useState<string[]>([]);
    const [cashierIds, setCashierIds] = useState<string[]>([]);
    const [counterIds, setCounterIds] = useState<string[]>([]);
    const [variances, setVariances] = useState<string[]>([]);

    // The cash movements list's chips.
    const [txSearch, setTxSearch] = useState('');
    const [txTypes, setTxTypes] = useState<string[]>([]);
    const [txFlows, setTxFlows] = useState<string[]>([]);
    const [txAmountFilter, setTxAmountFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        loadSession();
        loadCounters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadTills();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, floorStoreId]);

    const loadSession = async () => {
        try {
            const data = await api.getOpenCashierSession();
            setSession(data);
            if (data?.id) {
                const [txData, summaryData] = await Promise.all([
                    api.getCashTransactions(data.id),
                    api.getCashierSessionSummary(data.id).catch(() => null),
                ]);
                setTransactions(Array.isArray(txData) ? txData : []);
                setSummary(summaryData);
            } else {
                setSummary(null);
            }
        } catch (error) {
            console.error('Failed to load session', error);
            setSession(null);
        } finally {
            setLoading(false);
        }
    };

    // The floor view. Anyone who may open a session may see the tills beside
    // theirs — a cashier needs to know counter 2 is already taken, and it is
    // the only way a supervisor sees the shop at all.
    const loadTills = async () => {
        try {
            if (!floorStoreId) return;
            setTillsLoading(true);
            const data = await api.getCashierSessionOverview(floorStoreId);
            setTills([...(data?.open ?? []), ...(data?.closed_today ?? [])]);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            // Otherwise non-fatal: the list is additional context, not the page.
            setTills([]);
        } finally {
            setTillsLoading(false);
        }
    };

    const loadCounters = async () => {
        try {
            const storeId = getWorkspaceItem('store_id') || '';
            if (!storeId) return;
            const data = await api.getActiveCounters(storeId);
            const list = Array.isArray(data) ? data : (data?.data ?? []);
            setCounters(list);
        } catch {
            // counters are optional — silently ignore if not available
        }
    };

    const handleOpenSession = async () => {
        try {
            const storeId = getWorkspaceItem('store_id') || '';
            const payload: any = { storeId, openingCash };
            if (selectedCounterId) payload.counterId = selectedCounterId;
            await api.openCashierSession(payload);
            if (selectedCounterId) {
                localStorage.setItem('counter_id', selectedCounterId);
            } else {
                localStorage.removeItem('counter_id');
            }
            setShowOpenModal(false);
            setOpeningCash(0);
            setSelectedCounterId('');
            loadSession();
            loadTills();
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.openSession);
        }
    };

    const handleCloseSession = async () => {
        if (!session) return;
        try {
            await api.closeCashierSession(session.id, { closingCash });
            localStorage.removeItem('counter_id');
            setShowCloseModal(false);
            setClosingCash(0);
            setSession(null);
            setTransactions([]);
            setSummary(null);
            loadSession();
            loadTills();
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.closeSession);
        }
    };

    const handleAddTransaction = async () => {
        if (!session) return;
        try {
            await api.addCashTransaction(session.id, {
                amount: txAmount,
                type: txType,
                description: txDescription,
            });
            setShowTxModal(false);
            setTxAmount(0);
            setTxType('DROP');
            setTxDescription('');
            toast.success(ui.recorded);
            const [txData, summaryData] = await Promise.all([
                api.getCashTransactions(session.id),
                api.getCashierSessionSummary(session.id).catch(() => null),
            ]);
            setTransactions(Array.isArray(txData) ? txData : []);
            setSummary(summaryData);
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.addTransaction);
        }
    };

    const amountOf = (tx: CashTransaction) => Number(tx.amount) || 0;
    const totalCashIn = transactions.filter((tx) => amountOf(tx) > 0).reduce((sum, tx) => sum + amountOf(tx), 0);
    const totalCashOut = transactions.filter((tx) => amountOf(tx) < 0).reduce((sum, tx) => sum + Math.abs(amountOf(tx)), 0);

    // The server is the only thing that knows what the till sold, so the local
    // arithmetic is a placeholder for the moment before the summary lands —
    // never a second opinion about it.
    const expectedCash = summary
        ? Number(summary.expectedCash)
        : Number(session?.opening_cash || 0) + totalCashIn - totalCashOut;
    const difference = closingCash - expectedCash;

    const money = (value: number) => formatBDT(value, { locale });
    const roundMoney = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const typeLabel = (type: string) => {
        const key = ({ DROP: 'drop', LOAN: 'loan', PAYOUT: 'payout', OTHER: 'other' } as const)[type as (typeof CASH_TYPES)[number]];
        return key ? copy.types[key] : type;
    };
    const counterLabel = (row: CashierOverviewRow) => (
        row.counter ? `#${row.counter.counter_number} — ${row.counter.name}` : t.shared.form.walkInNoCounter
    );

    // ---- Your shift ---------------------------------------------------------

    const shiftStats = useMemo<ListStat[]>(() => {
        const opening = Number(summary?.openingCash ?? session?.opening_cash ?? 0);
        const items: ListStat[] = [
            { id: 'opening', icon: <Vault aria-hidden />, label: copy.openingCash, value: roundMoney(opening) },
        ];
        if (summary) {
            items.push(
                {
                    id: 'takings',
                    icon: <Receipt aria-hidden />,
                    label: copy.takings,
                    value: roundMoney(Number(summary.salesTotal)),
                    hint: formatMessage(ui.salesCount, { count: Number(summary.salesCount ?? 0) }),
                },
                { id: 'cashSales', icon: <Banknote aria-hidden />, label: copy.cashSales, value: roundMoney(Number(summary.cashTakings)) },
                {
                    id: 'refunds',
                    icon: <RotateCcw aria-hidden />,
                    label: copy.refunds,
                    value: roundMoney(Number(summary.refunds)),
                    tone: Number(summary.refunds) > 0 ? 'danger' : 'default',
                },
            );
        }
        items.push({ id: 'expected', icon: <Wallet aria-hidden />, label: copy.expectedCash, value: roundMoney(expectedCash) });
        return items;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summary, session, expectedCash, copy, ui, locale]);

    const visibleTransactions = useMemo(() => transactions.filter((tx) => {
        const amount = amountOf(tx);
        if (!matchesAnyOf(txTypes, tx.type)) return false;
        if (!matchesAnyOf(txFlows, amount >= 0 ? 'in' : 'out')) return false;
        if (!matchesNumberCondition(Math.abs(amount), txAmountFilter)) return false;
        return matchesSearch(txSearch, typeLabel(tx.type), tx.type, tx.description);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [transactions, txTypes, txFlows, txAmountFilter, txSearch, copy]);

    const txColumns: ColumnDef<CashTransaction, any>[] = useMemo(() => [
        txColumn.accessor('created_at', {
            header: ui.time,
            cell: (info) => formatDateTime(info.getValue(), locale),
            sortingFn: 'datetime',
            size: 150,
        }),
        txColumn.accessor('type', {
            header: copy.type,
            cell: (info) => typeLabel(info.getValue()),
            size: 140,
        }),
        txColumn.accessor((row) => row.description ?? '', {
            id: 'description',
            header: ui.description,
            cell: (info) => info.getValue() || <span className="text-gray-400">—</span>,
            size: 240,
            meta: { hideOnMobile: true },
        }),
        txColumn.accessor((row) => amountOf(row), {
            id: 'amount',
            header: copy.amount,
            cell: (info) => {
                const amount = info.getValue() as number;
                return (
                    <span className={amount >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                        {amount >= 0 ? '+' : '−'}{money(Math.abs(amount))}
                    </span>
                );
            },
            size: 130,
            meta: { align: 'end' },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [copy, ui, locale]);

    const txFilters = useMemo<ListFilter[]>(() => [
        {
            id: 'type',
            type: 'multi-select',
            label: copy.type,
            value: txTypes,
            onChange: setTxTypes,
            options: CASH_TYPES.map((type) => ({ value: type, label: typeLabel(type) })),
        },
        {
            id: 'direction',
            type: 'multi-select',
            label: ui.direction,
            value: txFlows,
            onChange: setTxFlows,
            options: [
                { value: 'in', label: copy.cashIn },
                { value: 'out', label: copy.cashOut },
            ],
        },
        {
            id: 'amount',
            type: 'number',
            label: copy.amount,
            value: txAmountFilter,
            onChange: setTxAmountFilter,
            money: true,
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [copy, ui, txTypes, txFlows, txAmountFilter]);

    const txStats = useMemo(() => {
        let cashIn = 0;
        let cashOut = 0;
        for (const tx of visibleTransactions) {
            const amount = amountOf(tx);
            if (amount >= 0) cashIn += amount;
            else cashOut += Math.abs(amount);
        }
        const items: ListStat[] = [
            { id: 'count', icon: <Hash aria-hidden />, label: ui.movements, value: visibleTransactions.length.toLocaleString(locale) },
            { id: 'in', icon: <ArrowDownLeft aria-hidden />, label: copy.cashIn, value: roundMoney(cashIn) },
            { id: 'out', icon: <ArrowUpRight aria-hidden />, label: copy.cashOut, value: roundMoney(cashOut) },
            { id: 'net', icon: <Scale aria-hidden />, label: ui.net, value: roundMoney(cashIn - cashOut) },
        ];
        return { items, label: ui.movementsStatsLabel };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleTransactions, copy, ui, locale]);

    // ---- Tills today --------------------------------------------------------

    const cashierOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const row of tills) if (row.cashier) seen.set(row.cashier.id, row.cashier.name);
        return [...seen].map(([value, label]) => ({ value, label }));
    }, [tills]);

    const counterOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const row of tills) seen.set(row.counter?.id ?? NO_COUNTER, counterLabel(row));
        return [...seen].map(([value, label]) => ({ value, label }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tills, t]);

    const visibleTills = useMemo(() => tills.filter((row) => {
        if (!matchesAnyOf(tillStatuses, row.status)) return false;
        if (!matchesAnyOf(cashierIds, row.cashier?.id)) return false;
        if (!matchesAnyOf(counterIds, row.counter?.id ?? NO_COUNTER)) return false;
        if (!matchesAnyOf(variances, varianceState(row))) return false;
        return matchesSearch(tillSearch, row.cashier?.name, row.counter?.name, row.counter?.counter_number);
    }), [tills, tillStatuses, cashierIds, counterIds, variances, tillSearch]);

    const tillColumns: ColumnDef<CashierOverviewRow, any>[] = useMemo(() => [
        tillColumn.accessor((row) => counterLabel(row), {
            id: 'counter',
            header: copy.counter,
            cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
            size: 170,
        }),
        tillColumn.accessor((row) => row.cashier?.name ?? '', {
            id: 'cashier',
            header: ui.cashier,
            cell: (info) => info.getValue() || <span className="text-gray-400">—</span>,
            size: 150,
        }),
        tillColumn.accessor('status', {
            header: t.common.status,
            cell: (info) => (info.getValue() === 'OPEN'
                ? <StatusBadge tone="success">{ui.statuses.open}</StatusBadge>
                : <StatusBadge tone="neutral">{ui.statuses.closed}</StatusBadge>),
            size: 100,
        }),
        tillColumn.accessor('opened_at', {
            header: ui.opened,
            cell: (info) => formatDateTime(info.getValue(), locale),
            sortingFn: 'datetime',
            size: 150,
            meta: { hideOnMobile: true },
        }),
        tillColumn.accessor('closed_at', {
            header: ui.closed,
            cell: (info) => (info.getValue() ? formatDateTime(info.getValue() as string, locale) : <span className="text-gray-400">—</span>),
            size: 150,
            meta: { hideOnMobile: true },
        }),
        tillColumn.accessor('sales_count', {
            header: copy.salesCount,
            cell: (info) => Number(info.getValue() ?? 0).toLocaleString(locale),
            size: 80,
            meta: { align: 'end', hideOnMobile: true },
        }),
        tillColumn.accessor('sales_total', {
            header: copy.takings,
            cell: (info) => money(Number(info.getValue() ?? 0)),
            size: 120,
            meta: { align: 'end' },
        }),
        tillColumn.accessor('expected_cash', {
            header: copy.expectedCash,
            cell: (info) => (info.getValue() === null ? <span className="text-gray-400">—</span> : money(Number(info.getValue()))),
            size: 120,
            meta: { align: 'end' },
        }),
        tillColumn.accessor('closing_cash', {
            header: ui.counted,
            cell: (info) => (info.getValue() === null ? <span className="text-gray-400">—</span> : money(Number(info.getValue()))),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
        tillColumn.accessor('variance', {
            header: copy.difference,
            cell: (info) => {
                const state = varianceState(info.row.original);
                if (!state) return <span className="text-gray-400">—</span>;
                if (state === 'notCounted') return <span className="text-gray-400">{ui.variance.notCounted}</span>;
                if (state === 'balanced') return <span className="text-emerald-700">{copy.balanced}</span>;
                const value = Number(info.getValue());
                return (
                    <span className={state === 'short' ? 'text-red-600' : 'text-amber-700'}>
                        {state === 'short' ? '−' : '+'}{money(Math.abs(value))}
                    </span>
                );
            },
            size: 120,
            meta: { align: 'end' },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, copy, ui, locale]);

    const tillFilters = useMemo<ListFilter[]>(() => [
        {
            id: 'status',
            type: 'multi-select',
            label: t.common.status,
            value: tillStatuses,
            onChange: setTillStatuses,
            options: [
                { value: 'OPEN', label: ui.statuses.open },
                { value: 'CLOSED', label: ui.statuses.closed },
            ],
        },
        {
            id: 'cashier',
            type: 'multi-select',
            label: ui.cashier,
            value: cashierIds,
            onChange: setCashierIds,
            options: cashierOptions,
        },
        {
            id: 'counter',
            type: 'multi-select',
            label: copy.counter,
            value: counterIds,
            onChange: setCounterIds,
            options: counterOptions,
        },
        {
            id: 'variance',
            type: 'multi-select',
            label: copy.difference,
            value: variances,
            onChange: setVariances,
            options: [
                { value: 'short', label: copy.cashShort },
                { value: 'over', label: copy.cashOver },
                { value: 'balanced', label: copy.balanced },
                { value: 'notCounted', label: ui.variance.notCounted },
            ],
        },
    ], [t, copy, ui, tillStatuses, cashierIds, cashierOptions, counterIds, counterOptions, variances]);

    const tillStats = useMemo(() => {
        const open = visibleTills.filter((row) => row.status === 'OPEN');
        const closed = visibleTills.filter((row) => row.status === 'CLOSED');
        const inDrawers = open.reduce((sum, row) => sum + Number(row.expected_cash ?? 0), 0);
        const takings = visibleTills.reduce((sum, row) => sum + Number(row.sales_total ?? 0), 0);
        const sales = visibleTills.reduce((sum, row) => sum + Number(row.sales_count ?? 0), 0);
        const counted = closed.map((row) => row.variance).filter((v): v is number => v !== null);
        const short = counted.filter((v) => v < 0).reduce((sum, v) => sum + v, 0);
        const over = counted.filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
        const items: ListStat[] = [
            { id: 'open', icon: <Monitor aria-hidden />, label: ui.stats.open, value: open.length.toLocaleString(locale) },
            { id: 'inDrawers', icon: <Wallet aria-hidden />, label: ui.stats.inDrawers, value: roundMoney(inDrawers) },
            {
                id: 'takings',
                icon: <Receipt aria-hidden />,
                label: copy.takings,
                value: roundMoney(takings),
                hint: formatMessage(ui.salesCount, { count: sales }),
            },
            { id: 'closed', icon: <CheckCircle2 aria-hidden />, label: ui.stats.closed, value: closed.length.toLocaleString(locale) },
            {
                id: 'short',
                icon: <TrendingDown aria-hidden />,
                label: copy.cashShort,
                value: roundMoney(Math.abs(short)),
                tone: short < 0 ? 'danger' : 'default',
            },
            {
                id: 'over',
                icon: <TrendingUp aria-hidden />,
                label: copy.cashOver,
                value: roundMoney(over),
                tone: over > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: tillsLoading && tills.length === 0, label: ui.tillsStatsLabel };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleTills, tillsLoading, tills.length, copy, ui, locale]);

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-canvas">
                <p className="text-sm text-gray-400">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        {session ? (
                            <>
                                <Button variant="secondary" size="sm" icon={<DollarSign className="h-4 w-4" />} onClick={() => setShowTxModal(true)}>
                                    {copy.recordCashInOut}
                                </Button>
                                <Button variant="danger" size="sm" icon={<Clock className="h-4 w-4" />} onClick={() => setShowCloseModal(true)}>
                                    {copy.closeShift}
                                </Button>
                            </>
                        ) : (
                            <Button variant="primary" size="sm" icon={<Clock className="h-4 w-4" />} onClick={() => setShowOpenModal(true)}>
                                {copy.openShift}
                            </Button>
                        )}
                    </>
                )}
            />

            {session ? (
                <>
                    <section aria-label={copy.sessionActive} className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                                <div>
                                    <h2 className="text-sm font-semibold text-gray-900">{copy.sessionActive}</h2>
                                    <p className="text-xs text-gray-500">
                                        {formatMessage(copy.opened, { date: formatDateTime(session.opened_at, locale) })}
                                    </p>
                                </div>
                            </div>
                            {session.counter ? (
                                <div className="flex items-center gap-2 text-sm text-gray-700">
                                    <Monitor className="h-4 w-4 text-gray-400" aria-hidden />
                                    <span className="text-xs text-gray-500">{copy.counter}</span>
                                    <span className="font-medium">{session.counter.name}</span>
                                </div>
                            ) : null}
                        </div>
                        <ListStats stats={shiftStats} label={copy.shiftSummary} />
                        {summary?.paymentBreakdown?.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-gray-500">{copy.paymentBreakdown}:</span>
                                {summary.paymentBreakdown.map((row: any) => (
                                    <span key={row.method} className="rounded-md border border-gray-200 px-2 py-1">
                                        <span className="font-medium text-gray-700">{row.method}</span>
                                        <span className="ms-2 tabular-nums text-gray-500">{money(Number(row.amount))}</span>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </section>

                    <DataTable<CashTransaction>
                        tableId="cashier-cash-transactions"
                        title={copy.cashTransactions}
                        columns={txColumns}
                        data={visibleTransactions}
                        emptyMessage={t.shared.empty.noTransactions}
                        emptyIcon={<DollarSign className="h-16 w-16 text-gray-200" />}
                        searchPlaceholder={ui.searchMovements}
                        searchValue={txSearch}
                        onSearchChange={setTxSearch}
                        filters={txFilters}
                        filterLayout="row"
                        stats={txStats}
                        enableColumnFilters={false}
                        viewOptions
                    />
                </>
            ) : (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                    <AlertCircle className="mx-auto mb-3 h-12 w-12 text-gray-200" aria-hidden />
                    <h2 className="text-sm font-semibold text-gray-700">{copy.noActiveSession}</h2>
                    <p className="mt-1 text-xs text-gray-500">{copy.noActiveSessionHint}</p>
                </div>
            )}

            {/* Every till in this branch today. The API for the open ones has
                existed since counters shipped and nothing ever called it, so an
                owner with three counters running could not see any of them. */}
            <DataTable<CashierOverviewRow>
                tableId="cashier-tills-today"
                title={ui.tills}
                columns={tillColumns}
                data={visibleTills}
                isLoading={tillsLoading}
                getRowId={(row) => row.id}
                emptyMessage={ui.noTills}
                emptyIcon={<Monitor className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={ui.searchTills}
                searchValue={tillSearch}
                onSearchChange={setTillSearch}
                filters={tillFilters}
                filterLayout="row"
                stats={tillStats}
                enableColumnFilters={false}
                viewOptions
            />

            {/* Open Session Modal */}
            {showOpenModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowOpenModal(false)}>
                    <ModalHeader title={copy.openShiftTitle} onClose={() => setShowOpenModal(false)} />
                    <div className="space-y-4 overflow-y-auto p-4">
                        {counters.length > 0 && (
                            <Field label={copy.counter} htmlFor="open-shift-counter">
                                <Select
                                    id="open-shift-counter"
                                    value={selectedCounterId}
                                    onChange={(e) => setSelectedCounterId(e.target.value)}
                                >
                                    <option value="">{t.shared.form.walkInNoCounter}</option>
                                    {counters.map((c) => (
                                        <option key={c.id} value={c.id}>#{c.counter_number} — {c.name}</option>
                                    ))}
                                </Select>
                            </Field>
                        )}
                        <Field label={copy.openingCashAmount} htmlFor="open-shift-cash">
                            <Input
                                id="open-shift-cash"
                                type="number"
                                min="0"
                                value={openingCash || ''}
                                onChange={(e) => setOpeningCash(parseFloat(e.target.value) || 0)}
                                placeholder={t.shared.form.amountPlaceholder}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button type="button" variant="primary" size="md" className="w-full justify-center" onClick={handleOpenSession}>
                            {copy.openShift}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {/* Close Session Modal */}
            {showCloseModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowCloseModal(false)}>
                    <ModalHeader title={copy.closeShiftTitle} onClose={() => setShowCloseModal(false)} />
                    <div className="space-y-4 overflow-y-auto p-4">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <span className="block text-xs font-medium text-gray-500">{copy.expectedCash}</span>
                            <span className="block text-lg font-semibold tabular-nums text-gray-900">{money(expectedCash)}</span>
                            <span className="mt-1 block text-xs text-gray-500">{copy.expectedCashHint}</span>
                            {summary && (
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                                    <span>{copy.openingCash}: {money(Number(summary.openingCash))}</span>
                                    <span>{copy.cashSales}: {money(Number(summary.cashTakings))}</span>
                                    <span>{copy.refunds}: {money(Number(summary.refunds))}</span>
                                    <span>{copy.cashIn}/{copy.cashOut}: {money(Number(summary.cashIn) - Number(summary.cashOut))}</span>
                                </div>
                            )}
                        </div>
                        <Field label={copy.actualClosingCash} htmlFor="close-shift-cash">
                            <Input
                                id="close-shift-cash"
                                type="number"
                                min="0"
                                value={closingCash || ''}
                                onChange={(e) => setClosingCash(parseFloat(e.target.value) || 0)}
                                placeholder={t.shared.form.amountPlaceholder}
                            />
                        </Field>
                        {closingCash > 0 && (
                            <div className={`rounded-lg p-3 ${Math.abs(difference) < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                <span className="block text-xs font-medium">
                                    {Math.abs(difference) < 0.01
                                        ? copy.balanced
                                        : difference > 0
                                            ? copy.cashOver
                                            : copy.cashShort}
                                </span>
                                <span className="text-lg font-semibold tabular-nums">{money(difference)}</span>
                            </div>
                        )}
                    </div>
                    <ModalFooter>
                        <Button type="button" variant="danger" size="md" className="w-full justify-center" onClick={handleCloseSession}>
                            {copy.closeShift}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {/* Cash Transaction Modal */}
            {showTxModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowTxModal(false)}>
                    <ModalHeader title={copy.cashInOutTitle} onClose={() => setShowTxModal(false)} />
                    <div className="space-y-4 overflow-y-auto p-4">
                        <Field label={copy.type} htmlFor="cash-tx-type">
                            <Select id="cash-tx-type" value={txType} onChange={(e) => setTxType(e.target.value)}>
                                {CASH_TYPES.map((type) => (
                                    <option key={type} value={type}>{typeLabel(type)}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={t.shared.form.amountInOutHint} htmlFor="cash-tx-amount">
                            <Input
                                id="cash-tx-amount"
                                type="number"
                                value={txAmount || ''}
                                onChange={(e) => setTxAmount(parseFloat(e.target.value) || 0)}
                                placeholder={t.shared.form.amountPlaceholder}
                            />
                        </Field>
                        <Field label={copy.descriptionOptional} htmlFor="cash-tx-description">
                            <Input
                                id="cash-tx-description"
                                type="text"
                                value={txDescription}
                                onChange={(e) => setTxDescription(e.target.value)}
                                placeholder={t.shared.form.changeDescription}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button
                            type="button"
                            variant="primary"
                            size="md"
                            className="w-full justify-center"
                            onClick={handleAddTransaction}
                            disabled={txAmount === 0}
                        >
                            {copy.recordTransaction}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
