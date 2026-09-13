'use client';

import { useState, useEffect, useCallback } from 'react';
import { Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Input, Checkbox } from '@/components/ui';

type DutyReport = {
    totals_by_type: Array<{ cost_type: string; amount_bdt: number }>;
    total_bdt: number;
    recoverable_bdt: number;
    unpaid_bdt: number;
    lines: Array<{
        shipment_reference: string;
        be_number: string | null;
        be_date: string | null;
        cost_type: string;
        amount_bdt: number;
        is_recoverable: boolean;
        paid_at: string | null;
        is_paid: boolean;
    }>;
};

export default function ImportDutyReportPage() {
    const { t, locale } = useI18n();
    const copy = t.imports.dutyReport;
    const [report, setReport] = useState<DutyReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    // Off by default: the VAT return reports what was paid, not what was
    // assessed. An assessed-but-unpaid duty is still a bill due, so it is worth
    // being able to see — just not by accident.
    const [includeUnpaid, setIncludeUnpaid] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        api.getImportDutyReport({
            from: from || undefined,
            to: to || undefined,
            includeUnpaid: includeUnpaid || undefined,
        })
            .then(setReport)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [from, to, includeUnpaid]);

    useEffect(load, [load]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.imports,
                    'purchases',
                    [{ label: t.imports.title, href: routes.purchases.imports.root }],
                    copy.title,
                )}
            />

            <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-500">
                    <span className="mb-1 block">{t.common.from}</span>
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="text-xs text-gray-500">
                    <span className="mb-1 block">{t.common.to}</span>
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <Checkbox checked={includeUnpaid} onChange={() => setIncludeUnpaid((value) => !value)} />
                    {copy.includeUnpaid}
                </label>
            </div>

            {report && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-xs text-gray-500">{copy.total}</p>
                        <p className="text-lg font-semibold text-gray-900">{formatBDT(report.total_bdt, { locale })}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-xs text-gray-500">{copy.recoverable}</p>
                        {/* VAT and AIT come back, so they are not a cost of the
                            goods and never reach the cost pool. */}
                        <p className="text-lg font-semibold text-emerald-700">
                            {formatBDT(report.recoverable_bdt, { locale })}
                        </p>
                    </div>
                    {includeUnpaid && (
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <p className="text-xs text-gray-500">{copy.unpaid}</p>
                            <p className="text-lg font-semibold text-amber-700">
                                {formatBDT(report.unpaid_bdt, { locale })}
                            </p>
                        </div>
                    )}
                    {report.totals_by_type.slice(0, includeUnpaid ? 1 : 2).map((row) => (
                        <div key={row.cost_type} className="rounded-lg border border-gray-200 bg-white p-3">
                            <p className="text-xs text-gray-500">
                                {t.imports.costTypes[row.cost_type as keyof typeof t.imports.costTypes] ??
                                    row.cost_type}
                            </p>
                            <p className="text-lg font-semibold text-gray-900">{formatBDT(row.amount_bdt, { locale })}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white">
                {loading ? (
                    <p className="p-4 text-sm text-gray-500">{t.common.loading}</p>
                ) : !report || report.lines.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-8 text-center">
                        <Receipt className="h-12 w-12 text-gray-200" />
                        <p className="text-sm text-gray-500">{copy.empty}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="p-3">{t.imports.columns.reference}</th>
                                    <th className="hidden p-3 md:table-cell">{copy.beNumber}</th>
                                    <th className="p-3">{t.imports.cost.costType}</th>
                                    <th className="p-3 text-end">{t.imports.columns.invoiceValue}</th>
                                    <th className="hidden p-3 md:table-cell">{t.common.date}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.lines.map((line, index) => (
                                    <tr key={index} className="border-b border-gray-50">
                                        <td className="p-3 text-gray-900">{line.shipment_reference}</td>
                                        <td className="hidden p-3 text-gray-700 md:table-cell">{line.be_number ?? '—'}</td>
                                        <td className="p-3">
                                            <span className="text-gray-700">
                                                {t.imports.costTypes[
                                                    line.cost_type as keyof typeof t.imports.costTypes
                                                ] ?? line.cost_type}
                                            </span>
                                            {line.is_recoverable && (
                                                <span className="ms-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    {copy.recoverable}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-end font-medium text-gray-900">
                                            {formatBDT(line.amount_bdt, { locale })}
                                        </td>
                                        <td className="hidden p-3 text-gray-600 md:table-cell">
                                            {line.paid_at ? (
                                                formatDate(line.paid_at, locale)
                                            ) : (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                                    {t.imports.detail.accrued}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </PageShell>
    );
}
