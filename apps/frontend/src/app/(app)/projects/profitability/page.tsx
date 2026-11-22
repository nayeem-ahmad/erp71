'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { api, type ProjectBillingType, type ProjectProfitability, type ProjectProfitabilityRow } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, CompactStat, PageHeader, PageShell, Select } from '@/components/ui';

/** Status filters: "open" is the work still under way, the default view. */
const STATUS_FILTERS = {
    open: 'DRAFT,ACTIVE,ON_HOLD',
    completed: 'COMPLETED',
    all: '',
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

type SortKey = 'code' | 'cost' | 'revenue' | 'margin' | 'marginPct';

const hoursText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Project costing, Phase D: every project's cost, revenue and margin on one
 * page — the same figures as each project's Financials, side by side.
 *
 * Internal projects show their cost but no margin, and are left out of the
 * margin totals: they were never meant to earn, so counting their cost as a
 * loss would only make the billed work look worse than it is.
 */
export default function ProjectProfitabilityPage() {
    const { t, fmt } = useI18n();
    const f = t.projects.financials;
    const r = t.projects.profitability;
    const [status, setStatus] = useState<StatusFilter>('open');
    const [billingType, setBillingType] = useState<'' | ProjectBillingType>('');
    const [sort, setSort] = useState<SortKey>('margin');
    const [data, setData] = useState<ProjectProfitability | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setData(null);
        api.getProjectProfitability({ status: STATUS_FILTERS[status], billingType: billingType || undefined })
            .then((result) => {
                if (!live) return;
                setData(result);
                setError(null);
            })
            .catch((err: any) => live && setError(err?.message || r.loadFailed));
        return () => {
            live = false;
        };
    }, [status, billingType, r.loadFailed]);

    const rows = useMemo(() => {
        const list = [...(data?.rows ?? [])];
        const value = (row: ProjectProfitabilityRow) => {
            if (sort === 'cost') return row.cost;
            if (sort === 'revenue') return row.revenue;
            if (sort === 'marginPct') return row.marginPct ?? Number.NEGATIVE_INFINITY;
            return row.margin ?? Number.NEGATIVE_INFINITY;
        };
        if (sort === 'code') return list.sort((a, b) => a.code.localeCompare(b.code));
        // Margin sorts worst first: the jobs losing money are the ones to look at.
        if (sort === 'margin' || sort === 'marginPct') {
            return list.sort((a, b) => {
                const av = value(a);
                const bv = value(b);
                // Internal projects (no margin) go last, not first.
                if (av === Number.NEGATIVE_INFINITY) return 1;
                if (bv === Number.NEGATIVE_INFINITY) return -1;
                return av - bv;
            });
        }
        return list.sort((a, b) => value(b) - value(a));
    }, [data, sort]);

    const totals = data?.totals;

    return (
        <PageShell>
            <PageHeader
                title={r.title}
                subtitle={r.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.projects, r.title, 'projects')}
            />

            <div className="flex flex-col gap-2 md:flex-row">
                <label className="flex flex-col gap-1 text-xs text-gray-600 md:w-56">
                    {r.statusFilter}
                    <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                        <option value="open">{r.statusOpen}</option>
                        <option value="completed">{t.projects.status.COMPLETED}</option>
                        <option value="all">{r.statusAll}</option>
                    </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600 md:w-56">
                    {f.billingType}
                    <Select value={billingType} onChange={(e) => setBillingType(e.target.value as '' | ProjectBillingType)}>
                        <option value="">{r.billingAll}</option>
                        {(['FIXED_PRICE', 'TIME_AND_MATERIALS', 'INTERNAL'] as const).map((key) => (
                            <option key={key} value={key}>{f.billingTypes[key]}</option>
                        ))}
                    </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600 md:w-56">
                    {r.sortBy}
                    <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                        <option value="margin">{r.sortMargin}</option>
                        <option value="marginPct">{r.sortMarginPct}</option>
                        <option value="revenue">{r.sortRevenue}</option>
                        <option value="cost">{r.sortCost}</option>
                        <option value="code">{r.sortCode}</option>
                    </Select>
                </label>
            </div>

            {error && <Alert tone="danger">{error}</Alert>}

            {!data && !error && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
                </div>
            )}

            {data && totals && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        <CompactStat label={f.revenue} value={formatBDT(totals.revenue)} />
                        <CompactStat label={r.billedCost} value={formatBDT(totals.billedCost)} />
                        <CompactStat
                            label={f.margin}
                            value={formatBDT(totals.margin)}
                            tone={totals.margin < 0 ? 'negative' : totals.revenue > 0 ? 'positive' : 'default'}
                        />
                        <CompactStat
                            label={f.marginPct}
                            value={totals.marginPct === null ? '—' : `${totals.marginPct}%`}
                            tone={totals.marginPct !== null && totals.marginPct < 0 ? 'negative' : 'default'}
                        />
                        <CompactStat label={r.internalCost} value={formatBDT(totals.internalCost)} />
                    </div>

                    {totals.uncostedHours > 0 && (
                        <Alert tone="warning">{fmt(r.uncostedNote, { hours: hoursText(totals.uncostedHours) })}</Alert>
                    )}
                    {data.truncated && <Alert tone="info">{fmt(r.truncated, { count: data.rows.length })}</Alert>}

                    {rows.length === 0 ? (
                        <p className="rounded-lg border border-gray-100 bg-white p-4 text-sm text-gray-500">{r.empty}</p>
                    ) : (
                        <section className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">{r.project}</th>
                                        <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{f.billingType}</th>
                                        <th className="hidden px-3 py-2 text-end font-medium lg:table-cell">{f.budget}</th>
                                        <th className="px-3 py-2 text-end font-medium">{f.totalCost}</th>
                                        <th className="hidden px-3 py-2 text-end font-medium lg:table-cell">{f.budgetUsed}</th>
                                        <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.revenue}</th>
                                        <th className="px-3 py-2 text-end font-medium">{f.margin}</th>
                                        <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.marginPct}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rows.map((row) => (
                                        <tr key={row.id}>
                                            <td className="px-3 py-2 align-top">
                                                <Link href={routes.projects.financials(row.id)} className="font-medium text-blue-600 hover:underline">
                                                    {row.code}
                                                </Link>
                                                <span className="block text-xs text-gray-700">{row.name}</span>
                                                <span className="block text-xs text-gray-500">
                                                    {[row.customer, t.projects.status[row.status as keyof typeof t.projects.status]]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </span>
                                            </td>
                                            <td className="hidden px-3 py-2 align-top text-xs text-gray-600 md:table-cell">
                                                {f.billingTypes[row.billingType]}
                                            </td>
                                            <td className="hidden px-3 py-2 text-end align-top lg:table-cell">
                                                {row.budget === null ? '—' : formatBDT(row.budget)}
                                            </td>
                                            <td className="px-3 py-2 text-end align-top">
                                                {formatBDT(row.cost)}
                                                {row.uncostedHours > 0 && (
                                                    <span className="block text-xs text-amber-700">
                                                        {fmt(r.uncostedHours, { hours: hoursText(row.uncostedHours) })}
                                                    </span>
                                                )}
                                            </td>
                                            <td
                                                className={`hidden px-3 py-2 text-end align-top lg:table-cell ${
                                                    row.budgetUsedPct !== null && row.budgetUsedPct > 100 ? 'text-red-600' : 'text-gray-600'
                                                }`}
                                            >
                                                {row.budgetUsedPct === null ? '—' : `${Math.round(row.budgetUsedPct)}%`}
                                            </td>
                                            <td className="hidden px-3 py-2 text-end align-top md:table-cell">
                                                {row.margin === null ? '—' : formatBDT(row.revenue)}
                                            </td>
                                            <td
                                                className={`px-3 py-2 text-end align-top ${
                                                    row.margin !== null && row.margin < 0 ? 'text-red-600' : 'text-gray-900'
                                                }`}
                                            >
                                                {row.margin === null ? <span className="text-xs text-gray-500">{r.notBilled}</span> : formatBDT(row.margin)}
                                            </td>
                                            <td className="hidden px-3 py-2 text-end align-top md:table-cell">
                                                {row.marginPct === null ? '—' : `${row.marginPct}%`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    <p className="text-xs text-gray-500">{r.footnote}</p>
                </div>
            )}
        </PageShell>
    );
}
