'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { api, type ProjectFinancials } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, CompactStat, PageHeader, PageShell } from '@/components/ui';

const hoursText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * What a project's hours have cost, against its budget — project costing,
 * Phase A.
 *
 * Every figure is a sum of what each hour was priced at when it was logged;
 * nothing here re-prices history. Hours that carry no cost are counted apart,
 * with the reason and the fix, rather than quietly counting as free — a
 * margin that looks healthy because a third of the hours were never priced is
 * the failure this page exists to prevent.
 */
export default function ProjectFinancialsPage() {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const f = m.financials;
    const params = useParams();
    const projectId = params.id as string;
    const [data, setData] = useState<ProjectFinancials | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pricing, setPricing] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await api.getProjectFinancials(projectId));
            setError(null);
        } catch (err: any) {
            setError(err?.message || f.loadFailed);
        }
    }, [projectId, f.loadFailed]);

    useEffect(() => { void load(); }, [load]);

    const priceHours = async () => {
        setPricing(true);
        try {
            const result = await api.priceProjectHours(projectId);
            if (result.priced > 0) toast.success(fmt(f.priced, { count: result.priced }));
            else toast.error(f.nothingToPrice);
            await load();
        } catch (err: any) {
            toast.error(err?.message || f.loadFailed);
        } finally {
            setPricing(false);
        }
    };

    const title = data ? `${data.project.code} · ${data.project.name}` : f.title;
    const totals = data?.totals;
    const overBudget = totals?.budgetRemaining !== null && totals?.budgetRemaining !== undefined && totals.budgetRemaining < 0;

    return (
        <PageShell>
            <PageHeader
                title={f.title}
                subtitle={f.subtitle}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    'projects',
                    [{ label: title, href: routes.projects.detail(projectId) }],
                    f.title,
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            {!data && !error && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
                </div>
            )}

            {data && totals && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <CompactStat label={f.labourCost} value={formatBDT(totals.labourCost)} />
                        <CompactStat
                            label={f.budget}
                            value={totals.budget === null ? f.noBudget : formatBDT(totals.budget)}
                        />
                        <CompactStat
                            label={overBudget ? f.overBudget : f.budgetRemaining}
                            value={totals.budgetRemaining === null ? '—' : formatBDT(Math.abs(totals.budgetRemaining))}
                            tone={overBudget ? 'negative' : 'default'}
                        />
                        <CompactStat
                            label={f.budgetUsed}
                            value={totals.budgetUsedPct === null ? '—' : `${totals.budgetUsedPct}%`}
                            tone={overBudget ? 'negative' : totals.budgetUsedPct !== null && totals.budgetUsedPct >= 80 ? 'warning' : 'default'}
                        />
                        <CompactStat label={f.hours} value={hoursText(totals.hours)} />
                        <CompactStat
                            label={f.averageRate}
                            value={totals.averageRate === null ? '—' : formatBDT(totals.averageRate)}
                        />
                    </div>

                    {totals.uncostedHours > 0 && (
                        <Alert tone="warning" title={fmt(f.uncostedTitle, { hours: hoursText(totals.uncostedHours) })}>
                            <div className="space-y-2">
                                {data.uncosted.noEmployeeHours > 0 && (
                                    <p>
                                        {fmt(f.uncostedNoEmployee, { hours: hoursText(data.uncosted.noEmployeeHours) })}{' '}
                                        <Link href={routes.team} className="font-medium text-blue-600 hover:underline">
                                            {t.teamManagement.title}
                                        </Link>
                                    </p>
                                )}
                                {data.uncosted.noRateHours > 0 && (
                                    <>
                                        <p>{fmt(f.uncostedNoRate, { hours: hoursText(data.uncosted.noRateHours) })}</p>
                                        <Button type="button" variant="secondary" loading={pricing} onClick={priceHours}>
                                            {f.priceHours}
                                        </Button>
                                    </>
                                )}
                            </div>
                        </Alert>
                    )}

                    {totals.hours === 0 ? (
                        <p className="rounded-lg border border-gray-100 bg-white p-4 text-sm text-gray-500">{f.empty}</p>
                    ) : (
                        <>
                            <section className="rounded-lg border border-gray-100 bg-white p-3 md:p-4">
                                <h2 className="text-sm font-semibold text-gray-900">{f.forecastTitle}</h2>
                                <p className="mt-0.5 text-xs text-gray-500">{f.forecastHint}</p>
                                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.remainingHours}</dt>
                                        <dd className="font-medium text-gray-900">{hoursText(data.forecast.remainingHours)}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.estimatedRemaining}</dt>
                                        <dd className="font-medium text-gray-900">
                                            {data.forecast.estimatedRemainingCost === null ? '—' : formatBDT(data.forecast.estimatedRemainingCost)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.estimateAtCompletion}</dt>
                                        <dd className="font-medium text-gray-900">
                                            {data.forecast.estimateAtCompletion === null ? '—' : formatBDT(data.forecast.estimateAtCompletion)}
                                        </dd>
                                    </div>
                                </dl>
                            </section>

                            <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                                <h2 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900">{f.byPerson}</h2>
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 text-start font-medium">{f.person}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.hours}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.uncostedColumn}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.labourCost}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.byPerson.map((row) => (
                                            <tr key={row.key}>
                                                <td className="px-3 py-2">
                                                    {row.employeeId ? (
                                                        <Link href={routes.hr.employeeDetail(row.employeeId)} className="text-blue-600 hover:underline">
                                                            {row.name}
                                                        </Link>
                                                    ) : (
                                                        row.name || '—'
                                                    )}
                                                    {row.employeeCode && <span className="ms-1 text-xs text-gray-500">{row.employeeCode}</span>}
                                                </td>
                                                <td className="px-3 py-2 text-end">{hoursText(row.hours)}</td>
                                                <td className="hidden px-3 py-2 text-end text-amber-700 md:table-cell">
                                                    {row.uncostedHours > 0 ? hoursText(row.uncostedHours) : ''}
                                                </td>
                                                <td className="px-3 py-2 text-end">{formatBDT(row.labourCost)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>

                            <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                                <h2 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900">{f.byMonth}</h2>
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 text-start font-medium">{f.month}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.hours}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.labourCost}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.byMonth.map((row) => (
                                            <tr key={row.month}>
                                                <td className="px-3 py-2">{row.month}</td>
                                                <td className="px-3 py-2 text-end">{hoursText(row.hours)}</td>
                                                <td className="px-3 py-2 text-end">{formatBDT(row.labourCost)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>
                        </>
                    )}

                    <p className="text-xs text-gray-500">{f.snapshotNote}</p>
                </div>
            )}
        </PageShell>
    );
}
