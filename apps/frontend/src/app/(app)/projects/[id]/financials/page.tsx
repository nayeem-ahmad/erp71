'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PackageMinus, Plus, Trash2, Undo2 } from 'lucide-react';
import { api, type ProjectDirectCost, type ProjectFinancials } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import { getWorkspaceItem } from '@/lib/session-store';
import { hasPermission, isOwner } from '@/lib/permissions';
import AddProjectCostModal from '@/components/projects/costing/AddProjectCostModal';
import IssueMaterialsModal from '@/components/projects/costing/IssueMaterialsModal';
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
    const [modal, setModal] = useState<'cost' | 'issue' | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Issuing moves stock, so it needs what a stock write-off needs too.
    const [canMoveStock, setCanMoveStock] = useState(false);

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
            })
            .catch(() => setCanMoveStock(false));
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

                    {data.byCategory.length > 0 && (
                        <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                            <h2 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900">{f.byCategory}</h2>
                            <table className="w-full text-sm">
                                <tbody className="divide-y divide-gray-100">
                                    {data.byCategory.map((row) => (
                                        <tr key={row.category}>
                                            <td className="px-3 py-2">{f.categories[row.category]}</td>
                                            <td className="px-3 py-2 text-end">{formatBDT(row.amount)}</td>
                                            <td className="hidden w-24 px-3 py-2 text-end text-xs text-gray-500 md:table-cell">
                                                {totals.totalCost > 0 ? `${Math.round((row.amount / totals.totalCost) * 100)}%` : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.hours}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.labourCost}</th>
                                            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{f.directCost}</th>
                                            <th className="px-3 py-2 text-end font-medium">{f.totalCost}</th>
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
        </PageShell>
    );
}
