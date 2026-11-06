'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Boxes, Banknote, Building2, Play, Plus, Tag, TrendingDown, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Field, Input, StatusBadge } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';
import { toast } from '@/lib/toast';

interface FixedAsset {
    id: string;
    asset_code: string;
    name: string;
    purchase_date: string;
    cost: number;
    residual_value: number;
    useful_life_months: number;
    depreciation_method: string;
    accumulated_depreciation: number;
    is_active: boolean;
    /** Free text; null is an uncategorised asset. */
    category?: string | null;
}

const METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE'] as const;
const STATUSES = ['active', 'inactive'] as const;

const columnHelper = createColumnHelper<FixedAsset>();

/** The server's limit on a category (`FIXED_ASSET_CATEGORY_MAX_LENGTH`). */
const CATEGORY_MAX_LENGTH = 60;
/** The Category chip's value for assets with no category. */
const UNCATEGORISED = '__none__';
const CATEGORY_LIST_ID = 'fixed-asset-categories';

/** Categories are typed by hand, so "Vehicles" and "vehicles " are one category. */
const categoryKeyOf = (asset: FixedAsset) => asset.category?.trim().toLowerCase() || UNCATEGORISED;

const statusOf = (asset: FixedAsset) => (asset.is_active === false ? 'inactive' : 'active');
const bookValueOf = (asset: FixedAsset) => Number(asset.cost || 0) - Number(asset.accumulated_depreciation || 0);

const EMPTY_FORM = { assetCode: '', name: '', category: '', purchaseDate: '', cost: '', residualValue: '0', usefulLifeMonths: '60', depreciationMethod: 'STRAIGHT_LINE' };

export default function FixedAssetsPage() {
    const { t, locale } = useI18n();
    const fa = t.fixedAssets;
    const ui = t.accountingFinanceUi.fixedAssets;
    const [assets, setAssets] = useState<FixedAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [creating, setCreating] = useState(false);
    const [showRunDep, setShowRunDep] = useState(false);
    const [depYear, setDepYear] = useState(new Date().getFullYear());
    const [depMonth, setDepMonth] = useState(new Date().getMonth() + 1);
    const [runningDep, setRunningDep] = useState(false);
    const [depResult, setDepResult] = useState<{ ok: boolean; text: string } | null>(null);

    const [search, setSearch] = useState('');
    const [statuses, setStatuses] = useState<string[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [methods, setMethods] = useState<string[]>([]);
    const [categoryTarget, setCategoryTarget] = useState<FixedAsset | null>(null);
    const [categoryDraft, setCategoryDraft] = useState('');
    const [savingCategory, setSavingCategory] = useState(false);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [purchaseRange, setPurchaseRange] = useState<CreatedRange | null>(null);
    const [costFilter, setCostFilter] = useState<NumberCondition | null>(null);
    const [bookValueFilter, setBookValueFilter] = useState<NumberCondition | null>(null);

    useEffect(() => { void load(); }, []);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listFixedAssets();
            setAssets(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setError(e?.message ?? fa.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        setError(null);
        try {
            await api.createFixedAsset({
                assetCode: form.assetCode,
                name: form.name,
                category: form.category.trim() || undefined,
                purchaseDate: form.purchaseDate,
                cost: parseFloat(form.cost),
                residualValue: parseFloat(form.residualValue) || 0,
                usefulLifeMonths: parseInt(form.usefulLifeMonths),
                depreciationMethod: form.depreciationMethod,
            });
            setShowCreate(false);
            setForm(EMPTY_FORM);
            await load();
        } catch (e: any) {
            setError(e?.message ?? fa.createFailed);
        } finally {
            setCreating(false);
        }
    };

    const openCategory = (asset: FixedAsset) => {
        setCategoryTarget(asset);
        setCategoryDraft(asset.category ?? '');
        setCategoryError(null);
    };

    const closeCategory = () => {
        if (savingCategory) return;
        setCategoryTarget(null);
    };

    const handleSaveCategory = async () => {
        if (!categoryTarget) return;
        setSavingCategory(true);
        setCategoryError(null);
        try {
            const category = categoryDraft.trim() || null;
            await api.updateFixedAsset(categoryTarget.id, { category });
            setAssets((current) => current.map((asset) => (asset.id === categoryTarget.id ? { ...asset, category } : asset)));
            toast.success(ui.categorySaved);
            setCategoryTarget(null);
        } catch (e: any) {
            setCategoryError(e?.message ?? t.accountingShared.saveFailed);
        } finally {
            setSavingCategory(false);
        }
    };

    const handleRunDepreciation = async () => {
        setRunningDep(true);
        setDepResult(null);
        try {
            const result = await api.runDepreciation({ year: depYear, month: depMonth });
            setDepResult({ ok: true, text: formatMessage(fa.depreciationPosted, { count: result.processed ?? 0 }) });
            await load();
        } catch (e: any) {
            setDepResult({ ok: false, text: formatMessage(fa.depreciationFailed, { message: e?.message ?? t.common.error }) });
        } finally {
            setRunningDep(false);
        }
    };

    const monthNames = useMemo(() => {
        const format = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
        return Array.from({ length: 12 }, (_, i) => format.format(new Date(Date.UTC(2000, i, 1))));
    }, [locale]);

    const methodLabel = (method: string) => (method === 'DECLINING_BALANCE' ? fa.decliningBalance : fa.straightLine);
    const statusLabel = (status: string) => (status === 'inactive' ? ui.inactive : ui.active);

    /** One entry per category the loaded assets use, spelled as first seen. */
    const categoryNames = useMemo(() => {
        const names = new Map<string, string>();
        for (const asset of assets) {
            const key = categoryKeyOf(asset);
            if (key !== UNCATEGORISED && !names.has(key)) names.set(key, asset.category!.trim());
        }
        return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
    }, [assets, locale]);

    const filtered = useMemo(
        () => assets.filter((asset) => {
            if (!matchesAnyOf(statuses, statusOf(asset))) return false;
            if (!matchesAnyOf(categories, categoryKeyOf(asset))) return false;
            if (!matchesAnyOf(methods, asset.depreciation_method)) return false;
            if (!inDateRange(asset.purchase_date, purchaseRange)) return false;
            if (!matchesNumberCondition(Number(asset.cost || 0), costFilter)) return false;
            if (!matchesNumberCondition(bookValueOf(asset), bookValueFilter)) return false;
            return matchesSearch(search, asset.asset_code, asset.name, asset.category);
        }),
        [assets, statuses, categories, methods, purchaseRange, costFilter, bookValueFilter, search],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'multi-select',
                label: t.common.status,
                value: statuses,
                onChange: setStatuses,
                options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
            {
                id: 'category',
                type: 'multi-select',
                label: t.accountingShared.category,
                value: categories,
                onChange: setCategories,
                options: [
                    ...categoryNames.map(([value, label]) => ({ value, label })),
                    { value: UNCATEGORISED, label: ui.uncategorised },
                ],
            },
            {
                id: 'purchaseDate',
                type: 'date-range',
                label: fa.purchaseDate,
                value: purchaseRange,
                onChange: setPurchaseRange,
                operators: true,
            },
            {
                id: 'cost',
                type: 'number',
                label: fa.cost,
                value: costFilter,
                onChange: setCostFilter,
                money: true,
            },
            {
                id: 'method',
                type: 'multi-select',
                label: fa.method,
                value: methods,
                onChange: setMethods,
                options: METHODS.map((value) => ({ value, label: methodLabel(value) })),
            },
            {
                id: 'bookValue',
                type: 'number',
                label: fa.netBookValue,
                value: bookValueFilter,
                onChange: setBookValueFilter,
                money: true,
                more: true,
            },
        ],
        [t, fa, ui, statuses, categories, categoryNames, purchaseRange, costFilter, methods, bookValueFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const n = (value: number) => value.toLocaleString(locale);
        let cost = 0;
        let accumulated = 0;
        let fullyDepreciated = 0;
        for (const asset of filtered) {
            cost += Number(asset.cost || 0);
            accumulated += Number(asset.accumulated_depreciation || 0);
            if (bookValueOf(asset) <= Number(asset.residual_value || 0)) fullyDepreciated += 1;
        }
        const items: ListStat[] = [
            { id: 'count', icon: <Boxes aria-hidden />, label: ui.assets, value: n(filtered.length) },
            { id: 'cost', icon: <Banknote aria-hidden />, label: fa.cost, value: money(cost) },
            { id: 'accumulated', icon: <TrendingDown aria-hidden />, label: ui.accumulatedDepreciation, value: money(accumulated) },
            { id: 'bookValue', icon: <Wallet aria-hidden />, label: fa.netBookValue, value: money(cost - accumulated) },
            { id: 'fullyDepreciated', icon: <Building2 aria-hidden />, label: ui.fullyDepreciated, value: n(fullyDepreciated) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [filtered, loading, locale, fa, ui]);

    const columns: ColumnDef<FixedAsset, any>[] = useMemo(
        () => [
            columnHelper.accessor('asset_code', {
                header: fa.columns.code,
                cell: (info) => <span className="font-mono">{info.getValue()}</span>,
                size: 100,
            }),
            columnHelper.accessor('name', {
                header: fa.columns.name,
                size: 200,
            }),
            columnHelper.accessor((row) => row.category?.trim() ?? '', {
                id: 'category',
                header: t.accountingShared.category,
                cell: (info) => info.getValue() || <span className="text-gray-400">—</span>,
                meta: { hideOnMobile: true },
                size: 140,
            }),
            columnHelper.accessor('purchase_date', {
                header: fa.purchaseDate,
                cell: (info) => formatDate(info.getValue(), locale),
                sortingFn: 'datetime',
                meta: { hideOnMobile: true },
                size: 120,
            }),
            columnHelper.accessor((row) => Number(row.cost || 0), {
                id: 'cost',
                header: fa.columns.cost,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor((row) => Number(row.accumulated_depreciation || 0), {
                id: 'accumulated_depreciation',
                header: fa.columns.accumDep,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end', hideOnMobile: true },
                size: 120,
            }),
            columnHelper.accessor(bookValueOf, {
                id: 'book_value',
                header: fa.columns.netBookValue,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 130,
            }),
            columnHelper.accessor('useful_life_months', {
                header: fa.usefulLifeMonths,
                cell: (info) => Number(info.getValue() || 0).toLocaleString(locale),
                meta: { align: 'end', hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor('depreciation_method', {
                header: fa.columns.method,
                cell: (info) => (
                    <span title={methodLabel(info.getValue())}>
                        {info.getValue() === 'STRAIGHT_LINE' ? 'SL' : 'DB'}
                    </span>
                ),
                meta: { hideOnMobile: true },
                size: 90,
            }),
            columnHelper.accessor(statusOf, {
                id: 'status',
                header: t.common.status,
                cell: (info) => (
                    info.getValue() === 'active'
                        ? <StatusBadge tone="success">{ui.active}</StatusBadge>
                        : <StatusBadge tone="neutral">{ui.inactive}</StatusBadge>
                ),
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Tag />}
                            label={ui.setCategory}
                            onClick={() => openCategory(row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 70,
            }),
        ],
        [t, fa, ui, locale],
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={fa.title}
                subtitle={fa.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    fa.title,
                    'accounting',
                )}
                actions={(
                    <>
                        <Button variant="secondary" icon={<Play className="w-3.5 h-3.5" />} onClick={() => setShowRunDep(true)}>
                            {ui.runDepreciation}
                        </Button>
                        <Button variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
                            {ui.addAsset}
                        </Button>
                    </>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            {showRunDep && (
                <CompactSection title={fa.runDepreciation}>
                    <div className="flex gap-3 items-end flex-wrap">
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>{fa.year}</span>
                            <select value={depYear} onChange={(e) => setDepYear(Number(e.target.value))} className={compactDensity.formField}>
                                {[depYear - 1, depYear, depYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>{fa.month}</span>
                            <select value={depMonth} onChange={(e) => setDepMonth(Number(e.target.value))} className={compactDensity.formField}>
                                {monthNames.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
                            </select>
                        </label>
                        <Button variant="primary" onClick={handleRunDepreciation} loading={runningDep}>
                            {runningDep ? fa.running : fa.runNow}
                        </Button>
                        <Button variant="secondary" onClick={() => { setShowRunDep(false); setDepResult(null); }}>
                            {t.common.close}
                        </Button>
                    </div>
                    {depResult && (
                        <div className="mt-2">
                            <Alert tone={depResult.ok ? 'success' : 'danger'}>{depResult.text}</Alert>
                        </div>
                    )}
                </CompactSection>
            )}

            {showCreate && (
                <CompactSection title={fa.addAsset}>
                    <div className={`grid grid-cols-2 gap-3 ${compactDensity.formStack}`}>
                        {([
                            { label: fa.assetCode, key: 'assetCode', placeholder: fa.placeholders.assetCode },
                            { label: fa.name, key: 'name', placeholder: fa.placeholders.name },
                            { label: t.accountingShared.category, key: 'category', placeholder: ui.categoryPlaceholder, list: CATEGORY_LIST_ID, maxLength: CATEGORY_MAX_LENGTH },
                            { label: fa.purchaseDate, key: 'purchaseDate', type: 'date', placeholder: '' },
                            { label: fa.cost, key: 'cost', type: 'number', placeholder: '0.00' },
                            { label: fa.residualValue, key: 'residualValue', type: 'number', placeholder: '0.00' },
                            { label: fa.usefulLifeMonths, key: 'usefulLifeMonths', type: 'number', placeholder: fa.placeholders.usefulLife },
                        ] as Array<{ label: string; key: keyof typeof EMPTY_FORM; type?: string; placeholder: string; list?: string; maxLength?: number }>).map(({ label, key, type, placeholder, list, maxLength }) => (
                            <label key={key} className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{label}</span>
                                <input type={type ?? 'text'} value={form[key]} placeholder={placeholder} list={list} maxLength={maxLength}
                                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                                    className={compactDensity.formField} />
                            </label>
                        ))}
                    </div>
                    <label className="block mt-3">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{fa.method}</span>
                        <select value={form.depreciationMethod} onChange={(e) => setForm((f) => ({ ...f, depreciationMethod: e.target.value }))} className={compactDensity.formField}>
                            {METHODS.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}
                        </select>
                    </label>
                    <div className="flex gap-2 mt-3">
                        <Button variant="secondary" onClick={() => setShowCreate(false)}>{t.common.cancel}</Button>
                        <Button variant="primary" onClick={handleCreate} loading={creating}>
                            {creating ? fa.saving : fa.saveAsset}
                        </Button>
                    </div>
                </CompactSection>
            )}

            {/* Suggests the categories already in use, so one is not typed two ways. */}
            <datalist id={CATEGORY_LIST_ID}>
                {categoryNames.map(([key, name]) => <option key={key} value={name} />)}
            </datalist>

            <DataTable
                tableId="fixed-assets"
                title={fa.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={ui.search}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={assets.length === 0 ? fa.emptyMessage : t.common.noData}
                emptyIcon={<Boxes className="w-16 h-16 text-gray-200" />}
            />

            {categoryTarget && (
                <ModalShell size="sm" onBackdropClick={closeCategory}>
                    <ModalHeader
                        title={ui.setCategory}
                        subtitle={`${categoryTarget.asset_code} · ${categoryTarget.name}`}
                        onClose={closeCategory}
                        closeLabel={t.common.close}
                    />
                    <div className="space-y-4 overflow-y-auto p-4">
                        <Field label={t.accountingShared.category} hint={ui.categoryHint} error={categoryError ?? undefined}>
                            <Input
                                type="text"
                                value={categoryDraft}
                                onChange={(e) => { setCategoryDraft(e.target.value); setCategoryError(null); }}
                                placeholder={ui.categoryPlaceholder}
                                aria-label={t.accountingShared.category}
                                list={CATEGORY_LIST_ID}
                                maxLength={CATEGORY_MAX_LENGTH}
                                error={!!categoryError}
                                autoFocus
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeCategory} disabled={savingCategory}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={() => void handleSaveCategory()} loading={savingCategory}>
                            {t.common.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
