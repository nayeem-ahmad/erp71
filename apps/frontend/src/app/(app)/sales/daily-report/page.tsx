'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, BranchFilter, Button, CompactSection, CompactStat, Input, PageHeader, PageShell } from '@/components/ui';
import MessageShareModal from '@/components/share/MessageShareModal';
import { ApiError, api } from '@/lib/api';
import type { DailyReport } from '@/lib/daily-report';
import {
    buildDailyReportHtml,
    isDuesVisible,
    isMoneyOutVisible,
    isStockVisible,
    isTillVisible,
} from '@/lib/daily-report-print';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSalePrintPrefs } from '@/lib/hooks/useSalePrintPrefs';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { openPrintWindow, renderHeaderHtml, SIMPLE_DOC_STYLES } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';

function todayLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checklistHrefLabel(
    code: DailyReport['checklist'][number]['code'],
    labels: { openTill: string; reorder: string; pendingDelivery: string },
): string {
    if (code === 'OPEN_TILL') return labels.openTill;
    if (code === 'REORDER') return labels.reorder;
    return labels.pendingDelivery;
}

export default function DailyReportPage() {
    const { t, locale } = useI18n();
    const m = t.sales.dailyReport;
    const printHeader = usePrintHeader('DAILY_REPORT');
    const { paperSize, skipPreview } = useSalePrintPrefs();
    const [date, setDate] = useState(todayLocal);
    const [report, setReport] = useState<DailyReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [shareOpen, setShareOpen] = useState(false);
    // One branch's day: the filter opens on the header branch, never "All".
    const branch = useBranchScope({ allowAll: false });
    const storeId = branch.apiStoreId;

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getDailyReport({
                date,
                locale,
                ...(storeId ? { storeId } : {}),
            });
            setReport(data);
        } catch (err: unknown) {
            setReport(null);
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            if (err instanceof ApiError && err.status === 403) {
                setError(err.message);
            } else {
                setError(err instanceof Error ? err.message : t.common.loadFailed);
            }
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date, locale, storeId, t.common.loadFailed]);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
    }, [branch.ready, load]);

    const handlePrint = async () => {
        if (!report) return;
        // The branch the report was loaded for.
        const header = await printHeader.resolve(storeId);
        const headerContext = {
            docTitle: m.title,
            docDate: report.date,
            companyName: header.companyName ?? report.tenantName,
            storeName: report.storeName,
        };
        openPrintWindow({
            title: m.title,
            paperSize,
            headerConfig: header.headerConfig,
            headerHtml: renderHeaderHtml(header.headerConfig, headerContext, paperSize),
            bodyHtml: buildDailyReportHtml(report, m),
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
            preview: skipPreview
                ? undefined
                : {
                      title: m.title,
                      printLabel: m.print,
                      closeLabel: t.common.close,
                  },
        });
    };

    const vs =
        report?.headlines.vsPreviousPct == null
            ? '—'
            : `${report.headlines.vsPreviousPct > 0 ? '+' : ''}${report.headlines.vsPreviousPct}%`;

    return (
        <PageShell maxWidth="wide" className="space-y-4">
            <PageHeader
                title={m.title}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    m.title,
                    'sales',
                )}
                actions={
                    <>
                        <BranchFilter scope={branch} />
                        {report ? (
                            <>
                                <Button variant="secondary" onClick={() => void handlePrint()}>
                                    {m.print}
                                </Button>
                                <Button onClick={() => setShareOpen(true)}>{m.share}</Button>
                            </>
                        ) : null}
                    </>
                }
            />

            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-500">{t.common.date}</span>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                {report ? <p className="text-xs text-gray-500">{report.storeName}</p> : null}
            </div>

            {error ? <Alert tone="danger">{error}</Alert> : null}
            {loading ? <p className="text-sm text-gray-400">{t.common.loading}</p> : null}

            {report && !loading ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <CompactStat label={m.netSales} value={formatBDT(report.headlines.netSales, { locale })} />
                        <CompactStat label={m.cashMovement} value={formatBDT(report.headlines.cashMovement, { locale })} />
                        <CompactStat label={m.newDues} value={formatBDT(report.headlines.newDues, { locale })} />
                        <CompactStat label={m.vsYesterday} value={vs} />
                    </div>

                    <CompactSection title={m.sales} titleStyle="heading">
                        {report.sales.bills === 0 && report.sales.gross === 0 ? (
                            <p className="text-sm text-gray-600">{m.noSales}</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <CompactStat label={m.bills} value={String(report.sales.bills)} />
                                <CompactStat label={m.gross} value={formatBDT(report.sales.gross, { locale })} />
                                <CompactStat
                                    label={m.returns}
                                    value={formatBDT(report.sales.returnsAmount, { locale })}
                                    tone="negative"
                                />
                                <CompactStat label={m.net} value={formatBDT(report.sales.net, { locale })} />
                            </div>
                        )}
                    </CompactSection>

                    {report.tenders.length > 0 ? (
                        <CompactSection title={m.tenders} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.tenders.map((row) => (
                                    <li key={row.method} className="flex justify-between gap-3">
                                        <span>{row.method.toLowerCase() === 'credit' ? m.credit : row.method}</span>
                                        <span className="font-medium">{formatBDT(row.amount, { locale })}</span>
                                    </li>
                                ))}
                            </ul>
                        </CompactSection>
                    ) : null}

                    {isTillVisible(report.till) && report.till ? (
                        <CompactSection title={m.till} titleStyle="heading">
                            {report.till.openSessionCount > 0 ? (
                                <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    {m.openTill} ({report.till.openSessionCount})
                                </p>
                            ) : null}
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                <CompactStat
                                    label={m.expectedCash}
                                    value={formatBDT(report.till.rollup.expectedCash, { locale })}
                                />
                                <CompactStat
                                    label={m.variance}
                                    value={
                                        report.till.rollup.variance == null
                                            ? '—'
                                            : formatBDT(report.till.rollup.variance, { locale })
                                    }
                                />
                                {report.till.unassignedSalesCount > 0 ? (
                                    <CompactStat
                                        label={m.unassignedSales}
                                        value={String(report.till.unassignedSalesCount)}
                                    />
                                ) : null}
                            </div>
                        </CompactSection>
                    ) : null}

                    {isMoneyOutVisible(report.moneyOut) && report.moneyOut ? (
                        <CompactSection title={m.moneyOut} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.moneyOut.purchases &&
                                (report.moneyOut.purchases.count !== 0 || report.moneyOut.purchases.net !== 0) ? (
                                    <li className="flex justify-between gap-3">
                                        <span>{m.purchases}</span>
                                        <span className="font-medium">
                                            {formatBDT(report.moneyOut.purchases.net, { locale })}
                                        </span>
                                    </li>
                                ) : null}
                                {report.moneyOut.paidToSuppliers ? (
                                    <li className="flex justify-between gap-3">
                                        <span>{m.paidToSuppliers}</span>
                                        <span className="font-medium">
                                            {formatBDT(report.moneyOut.paidToSuppliers, { locale })}
                                        </span>
                                    </li>
                                ) : null}
                                {report.moneyOut.expenses &&
                                (report.moneyOut.expenses.count !== 0 || report.moneyOut.expenses.amount !== 0) ? (
                                    <li className="flex justify-between gap-3">
                                        <span>{m.expenses}</span>
                                        <span className="font-medium">
                                            {formatBDT(report.moneyOut.expenses.amount, { locale })}
                                        </span>
                                    </li>
                                ) : null}
                            </ul>
                        </CompactSection>
                    ) : null}

                    {isDuesVisible(report.dues) && report.dues ? (
                        <CompactSection title={m.dues} titleStyle="heading">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <CompactStat label={m.newDues} value={formatBDT(report.dues.newDues, { locale })} />
                                <CompactStat label={m.collected} value={formatBDT(report.dues.collected, { locale })} />
                                <CompactStat
                                    label={m.customersOwe}
                                    value={
                                        report.dues.accountsReceivable == null
                                            ? '—'
                                            : formatBDT(report.dues.accountsReceivable, { locale })
                                    }
                                />
                                <CompactStat
                                    label={m.youOwe}
                                    value={
                                        report.dues.accountsPayable == null
                                            ? '—'
                                            : formatBDT(report.dues.accountsPayable, { locale })
                                    }
                                />
                            </div>
                        </CompactSection>
                    ) : null}

                    {report.topProducts.length > 0 ? (
                        <CompactSection title={m.topProducts} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.topProducts.map((p) => (
                                    <li key={p.name} className="flex justify-between gap-3">
                                        <span>
                                            {p.name} ×{p.units}
                                        </span>
                                        <span className="font-medium">{formatBDT(p.revenue, { locale })}</span>
                                    </li>
                                ))}
                            </ul>
                        </CompactSection>
                    ) : null}

                    {report.returns.rows.length > 0 ? (
                        <CompactSection title={m.returns} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.returns.rows.map((row) => (
                                    <li key={row.label} className="flex justify-between gap-3">
                                        <span>{row.label}</span>
                                        <span className="font-medium">{formatBDT(row.amount, { locale })}</span>
                                    </li>
                                ))}
                            </ul>
                        </CompactSection>
                    ) : null}

                    {isStockVisible(report.stock) && report.stock ? (
                        <CompactSection title={m.stock} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.stock.reorder.map((row) => (
                                    <li key={row.name} className="flex justify-between gap-3">
                                        <span>{row.name}</span>
                                        <span>
                                            {row.onHand} / {row.level}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </CompactSection>
                    ) : null}

                    {report.checklist.length > 0 ? (
                        <CompactSection title={m.checklist} titleStyle="heading">
                            <ul className="space-y-1 text-sm">
                                {report.checklist.map((item) => (
                                    <li key={item.code}>
                                        <Link href={item.href} className="text-blue-600 hover:underline">
                                            {checklistHrefLabel(item.code, m)} ({item.count})
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </CompactSection>
                    ) : null}
                </div>
            ) : null}

            {shareOpen && report ? (
                <MessageShareModal subject={m.title} text={report.whatsappText} onClose={() => setShareOpen(false)} />
            ) : null}
        </PageShell>
    );
}
