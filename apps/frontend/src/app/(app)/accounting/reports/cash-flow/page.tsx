'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Briefcase, Building2, Landmark, TrendingUp, Wallet } from 'lucide-react';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { ListStats, ListToolbar, type ListStat, type ResolvedListFilter } from '@/components/data-table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import { createdRangeFromPreset, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';
import { matchesSearch } from '@/lib/list-filter';

interface Activity { id: string; name: string; type: string; net_change: number; }
interface CashFlowData {
    filters: { from: string; to: string };
    operating: { activities: Activity[]; net: number };
    investing: { activities: Activity[]; net: number };
    financing: { activities: Activity[]; net: number };
    net_change_in_cash: number;
    opening_cash_balance: number;
    closing_cash_balance: number;
    note: string;
}

const PERIOD_PRESETS: readonly CreatedRangePreset[] = ['thisMonth', 'last3Months', 'last6Months', 'last12Months', 'thisYear'];

/** A statement always covers some period: cleared, it goes back to this month. */
const defaultPeriod = (): CreatedRange => createdRangeFromPreset('thisMonth');

function ActivitySection({
    label,
    netLabel,
    data,
    query,
    noMatches,
}: {
    label: string;
    netLabel: string;
    data: { activities: Activity[]; net: number };
    query: string;
    noMatches: string;
}) {
    const { locale } = useI18n();
    // The search picks out lines; the section's net stays the statement's.
    const shown = data.activities.filter((activity) => matchesSearch(query, activity.name, activity.type));
    return (
        <div>
            <div className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-700 mb-2">{label}</div>
            {shown.map((a) => (
                <div key={a.id} className="flex justify-between items-center px-5 py-1 text-sm text-gray-600 border-b border-gray-50">
                    <span>{a.name}</span>
                    <span className={`tabular-nums ${a.net_change >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(a.net_change, { locale })}</span>
                </div>
            ))}
            {query.trim() && data.activities.length > 0 && shown.length === 0 ? (
                <p className="px-5 py-1 text-xs text-gray-400">{noMatches}</p>
            ) : null}
            <div className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg font-semibold text-sm text-gray-700 mt-1">
                <span>{netLabel}</span>
                <span className={`tabular-nums ${data.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(data.net, { locale })}</span>
            </div>
        </div>
    );
}

export default function CashFlowPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingBooksUi.cashFlow;
    const copy = t.accounting.reports.cashFlow;
    const [data, setData] = useState<CashFlowData | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const fromDate = period.from ?? '';
    const toDate = period.to ?? '';
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (approvalReady) void load(); }, [fromDate, toDate, approvalReady, approvedOnly]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await api.getCashFlow({ approvedOnly, from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? t.accountingShared.loadFailed); }
        finally { setLoading(false); }
    };

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ResolvedListFilter[] = [
            {
                id: 'period',
                type: 'date-range',
                label: t.accountingShared.period,
                value: period,
                onChange: (next) => setPeriod(next ?? defaultPeriod()),
                presets: PERIOD_PRESETS,
                operators: true,
            },
        ];
        if (approvalEnabled) {
            list.push({
                id: 'approvedOnly',
                type: 'toggle',
                label: t.accountingShared.approvedOnly,
                pressed: approvedOnly,
                onChange: setApprovedOnly,
                control: 'checkbox',
            });
        }
        return list;
    }, [t, period, approvalEnabled, approvedOnly, setApprovedOnly]);

    const stats = useMemo<ListStat[]>(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const figure = (id: string, label: string, icon: ReactNode, value: number | undefined): ListStat => ({
            id,
            icon,
            label,
            value: value === undefined ? '—' : money(value),
            tone: value !== undefined && value < 0 ? 'danger' : 'default',
        });
        return [
            figure('operating', ui.operating, <Briefcase aria-hidden />, data?.operating.net),
            figure('investing', ui.investing, <Building2 aria-hidden />, data?.investing.net),
            figure('financing', ui.financing, <Landmark aria-hidden />, data?.financing.net),
            figure('netChange', copy.netChange, <TrendingUp aria-hidden />, data?.net_change_in_cash),
            figure('closing', ui.closingCash, <Wallet aria-hidden />, data?.closing_cash_balance),
        ];
    }, [data, locale, ui, copy]);

    const sections = data ? [
        { key: 'operating', label: copy.operating, data: data.operating },
        { key: 'investing', label: copy.investing, data: data.investing },
        { key: 'financing', label: copy.financing, data: data.financing },
    ] : [];

    return (
        <AccountingPageShell maxWidth="narrow">
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    copy.title,
                    'accounting',
                )}
            />

            <ListStats stats={stats} loading={loading && !data} label={ui.statsLabel} />

            <ListToolbar
                tableId="cash-flow-statement"
                filters={filters}
                search={{ value: search, onChange: setSearch, placeholder: ui.searchPlaceholder }}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">{t.accountingShared.loading}</CompactSection>
            ) : data ? (
                <CompactSection className="space-y-4">
                    <div className="text-center border-b border-gray-100 pb-3">
                        <p className={compactDensity.sectionLabel}>{t.accountingShared.period}</p>
                        <p className="text-sm font-semibold text-gray-700 mt-1">{data.filters.from} — {data.filters.to}</p>
                    </div>
                    {sections.map((section) => (
                        <ActivitySection
                            key={section.key}
                            label={section.label}
                            netLabel={formatMessage(ui.netSection, { label: section.label })}
                            data={section.data}
                            query={search}
                            noMatches={ui.noMatches}
                        />
                    ))}
                    <div className="border-t border-gray-200 pt-3 space-y-2">
                        <div className="flex justify-between text-sm text-gray-600">
                            <span>{ui.openingCash}</span>
                            <span className="font-medium tabular-nums">{formatBDT(data.opening_cash_balance, { locale })}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600">
                            <span>{copy.netChange}</span>
                            <span className={`font-medium tabular-nums ${data.net_change_in_cash >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(data.net_change_in_cash, { locale })}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-sm border-t border-gray-200 pt-2">
                            <span>{ui.closingCash}</span>
                            <span className={`tabular-nums ${data.closing_cash_balance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(data.closing_cash_balance, { locale })}</span>
                        </div>
                    </div>
                    <p className="text-xs text-gray-400 italic">{data.note}</p>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}
