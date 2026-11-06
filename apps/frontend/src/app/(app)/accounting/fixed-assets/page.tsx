'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Boxes, Banknote, Building2, Play, Plus, Tag, TrendingDown, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Field, FormGrid, Input, Select, StatusBadge } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
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
type AssetFormKey = keyof typeof EMPTY_FORM;
type AssetFormErrors = Partial<Record<AssetFormKey, string>>;

export default function FixedAssetsPage() {
    const { t, locale } = useI18n();
    const fa = t.fixedAssets;
    const ui = t.accountingFinanceUi.fixedAssets;
    const [assets, setAssets] = useState<FixedAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<AssetFormErrors>({});
    const [creating, setCreating] = useState(false);
    const [showRunDep, setShowRunDep] = useState(false);
    // The month to depreciate defaults to this one on the workspace's calendar.
    const [depYear, setDepYear] = useState(() => Number(tenantDateOnly().slice(0, 4)));
    const [depMonth, setDepMonth] = useState(() => Number(tenantDateOnly().slice(5, 7)));
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

    /** What is missing or not a number, per field — shown under each field before anything is sent. */
    const validateForm = (): AssetFormErrors => {
        const errors: AssetFormErrors = {};
        const required = t.common.required;
        const enterAmount = t.common.dataTable.enterAmount;
        if (!form.assetCode.trim()) errors.assetCode = required;
        if (!form.name.trim()) errors.name = required;
        if (!form.purchaseDate) errors.purchaseDate = required;
        if (!form.cost.trim()) errors.cost = required;
        else if (!(parseFloat(form.cost) > 0)) errors.cost = enterAmount;
        if (form.residualValue.trim() && !(parseFloat(form.residualValue) >= 0)) errors.residualValue = enterAmount;
        if (!form.usefulLifeMonths.trim()) errors.usefulLifeMonths = required;
        else if (!(parseInt(form.usefulLifeMonths) >= 1)) errors.usefulLifeMonths = enterAmount;
        return errors;
    };

    const setFormField = (key: AssetFormKey, value: string) => {
        setForm((f) => ({ ...f, [key]: value }));
        setFormErrors((errors) => (errors[key] ? { ...errors, [key]: undefined } : errors));
    };

    const closeCreate = () => {
        setShowCreate(false);
        setFormErrors({});
    };

    const handleCreate = async () => {
        const errors = validateForm();
        setFormErrors(errors);
        if (Object.values(errors).some(Boolean)) return;
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
            closeCreate();
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
                        <Field label={fa.year} htmlFor="fixed-asset-dep-year">
                            <Select id="fixed-asset-dep-year" value={depYear} onChange={(e) => setDepYear(Number(e.target.value))}>
                                {[depYear - 1, depYear, depYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                            </Select>
                        </Field>
                        <Field label={fa.month} htmlFor="fixed-asset-dep-month">
                            <Select id="fixed-asset-dep-month" value={depMonth} onChange={(e) => setDepMonth(Number(e.target.value))}>
                                {monthNames.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
                            </Select>
                        </Field>
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
                    <FormGrid>
                        {([
                            { label: fa.assetCode, key: 'assetCode', placeholder: fa.placeholders.assetCode, required: true },
                            { label: fa.name, key: 'name', placeholder: fa.placeholders.name, required: true },
                            { label: t.accountingShared.category, key: 'category', placeholder: ui.categoryPlaceholder, list: CATEGORY_LIST_ID, maxLength: CATEGORY_MAX_LENGTH },
                            { label: fa.purchaseDate, key: 'purchaseDate', type: 'date', placeholder: '', required: true },
                            { label: fa.cost, key: 'cost', type: 'number', placeholder: '0.00', required: true },
                            { label: fa.residualValue, key: 'residualValue', type: 'number', placeholder: '0.00' },
                            { label: fa.usefulLifeMonths, key: 'usefulLifeMonths', type: 'number', placeholder: fa.placeholders.usefulLife, required: true },
                        ] as Array<{ label: string; key: AssetFormKey; type?: string; placeholder: string; list?: string; maxLength?: number; required?: boolean }>).map(({ label, key, type, placeholder, list, maxLength, required }) => (
                            <Field key={key} label={label} htmlFor={`fixed-asset-${key}`} required={required} error={formErrors[key]}>
                                <Input
                                    id={`fixed-asset-${key}`}
                                    type={type ?? 'text'}
                                    inputMode={type === 'number' ? 'decimal' : undefined}
                                    value={form[key]}
                                    placeholder={placeholder}
                                    list={list}
                                    maxLength={maxLength}
                                    error={Boolean(formErrors[key])}
                                    onChange={(e) => setFormField(key, e.target.value)}
                                />
                            </Field>
                        ))}
                        <Field label={fa.method} htmlFor="fixed-asset-method">
                            <Select
                                id="fixed-asset-method"
                                value={form.depreciationMethod}
                                onChange={(e) => setFormField('depreciationMethod', e.target.value)}
                            >
                                {METHODS.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}
                            </Select>
                        </Field>
                    </FormGrid>
                    <div className="flex gap-2 mt-3">
                        <Button variant="secondary" onClick={closeCreate}>{t.common.cancel}</Button>
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
