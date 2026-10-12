'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Checkbox, CompactStat, Field, Input, PageHeader, PageShell, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatMessage, useI18n } from '@/lib/i18n';
import { hasPermission, isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

type CostBasis = 'WEIGHTED_AVERAGE' | 'LATEST_COST' | 'UNCOSTED';
type StatusFilter = 'ALL' | 'UNCOSTED' | 'COSTED';
type ChangeReason = 'CORRECTION' | 'WRITE_DOWN';
type AdjustmentReason = 'OPENING_COST' | ChangeReason;

interface ProductCostRow {
    product: { id: string; name: string; sku?: string | null };
    onHand: number;
    averageCost: number | null;
    priceListCost: number | null;
    effectiveCost: number | null;
    costBasis: CostBasis;
    stockValue: number | null;
    lastPurchaseCost: number | null;
    lastPurchaseAt: string | null;
}

interface ProductCostsResponse {
    items: ProductCostRow[];
    pagination: { total: number; page: number; limit: number; pages: number };
    costingMethod: 'WEIGHTED_AVERAGE' | 'LATEST_COST';
    summary: { productCount: number; uncostedCount: number; uncostedInStockCount: number };
}

interface CostAdjustment {
    id: string;
    product: { id: string; name: string; sku?: string | null };
    reason: AdjustmentReason;
    previousCost: number | null;
    newCost: number;
    qtyOnHand: number;
    valueChange: number | null;
    note: string | null;
    createdBy: { id: string; name: string } | null;
    createdAt: string;
}

const PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 20;

const columnHelper = createColumnHelper<ProductCostRow>();
const historyHelper = createColumnHelper<CostAdjustment>();

/** A typed cost, or null when the box is blank or holds something that is not one. */
function parseCost(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Inventory → Product Costs. Lists what every stock product costs and lets
 * someone holding ADJUST_PRODUCT_COST state it: an opening cost for stock with
 * none, or a correction or write-down for stock that has one. Uncosted products
 * sell with no cost of goods sold, so this is where gross profit on them is
 * made knowable.
 */
export default function ProductCostsPage() {
    const { t, locale } = useI18n();
    const strings = t.productCosts;
    const { permissions, role } = useTenantPlanFeatures();
    // OWNER bypasses the guard server-side and may hold no grant rows at all.
    const canAdjust = isOwner(role) || hasPermission(permissions, 'ADJUST_PRODUCT_COST');

    const [data, setData] = useState<ProductCostsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('UNCOSTED');
    const [inStockOnly, setInStockOnly] = useState(true);
    const [page, setPage] = useState(1);
    // Typed costs, keyed by product id. Kept across pages so a batch can be
    // built up before saving.
    const [edits, setEdits] = useState<Record<string, string>>({});
    // Each edited product's average cost when it was typed against — decides
    // whether saving it needs a reason.
    const [editedBasis, setEditedBasis] = useState<Record<string, number | null>>({});
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [reason, setReason] = useState<ChangeReason | ''>('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [history, setHistory] = useState<CostAdjustment[]>([]);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyLoading, setHistoryLoading] = useState(true);

    // Debounced so a search is one request, not one per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => {
            setAppliedSearch(search.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result: ProductCostsResponse = await api.getProductCosts({
                search: appliedSearch || undefined,
                status,
                inStockOnly: inStockOnly || undefined,
                page,
                limit: PAGE_SIZE,
            });
            setData(result);
            setError(null);
        } catch (err) {
            setData(null);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [appliedSearch, status, inStockOnly, page]);

    const loadHistory = useCallback(async (nextPage: number) => {
        setHistoryLoading(true);
        try {
            const result = await api.getProductCostAdjustments({ page: nextPage, limit: HISTORY_PAGE_SIZE });
            setHistory((prev) => (nextPage === 1 ? result.items : [...prev, ...result.items]));
            setHistoryTotal(result.total);
            setHistoryPage(nextPage);
        } catch {
            // The log is secondary to the table above; an empty log with the
            // table working is a better failure than a page-level error.
            if (nextPage === 1) setHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        void loadHistory(1);
    }, [loadHistory]);

    const setEdit = useCallback((row: ProductCostRow, value: string) => {
        setEdits((prev) => {
            const next = { ...prev };
            if (value === '') delete next[row.product.id];
            else next[row.product.id] = value;
            return next;
        });
        setEditedBasis((prev) => ({ ...prev, [row.product.id]: row.averageCost }));
    }, []);

    const rows = data?.items ?? [];

    const pending = useMemo(
        () => Object.entries(edits)
            .map(([productId, raw]) => ({ productId, unitCost: parseCost(raw) }))
            .filter((item): item is { productId: string; unitCost: number } => item.unitCost !== null),
        [edits],
    );
    const invalidCount = Object.values(edits).filter((raw) => parseCost(raw) === null).length;
    // Mirrors the server, which decides from the average-cost pool alone: a
    // product with only a price-list cost gets its first average as an opening
    // cost, so it needs no reason.
    const changingCount = pending.filter((item) => editedBasis[item.productId] != null).length;
    const openingCount = pending.length - changingCount;

    const fillFromLastPurchase = () => {
        for (const row of rows) {
            if (row.costBasis === 'UNCOSTED' && row.lastPurchaseCost !== null && edits[row.product.id] === undefined) {
                setEdit(row, String(row.lastPurchaseCost));
            }
        }
    };
    const canFill = canAdjust && rows.some(
        (row) => row.costBasis === 'UNCOSTED' && row.lastPurchaseCost !== null && edits[row.product.id] === undefined,
    );

    const openConfirm = () => {
        setSaveError(null);
        setReason('');
        setConfirmOpen(true);
    };

    const save = async () => {
        if (changingCount > 0 && !reason) {
            setSaveError(strings.confirm.reasonRequired);
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const result = await api.createProductCostAdjustments({
                items: pending,
                reason: changingCount > 0 && reason ? reason : undefined,
                note: note.trim() || undefined,
            });
            toast.success(formatMessage(strings.saved, { count: result?.adjusted ?? pending.length }));
            setConfirmOpen(false);
            setEdits({});
            setEditedBasis({});
            setNote('');
            void load();
            void loadHistory(1);
        } catch (err) {
            // Shown in the dialog, beside the choice that caused it: the batch
            // is all-or-nothing, so the message names the product that failed.
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const columns = useMemo<ColumnDef<ProductCostRow, any>[]>(() => [
        columnHelper.accessor((row) => row.product.name, {
            id: 'product',
            header: strings.columns.product,
            cell: (info) => (
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{info.row.original.product.name}</div>
                    {info.row.original.product.sku ? (
                        <div className="text-xs text-gray-500">{info.row.original.product.sku}</div>
                    ) : null}
                </div>
            ),
        }),
        columnHelper.accessor('onHand', {
            header: strings.columns.onHand,
            cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
            size: 90,
        }),
        columnHelper.accessor((row) => row.effectiveCost ?? '', {
            id: 'currentCost',
            header: strings.columns.currentCost,
            cell: (info) => {
                const row = info.row.original;
                return (
                    <div>
                        <div className="text-sm text-gray-900">{row.effectiveCost === null ? '—' : formatBDT(row.effectiveCost)}</div>
                        <div className={`text-xs ${row.costBasis === 'UNCOSTED' ? 'text-amber-600' : 'text-gray-500'}`}>
                            {strings.basis[row.costBasis]}
                        </div>
                    </div>
                );
            },
            size: 130,
        }),
        columnHelper.accessor((row) => row.lastPurchaseCost ?? '', {
            id: 'lastPurchase',
            header: strings.columns.lastPurchase,
            cell: (info) => {
                const row = info.row.original;
                if (row.lastPurchaseCost === null) return <span className="text-sm text-gray-400">—</span>;
                return (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700">{formatBDT(row.lastPurchaseCost)}</span>
                        {canAdjust ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEdit(row, String(row.lastPurchaseCost))}
                                aria-label={formatMessage(strings.useLastPurchaseFor, { product: row.product.name })}
                            >
                                {strings.useLastPurchase}
                            </Button>
                        ) : null}
                    </div>
                );
            },
            meta: { hideOnMobile: true },
            size: 150,
        }),
        ...(canAdjust
            ? [
                columnHelper.display({
                    id: 'newCost',
                    header: strings.columns.newCost,
                    cell: (info) => {
                        const row = info.row.original;
                        const raw = edits[row.product.id] ?? '';
                        return (
                            <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={raw}
                                onChange={(e) => setEdit(row, e.target.value)}
                                placeholder={row.effectiveCost === null ? strings.newCostPlaceholder : String(row.effectiveCost)}
                                aria-label={formatMessage(strings.newCostFor, { product: row.product.name })}
                                error={raw !== '' && parseCost(raw) === null}
                                className="w-28"
                            />
                        );
                    },
                    size: 140,
                }),
            ]
            : []),
        columnHelper.accessor((row) => row.stockValue ?? '', {
            id: 'stockValue',
            header: strings.columns.stockValue,
            cell: (info) => {
                const value = info.row.original.stockValue;
                return <span className="text-sm text-gray-700">{value === null ? '—' : formatBDT(value)}</span>;
            },
            meta: { hideOnMobile: true },
            size: 130,
        }),
    ], [strings, canAdjust, edits, setEdit]);

    const historyColumns = useMemo<ColumnDef<CostAdjustment, any>[]>(() => [
        historyHelper.accessor('createdAt', {
            header: strings.history.columns.date,
            cell: (info) => <span className="text-xs text-gray-600">{formatDateTime(info.getValue(), locale)}</span>,
            size: 150,
        }),
        historyHelper.accessor((row) => row.product.name, {
            id: 'product',
            header: strings.history.columns.product,
            cell: (info) => <span className="text-sm text-gray-900">{info.getValue()}</span>,
        }),
        historyHelper.accessor('reason', {
            header: strings.history.columns.reason,
            cell: (info) => <span className="text-xs text-gray-700">{strings.reasons[info.getValue() as AdjustmentReason]}</span>,
            size: 120,
        }),
        historyHelper.accessor('newCost', {
            header: strings.history.columns.change,
            cell: (info) => {
                const row = info.row.original;
                return (
                    <span className="text-sm text-gray-900">
                        {row.previousCost === null ? '—' : formatBDT(row.previousCost)} → {formatBDT(row.newCost)}
                    </span>
                );
            },
            size: 170,
        }),
        historyHelper.accessor('qtyOnHand', {
            header: strings.history.columns.quantity,
            cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
            meta: { hideOnMobile: true },
            size: 80,
        }),
        historyHelper.accessor((row) => row.valueChange ?? '', {
            id: 'valueChange',
            header: strings.history.columns.valueChange,
            cell: (info) => {
                const value = info.row.original.valueChange;
                if (value === null) return <span className="text-sm text-gray-400">—</span>;
                return <span className={`text-sm ${value < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatBDT(value)}</span>;
            },
            meta: { hideOnMobile: true },
            size: 120,
        }),
        historyHelper.accessor((row) => row.createdBy?.name ?? '', {
            id: 'by',
            header: strings.history.columns.by,
            cell: (info) => <span className="text-xs text-gray-600">{info.getValue() || '—'}</span>,
            meta: { hideOnMobile: true },
            size: 140,
        }),
        historyHelper.accessor((row) => row.note ?? '', {
            id: 'note',
            header: strings.history.columns.note,
            cell: (info) => <span className="text-xs text-gray-600">{info.getValue() || '—'}</span>,
            meta: { hideOnMobile: true },
        }),
    ], [strings, locale]);

    const summary = data?.summary;
    const pagination = data?.pagination;

    return (
        <PageShell>
            <PageHeader
                title={strings.title}
                subtitle={strings.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    strings.title,
                    'inventory',
                )}
                actions={canAdjust ? (
                    <>
                        <Button variant="secondary" size="sm" onClick={fillFromLastPurchase} disabled={!canFill}>
                            {strings.fillFromLastPurchase}
                        </Button>
                        <Button size="sm" onClick={openConfirm} disabled={pending.length === 0 || invalidCount > 0}>
                            {formatMessage(strings.saveCosts, { count: pending.length })}
                        </Button>
                    </>
                ) : undefined}
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <CompactStat label={strings.stats.products} value={summary?.productCount ?? '—'} />
                <CompactStat
                    label={strings.stats.uncosted}
                    value={summary?.uncostedCount ?? '—'}
                    tone={summary && summary.uncostedCount > 0 ? 'warning' : 'default'}
                />
                <CompactStat
                    label={strings.stats.uncostedInStock}
                    value={summary?.uncostedInStockCount ?? '—'}
                    tone={summary && summary.uncostedInStockCount > 0 ? 'warning' : 'default'}
                />
                <CompactStat
                    label={strings.stats.costingMethod}
                    value={data ? strings.costingMethods[data.costingMethod] : '—'}
                />
            </div>

            {summary && summary.uncostedInStockCount > 0 ? (
                <Alert tone="warning">
                    {formatMessage(strings.uncostedBanner, { count: summary.uncostedInStockCount })}
                </Alert>
            ) : null}

            {!canAdjust ? <Alert tone="info">{strings.readOnlyNotice}</Alert> : null}

            {error ? <Alert tone="danger">{formatMessage(strings.loadError, { message: error })}</Alert> : null}

            {invalidCount > 0 ? <Alert tone="danger">{strings.invalidCost}</Alert> : null}

            <div className="bg-white border border-gray-100 rounded-lg p-3 flex flex-wrap gap-3 items-center">
                <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={strings.searchPlaceholder}
                    aria-label={strings.searchPlaceholder}
                    className="w-64"
                />
                <Select
                    value={status}
                    onChange={(e) => {
                        setStatus(e.target.value as StatusFilter);
                        setPage(1);
                    }}
                    aria-label={strings.statusLabel}
                >
                    <option value="UNCOSTED">{strings.statusFilter.UNCOSTED}</option>
                    <option value="COSTED">{strings.statusFilter.COSTED}</option>
                    <option value="ALL">{strings.statusFilter.ALL}</option>
                </Select>
                <label className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                    <Checkbox
                        checked={inStockOnly}
                        onChange={(e) => {
                            setInStockOnly(e.target.checked);
                            setPage(1);
                        }}
                    />
                    {strings.inStockOnly}
                </label>
            </div>

            <DataTable
                tableId="inventory-product-costs"
                title={strings.title}
                columns={columns}
                data={rows}
                isLoading={loading}
                emptyMessage={error ? strings.loadErrorEmpty : strings.emptyMessage}
                getRowId={(row) => row.product.id}
                showSearch={false}
            />

            {pagination && pagination.pages > 1 ? (
                <div className="flex items-center justify-end gap-2 text-xs text-gray-600">
                    <Button variant="secondary" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
                        {strings.previousPage}
                    </Button>
                    <span>{formatMessage(strings.pageOf, { page: pagination.page, pages: pagination.pages })}</span>
                    <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pagination.pages || loading}>
                        {strings.nextPage}
                    </Button>
                </div>
            ) : null}

            <section className="space-y-3">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">{strings.history.title}</h2>
                    <p className="text-xs text-gray-500">{strings.history.subtitle}</p>
                </div>
                <DataTable
                    tableId="inventory-product-cost-adjustments"
                    title={strings.history.title}
                    columns={historyColumns}
                    data={history}
                    isLoading={historyLoading && history.length === 0}
                    emptyMessage={strings.history.empty}
                    getRowId={(row) => row.id}
                    showSearch={false}
                />
                {history.length < historyTotal ? (
                    <div className="flex justify-center">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void loadHistory(historyPage + 1)}
                            disabled={historyLoading}
                        >
                            {strings.history.loadMore}
                        </Button>
                    </div>
                ) : null}
            </section>

            {confirmOpen ? (
                <ModalShell size="md" onBackdropClick={() => !saving && setConfirmOpen(false)} dismissOnBackdrop={false}>
                    <ModalHeader
                        title={strings.confirm.title}
                        onClose={() => !saving && setConfirmOpen(false)}
                        closeLabel={strings.confirm.cancel}
                    />
                    <div className="p-4 space-y-4 text-sm text-gray-700">
                        <p>{formatMessage(strings.confirm.intro, { count: pending.length })}</p>
                        {openingCount > 0 ? (
                            <p>{formatMessage(strings.confirm.openingCount, { count: openingCount })}</p>
                        ) : null}
                        {changingCount > 0 ? (
                            <Field
                                label={formatMessage(strings.confirm.changeCount, { count: changingCount })}
                                htmlFor="cost-change-reason"
                                required
                                hint={reason === 'WRITE_DOWN' ? strings.confirm.writeDownHint : undefined}
                            >
                                <Select
                                    id="cost-change-reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value as ChangeReason | '')}
                                    error={Boolean(saveError) && !reason}
                                    className="w-full"
                                >
                                    <option value="">{strings.confirm.reasonPlaceholder}</option>
                                    <option value="CORRECTION">{strings.confirm.reasonCorrection}</option>
                                    <option value="WRITE_DOWN">{strings.confirm.reasonWriteDown}</option>
                                </Select>
                            </Field>
                        ) : null}
                        <Field label={strings.confirm.noteLabel} htmlFor="cost-change-note">
                            <Textarea
                                id="cost-change-note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder={strings.confirm.notePlaceholder}
                                maxLength={500}
                                rows={2}
                                className="w-full"
                            />
                        </Field>
                        <Alert tone="info" title={strings.confirm.accountingTitle}>
                            {strings.confirm.accountingNote}
                        </Alert>
                        {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
                    </div>
                    <ModalFooter>
                        <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>
                            {strings.confirm.cancel}
                        </Button>
                        <Button onClick={save} loading={saving} disabled={saving}>
                            {saving ? strings.confirm.saving : strings.confirm.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            ) : null}
        </PageShell>
    );
}
