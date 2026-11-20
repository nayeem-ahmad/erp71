'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PackageMinus, PieChart, Plus, Trash2, Undo2 } from 'lucide-react';
import { api, type ProjectDirectCost, type ProjectFinancials } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import { getWorkspaceItem } from '@/lib/session-store';
import { hasPermission, isOwner } from '@/lib/permissions';
import AddProjectCostModal from '@/components/projects/costing/AddProjectCostModal';
import IssueMaterialsModal from '@/components/projects/costing/IssueMaterialsModal';
import ProjectBillingSection from '@/components/projects/costing/ProjectBillingSection';
import ProjectBudgetModal from '@/components/projects/costing/ProjectBudgetModal';
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
    const [costs, setCosts] = useState<ProjectDirectCost[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [pricing, setPricing] = useState(false);
    const [modal, setModal] = useState<'cost' | 'issue' | 'budget' | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Issuing moves stock, so it needs what a stock write-off needs too.
    const [canMoveStock, setCanMoveStock] = useState(false);
    // The budget is the project's, so splitting it needs what the project form needs.
    const [canManageProject, setCanManageProject] = useState(false);

    const load = useCallback(async () => {
        try {
            const [financials, directCosts] = await Promise.all([
                api.getProjectFinancials(projectId),
                api.getProjectDirectCosts(projectId).catch(() => []),
            ]);
            setData(financials);
            setCosts(directCosts ?? []);
            setError(null);
        } catch (err: any) {
            setError(err?.message || f.loadFailed);
        }
    }, [projectId, f.loadFailed]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        fetchMe()
            .then((me: any) => {
                const tenantId = getWorkspaceItem('tenant_id');
                const tenant = me?.tenants?.find((entry: any) => entry.id === tenantId) || me?.tenants?.[0];
                setCanMoveStock(
                    isOwner(tenant?.role)
                        || hasPermission(tenant?.permissions, 'CREATE_INVENTORY_MOVEMENTS')
                        || hasPermission(tenant?.permissions, 'STOCK_TAKE'),
                );
                setCanManageProject(isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'MANAGE_PROJECTS'));
            })
            .catch(() => {
                setCanMoveStock(false);
                setCanManageProject(false);
            });
    }, []);

    const removeCost = async (row: ProjectDirectCost) => {
        setBusyId(row.id);
        try {
            if (row.kind === 'ISSUE') {
                await api.reverseProjectMaterialIssue(projectId, row.id);
                toast.success(f.returned);
            } else {
                await api.removeProjectCost(projectId, row.id);
                toast.success(f.costRemoved);
            }
            await load();
        } catch (err: any) {
            toast.error(err?.message || f.costFailed);
        } finally {
            setBusyId(null);
        }
    };

    const saved = async () => {
        setModal(null);
        await load();
    };

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
                        <CompactStat label={f.totalCost} value={formatBDT(totals.totalCost)} />
                        <CompactStat label={f.labourCost} value={formatBDT(totals.labourCost)} />
                        <CompactStat label={f.directCost} value={formatBDT(totals.directCost)} />
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

                    {data.revenue && data.revenue.billingType !== 'INTERNAL' && (
                        <>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <CompactStat label={f.revenue} value={formatBDT(data.revenue.revenue)} />
                                <CompactStat
                                    label={f.margin}
                                    value={formatBDT(data.revenue.margin)}
                                    tone={data.revenue.margin < 0 ? 'negative' : data.revenue.revenue > 0 ? 'positive' : 'default'}
                                />
                                <CompactStat
                                    label={f.marginPct}
                                    value={data.revenue.marginPct === null ? '—' : `${data.revenue.marginPct}%`}
                                    tone={data.revenue.marginPct !== null && data.revenue.marginPct < 0 ? 'negative' : 'default'}
                                />
                                {data.revenue.billingType === 'FIXED_PRICE' ? (
                                    <CompactStat
                                        label={f.leftToInvoice}
                                        value={data.revenue.leftToInvoice === null ? '—' : formatBDT(data.revenue.leftToInvoice)}
                                    />
                                ) : (
                                    <CompactStat
                                        label={f.unbilled}
                                        value={data.revenue.unbilledAmount === null ? '—' : formatBDT(data.revenue.unbilledAmount)}
                                        tone={data.revenue.unbilledAmount ? 'warning' : 'default'}
                                    />
                                )}
                            </div>
                            {data.revenue.expectedRevenue !== null && (
                                <section className="rounded-lg border border-gray-100 bg-white p-3 md:p-4">
                                    <h2 className="text-sm font-semibold text-gray-900">{f.outlookTitle}</h2>
                                    <p className="mt-0.5 text-xs text-gray-500">{f.outlookHint}</p>
                                    <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                                        <div>
                                            <dt className="text-xs text-gray-500">{f.expectedRevenue}</dt>
                                            <dd className="font-medium text-gray-900">{formatBDT(data.revenue.expectedRevenue)}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs text-gray-500">{f.expectedCost}</dt>
                                            <dd className="font-medium text-gray-900">{formatBDT(data.revenue.expectedCost)}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs text-gray-500">{f.expectedMargin}</dt>
                                            <dd className={`font-medium ${data.revenue.expectedMargin !== null && data.revenue.expectedMargin < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                                {data.revenue.expectedMargin === null ? '—' : formatBDT(data.revenue.expectedMargin)}
                                            </dd>
                                        </div>
                                    </dl>
                                    {data.revenue.percentComplete !== null && data.revenue.earnedRevenue !== null && (
                                        <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 text-sm md:grid-cols-3">
                                            <div>
                                                <dt className="text-xs text-gray-500">{f.percentComplete}</dt>
                                                <dd className="font-medium text-gray-900">{data.revenue.percentComplete}%</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs text-gray-500">{f.earnedRevenue}</dt>
                                                <dd className="font-medium text-gray-900">{formatBDT(data.revenue.earnedRevenue)}</dd>
                                            </div>
                                            {data.revenue.billedAheadOfWork !== null && (
                                                <div>
                                                    <dt className="text-xs text-gray-500">
                                                        {data.revenue.billedAheadOfWork >= 0 ? f.billedAhead : f.earnedNotBilled}
                                                    </dt>
                                                    <dd className={`font-medium ${data.revenue.billedAheadOfWork < 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                                                        {formatBDT(Math.abs(data.revenue.billedAheadOfWork))}
                                                    </dd>
                                                </div>
                                            )}
                                        </dl>
                                    )}
                                    {data.revenue.percentComplete !== null && (
                                        <p className="mt-2 text-xs text-gray-500">{f.percentCompleteHint}</p>
                                    )}
                                </section>
                            )}
                        </>
                    )}

                    <ProjectBillingSection projectId={projectId} onChanged={() => void load()} />

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

                    {data.uncosted.materialLines > 0 && (
                        <Alert tone="warning">{fmt(f.uncostedMaterial, { count: data.uncosted.materialLines })}</Alert>
                    )}

                    {(data.byCategory.length > 0 || canManageProject) && (
                        <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2">
                                <div>
                                    <h2 className="text-sm font-semibold text-gray-900">{f.budgetVsActual}</h2>
                                    {!data.budgetByCategory && <p className="text-xs text-gray-500">{f.budgetSplitHint}</p>}
                                </div>
                                {canManageProject && (
                                    <Button type="button" variant="secondary" icon={<PieChart className="h-4 w-4" />} onClick={() => setModal('budget')}>
                                        {f.setBudget}
                                    </Button>
                                )}
                            </div>
                            {data.byCategory.length > 0 && (
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 text-start font-medium">{f.category}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.budget}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.actual}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.left}</th>
                                            <th className="hidden w-20 px-3 py-2 text-end font-medium md:table-cell">{f.used}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.byCategory.map((row) => (
                                            <tr key={row.category}>
                                                <td className="px-3 py-2">{f.categories[row.category]}</td>
                                                <td className="hidden px-3 py-2 text-end text-gray-600 md:table-cell">
                                                    {row.budget === null ? '—' : formatBDT(row.budget)}
                                                </td>
                                                <td className="px-3 py-2 text-end">{formatBDT(row.amount)}</td>
                                                <td className={`px-3 py-2 text-end ${row.remaining !== null && row.remaining < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                                    {row.remaining === null
                                                        ? '—'
                                                        : row.remaining < 0
                                                            ? fmt(f.overBy, { amount: formatBDT(-row.remaining) })
                                                            : formatBDT(row.remaining)}
                                                </td>
                                                <td className="hidden px-3 py-2 text-end text-xs text-gray-500 md:table-cell">
                                                    {row.usedPct === null ? '' : `${Math.round(row.usedPct)}%`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    )}

                    <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2">
                            <div>
                                <h2 className="text-sm font-semibold text-gray-900">{f.directCostsTitle}</h2>
                                <p className="text-xs text-gray-500">{f.directCostsHint}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('cost')}>
                                    {f.addCost}
                                </Button>
                                {canMoveStock && (
                                    <Button type="button" variant="secondary" icon={<PackageMinus className="h-4 w-4" />} onClick={() => setModal('issue')}>
                                        {f.issueMaterials}
                                    </Button>
                                )}
                            </div>
                        </div>
                        {costs.length === 0 ? (
                            <p className="p-3 text-sm text-gray-500">{f.noDirectCosts}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">{f.date}</th>
                                        <th className="px-3 py-2 text-start font-medium">{f.description}</th>
                                        <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{f.category}</th>
                                        <th className="px-3 py-2 text-end font-medium">{f.amount}</th>
                                        <th className="w-10 px-1 py-2"><span className="sr-only">{f.removeCost}</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {costs.map((row) => (
                                        <tr key={`${row.kind}:${row.id}`}>
                                            <td className="whitespace-nowrap px-3 py-2 align-top">{row.date}</td>
                                            <td className="px-3 py-2 align-top">
                                                <p className="text-gray-900">{row.description}</p>
                                                {row.source && <p className="text-xs text-gray-500">{row.source}</p>}
                                            </td>
                                            <td className="hidden px-3 py-2 align-top md:table-cell">{f.categories[row.category]}</td>
                                            <td className="px-3 py-2 text-end align-top">
                                                {formatBDT(row.amount)}
                                                {row.uncosted && <span className="block text-xs text-amber-700">{f.uncostedShort}</span>}
                                            </td>
                                            <td className="px-1 py-2 text-end align-top">
                                                {/* Expenses are corrected on the expense page, where they post. */}
                                                {row.kind === 'ENTRY' && (
                                                    <button
                                                        type="button"
                                                        aria-label={f.removeCost}
                                                        disabled={busyId === row.id}
                                                        onClick={() => removeCost(row)}
                                                        className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {row.kind === 'ISSUE' && canMoveStock && (
                                                    <button
                                                        type="button"
                                                        aria-label={f.returnToStock}
                                                        title={f.returnToStock}
                                                        disabled={busyId === row.id}
                                                        onClick={() => removeCost(row)}
                                                        className="min-h-touch px-2 text-gray-600 disabled:opacity-40"
                                                    >
                                                        <Undo2 className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>

                    {(totals.hours > 0 || data.forecast.remainingHours > 0) && (
                        <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                            <div className="p-3 md:p-4">
                                <h2 className="text-sm font-semibold text-gray-900">{f.forecastTitle}</h2>
                                <p className="mt-0.5 text-xs text-gray-500">{f.forecastByAssigneeHint}</p>
                                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.remainingHours}</dt>
                                        <dd className="font-medium text-gray-900">{hoursText(data.forecast.remainingHours)}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.labourToCome}</dt>
                                        <dd className="font-medium text-gray-900">{formatBDT(data.forecast.estimatedRemainingCost)}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.otherCostsToCome}</dt>
                                        <dd className="font-medium text-gray-900">
                                            {data.budgetByCategory ? formatBDT(data.forecast.remainingDirectCost) : '—'}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{f.estimateAtCompletion}</dt>
                                        <dd className="font-medium text-gray-900">{formatBDT(data.forecast.estimateAtCompletion)}</dd>
                                    </div>
                                </dl>
                                {data.forecast.unratedHours > 0 && (
                                    <p className="mt-2 text-xs text-amber-700">
                                        {fmt(f.unratedRemaining, { hours: hoursText(data.forecast.unratedHours) })}
                                    </p>
                                )}
                            </div>
                            {data.forecast.byPerson.length > 0 && (
                                <table className="w-full border-t border-gray-100 text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 text-start font-medium">{f.person}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.remainingHours}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.rate}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.labourToCome}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.forecast.byPerson.map((row) => (
                                            <tr key={row.key}>
                                                <td className="px-3 py-2">
                                                    {row.key === 'unassigned' ? <span className="text-gray-500">{f.unassigned}</span> : row.name || '—'}
                                                </td>
                                                <td className="px-3 py-2 text-end">{hoursText(row.remainingHours)}</td>
                                                <td className="hidden px-3 py-2 text-end md:table-cell">
                                                    {row.rate === null ? '—' : formatBDT(row.rate)}
                                                    {row.rateSource === 'AVERAGE' && <span className="block text-xs text-gray-500">{f.rateAverage}</span>}
                                                </td>
                                                <td className="px-3 py-2 text-end">
                                                    {row.cost === null ? <span className="text-amber-700">{f.uncostedShort}</span> : formatBDT(row.cost)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    )}

                    {totals.hours === 0 ? (
                        <p className="rounded-lg border border-gray-100 bg-white p-4 text-sm text-gray-500">{f.empty}</p>
                    ) : (
                        <>
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
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.hours}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.labourCost}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.directCost}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.totalCost}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.revenue}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.byMonth.map((row) => (
                                            <tr key={row.month}>
                                                <td className="px-3 py-2">{row.month}</td>
                                                <td className="hidden px-3 py-2 text-end md:table-cell">{hoursText(row.hours)}</td>
                                                <td className="hidden px-3 py-2 text-end md:table-cell">{formatBDT(row.labourCost)}</td>
                                                <td className="hidden px-3 py-2 text-end md:table-cell">{formatBDT(row.directCost)}</td>
                                                <td className="px-3 py-2 text-end">{formatBDT(row.totalCost)}</td>
                                                <td className="px-3 py-2 text-end">{formatBDT(row.revenue ?? 0)}</td>
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

            {modal === 'cost' && <AddProjectCostModal projectId={projectId} onClose={() => setModal(null)} onSaved={saved} />}
            {modal === 'issue' && <IssueMaterialsModal projectId={projectId} onClose={() => setModal(null)} onSaved={saved} />}
            {modal === 'budget' && data && (
                <ProjectBudgetModal
                    projectId={projectId}
                    current={data.budgetByCategory
                        ? Object.fromEntries(data.byCategory.filter((row) => row.budget !== null).map((row) => [row.category, row.budget as number]))
                        : {}}
                    onClose={() => setModal(null)}
                    onSaved={saved}
                />
            )}
        </PageShell>
    );
}
