'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Plus, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import {
    ListStats,
    ListToolbar,
    type ListFilter,
    type ListStat,
    type ResolvedListFilter,
} from '@/components/data-table';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, Field, FormGrid, Input } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { toast } from '@/lib/toast';

interface CostCenter { id: string; code: string; name: string; is_active: boolean; }

interface PlAccount { id: string; name: string; balance: number }
interface PlGroup { group: { id: string; name: string }; total: number; accounts: PlAccount[] }
interface PlSection { groups?: PlGroup[]; total?: number }
interface CostCenterPl { revenue?: PlSection; expenses?: PlSection; net_profit: number }

const SECTIONS = ['revenue', 'expenses'] as const;

const defaultPeriod = () => createdRangeFromPreset('thisMonth');

const statusOf = (center: CostCenter) => (center.is_active === false ? 'inactive' : 'active');

export default function CostCentersPage() {
    const { t, fmt, locale } = useI18n();
    const c = t.costCenters;
    const m = t.accountingMastersUi.costCenters;
    const common = t.accountingMastersUi.common;
    const [centers, setCenters] = useState<CostCenter[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [plData, setPlData] = useState<CostCenterPl | null>(null);
    const [plLoading, setPlLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);

    const [showCreate, setShowCreate] = useState(false);
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});
    const [createError, setCreateError] = useState('');
    const [creating, setCreating] = useState(false);

    const visibleCenters = useMemo(
        () =>
            centers.filter(
                (center) => matchesAnyOf(statusFilter, statusOf(center)) && matchesSearch(search, center.code, center.name),
            ),
        [centers, statusFilter, search],
    );

    // A center the filters hide no longer shows its P&L.
    const selected = visibleCenters.find((center) => center.id === selectedId) ?? null;

    useEffect(() => {
        void load();
        // Loaded once; the loader reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selected) void loadPL(selected);
        // loadPL reads the period from this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, period.from, period.to]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.listCostCenters();
            setCenters(Array.isArray(data) ? data : data?.data ?? []);
        } catch (e: any) {
            toast.error(e?.message ?? c.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const loadPL = async (center: CostCenter) => {
        setPlLoading(true);
        try {
            const data = await api.getCostCenterPL({ costCenterId: center.id, from: period.from, to: period.to });
            setPlData(data);
        } catch (e: any) {
            setPlData(null);
            toast.error(e?.message ?? m.plFailed);
        } finally {
            setPlLoading(false);
        }
    };

    const openCreate = () => {
        setCode('');
        setName('');
        setFieldErrors({});
        setCreateError('');
        setShowCreate(true);
    };

    const closeCreate = () => {
        if (creating) return;
        setShowCreate(false);
    };

    const handleCreate = async () => {
        const errors: { code?: string; name?: string } = {};
        if (!code.trim()) errors.code = m.codeRequired;
        if (!name.trim()) errors.name = m.nameRequired;
        if (errors.code || errors.name) {
            setFieldErrors(errors);
            return;
        }
        setCreating(true);
        setCreateError('');
        try {
            await api.createCostCenter({ code: code.trim(), name: name.trim() });
            toast.success(m.created);
            setShowCreate(false);
            await load();
        } catch (e: any) {
            setCreateError(e?.message ?? c.createFailed);
        } finally {
            setCreating(false);
        }
    };

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'period',
                type: 'date-range',
                label: m.period,
                value: period,
                // The P&L always covers a period: clearing the chip goes back to this month.
                onChange: (next) => setPeriod(next?.from || next?.to ? next : defaultPeriod()),
                operators: true,
                presets: ['thisMonth', 'last30', 'last3Months', 'last6Months', 'thisYear'],
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.accountingShared.status,
                value: statusFilter,
                onChange: setStatusFilter,
                options: [
                    { value: 'active', label: common.active },
                    { value: 'inactive', label: common.inactive },
                ],
            },
        ];
        return list as ResolvedListFilter[];
    }, [t, m, common, period, statusFilter]);

    const pl = selected ? plData : null;
    const revenue = pl?.revenue?.total ?? 0;
    const expenses = pl?.expenses?.total ?? 0;
    const net = pl?.net_profit ?? 0;

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const active = visibleCenters.filter((center) => statusOf(center) === 'active').length;
        const items: ListStat[] = [
            { id: 'centers', icon: <Building2 aria-hidden />, label: m.centers, value: n(visibleCenters.length) },
            { id: 'active', icon: <CheckCircle2 aria-hidden />, label: common.active, value: n(active) },
            { id: 'revenue', icon: <TrendingUp aria-hidden />, label: m.revenue, value: pl ? money(revenue) : '—', hint: selected?.code },
            { id: 'expenses', icon: <TrendingDown aria-hidden />, label: m.expenses, value: pl ? money(expenses) : '—' },
            {
                id: 'net',
                icon: <Scale aria-hidden />,
                label: pl ? (net >= 0 ? c.netProfit : c.netLoss) : m.netResult,
                value: pl ? money(Math.abs(net)) : '—',
                tone: pl && net < 0 ? 'danger' : 'default',
            },
        ];
        return items;
    }, [visibleCenters, locale, m, c, common, pl, selected, revenue, expenses, net]);

    const railMessage = (() => {
        if (loading) return t.common.loading;
        if (centers.length === 0) return m.empty;
        if (visibleCenters.length === 0) return m.noMatch;
        return null;
    })();

    const hasActivity = Boolean(pl && SECTIONS.some((section) => (pl[section]?.groups?.length ?? 0) > 0));

    return (
        <AccountingPageShell>
            <PageHeader
                title={c.title}
                subtitle={c.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    c.title,
                    'accounting',
                )}
                actions={(
                    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                        {c.newCostCenter}
                    </Button>
                )}
            />

            <ListStats stats={stats} loading={loading || plLoading} label={m.statsLabel} />

            <ListToolbar
                tableId="accounting-cost-centers"
                filters={filters}
                search={{ value: search, onChange: setSearch, placeholder: m.searchPlaceholder }}
            />

            <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
                <div className="space-y-2">
                    {railMessage ? (
                        <CompactSection className="py-6 text-center text-sm text-gray-400">{railMessage}</CompactSection>
                    ) : (
                        visibleCenters.map((center) => {
                            const isSelected = selected?.id === center.id;
                            return (
                                <button
                                    key={center.id}
                                    type="button"
                                    onClick={() => setSelectedId(center.id)}
                                    aria-current={isSelected ? 'true' : undefined}
                                    className={`min-h-touch w-full rounded-lg border p-3 text-start transition-colors ${
                                        isSelected
                                            ? 'border-blue-200 bg-blue-50'
                                            : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Building2 className={`h-4 w-4 shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                                        <div className="min-w-0">
                                            <div className={`truncate text-sm font-semibold ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                                                {center.name}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                <span className="font-mono">{center.code}</span>
                                                {statusOf(center) === 'inactive' ? ` · ${common.inactive}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>

                <div>
                    {!selected ? (
                        <CompactSection className="py-8 text-center text-sm text-gray-400">{m.selectPrompt}</CompactSection>
                    ) : plLoading ? (
                        <CompactSection className="py-6 text-center text-sm text-gray-400">{t.common.loading}</CompactSection>
                    ) : pl ? (
                        <CompactSection title={fmt(m.plTitle, { name: selected.name })}>
                            {hasActivity ? (
                                SECTIONS.map((section) => (
                                    <div key={section} className="mb-2">
                                        <div className="mb-2 flex justify-between border-b border-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500">
                                            <span>{section === 'revenue' ? m.revenue : m.expenses}</span>
                                            <span className="tabular-nums">
                                                {formatBDT(pl[section]?.total ?? 0, { locale })}
                                            </span>
                                        </div>
                                        {pl[section]?.groups?.map((g) => (
                                            <div key={g.group.id} className="mb-3">
                                                <div className="flex justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700">
                                                    <span>{g.group.name}</span>
                                                    <span className="tabular-nums">{formatBDT(g.total, { locale })}</span>
                                                </div>
                                                {g.accounts.map((a) => (
                                                    <div key={a.id} className="flex justify-between px-5 py-1 text-sm text-gray-500">
                                                        <span>{a.name}</span>
                                                        <span className="tabular-nums">{formatBDT(a.balance, { locale })}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ))
                            ) : (
                                <p className="py-4 text-center text-sm text-gray-400">{m.noActivity}</p>
                            )}
                            <div
                                className={`flex justify-between rounded-lg border px-3 py-2 text-sm font-semibold ${
                                    net >= 0
                                        ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                                        : 'border-red-100 bg-red-50 text-red-800'
                                }`}
                            >
                                <span>{net >= 0 ? c.netProfit : c.netLoss}</span>
                                <span className="tabular-nums">{formatBDT(Math.abs(net), { locale })}</span>
                            </div>
                        </CompactSection>
                    ) : null}
                </div>
            </div>

            {showCreate && (
                <ModalShell size="sm" onBackdropClick={closeCreate}>
                    <ModalHeader title={c.newCostCenter} onClose={closeCreate} closeLabel={t.common.close} />
                    <div className="space-y-4 overflow-y-auto p-4">
                        {createError && <Alert tone="danger">{createError}</Alert>}
                        <FormGrid>
                            <Field label={c.columns.code} required error={fieldErrors.code}>
                                <Input
                                    type="text"
                                    value={code}
                                    onChange={(e) => {
                                        setCode(e.target.value);
                                        setFieldErrors((prev) => ({ ...prev, code: undefined }));
                                    }}
                                    placeholder={m.codePlaceholder}
                                    aria-label={c.columns.code}
                                    error={!!fieldErrors.code}
                                    autoFocus
                                />
                            </Field>
                            <Field label={c.columns.name} required error={fieldErrors.name}>
                                <Input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        setFieldErrors((prev) => ({ ...prev, name: undefined }));
                                    }}
                                    placeholder={m.namePlaceholder}
                                    aria-label={c.columns.name}
                                    error={!!fieldErrors.name}
                                />
                            </Field>
                        </FormGrid>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeCreate} disabled={creating}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={() => void handleCreate()} loading={creating}>
                            {creating ? c.creating : c.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
