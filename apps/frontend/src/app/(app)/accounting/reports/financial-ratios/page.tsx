'use client';

import { useEffect, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function defaultTo() { return new Date().toISOString().slice(0, 10); }

interface RatiosData {
    as_of: string;
    period: { from: string; to: string };
    ratios: {
        current_ratio: number | null;
        gross_margin_pct: number | null;
        net_profit_margin_pct: number | null;
        dso_days: number | null;
        dpo_days: number | null;
        revenue: number;
        total_expenses: number;
        net_profit: number;
        total_assets: number;
        total_liabilities: number;
    };
}

function RatioCard({ label, value, description, format, healthyCondition }: {
    label: string;
    value: number | null;
    description: string;
    format?: 'number' | 'pct' | 'days' | 'bdt';
    healthyCondition?: (v: number) => boolean;
}) {
    const { locale } = useI18n();
    const isHealthy = value !== null && healthyCondition ? healthyCondition(value) : null;
    const formattedValue = value === null ? 'N/A' :
        format === 'pct' ? `${value.toFixed(1)}%` :
        format === 'days' ? `${value.toFixed(1)} days` :
        format === 'bdt' ? formatBDT(value, { locale }) :
        value.toFixed(2);

    const tone = isHealthy === true ? 'positive' : isHealthy === false ? 'negative' : 'default';
    const borderClass = isHealthy === true ? 'border-emerald-200' : isHealthy === false ? 'border-red-200' : 'border-gray-100';

    return (
        <div className={`${compactDensity.cardFlat} ${borderClass}`}>
            <CompactStat
                label={label}
                value={formattedValue}
                tone={tone}
                className="border-0 p-0 shadow-none bg-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">{description}</p>
        </div>
    );
}

export default function FinancialRatiosPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<RatiosData | null>(null);
    const [asOfDate, setAsOfDate] = useState(defaultTo());
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [asOfDate, fromDate, toDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getFinancialRatios({
                asOfDate: asOfDate || undefined,
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <AccountingToolbar subtitle="Key financial health indicators">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>As Of (Balance Sheet)</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>From (P&L)</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>To (P&L)</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <RatioCard label={t.accounting.reports.financialRatios.currentRatio} value={data.ratios.current_ratio} description={t.accounting.reports.financialRatios.currentRatioDesc} format="number" healthyCondition={(v) => v >= 1} />
                        <RatioCard label={t.accounting.reports.financialRatios.grossMargin} value={data.ratios.gross_margin_pct} description={t.accounting.reports.financialRatios.grossMarginDesc} format="pct" healthyCondition={(v) => v >= 0} />
                        <RatioCard label={t.accounting.reports.financialRatios.netProfitMargin} value={data.ratios.net_profit_margin_pct} description={t.accounting.reports.financialRatios.grossMarginDesc} format="pct" healthyCondition={(v) => v >= 0} />
                        <RatioCard label={t.accounting.reports.financialRatios.dso} value={data.ratios.dso_days} description={t.accounting.reports.financialRatios.dsoDesc} format="days" healthyCondition={(v) => v <= 45} />
                        <RatioCard label={t.accounting.reports.financialRatios.dpo} value={data.ratios.dpo_days} description={t.accounting.reports.financialRatios.dpoDesc} format="days" healthyCondition={(v) => v <= 60} />
                    </div>
                    <CompactSection title="Summary">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div><p className={compactDensity.formLabel}>{t.accounting.reports.revenue}</p><p className="font-semibold">{formatBDT(data.ratios.revenue, { locale })}</p></div>
                            <div><p className={compactDensity.formLabel}>{t.accounting.reports.financialRatios.totalExpenses}</p><p className="font-semibold">{formatBDT(data.ratios.total_expenses, { locale })}</p></div>
                            <div><p className={compactDensity.formLabel}>{t.accounting.reports.netProfit}</p><p className={`font-semibold ${data.ratios.net_profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(data.ratios.net_profit, { locale })}</p></div>
                            <div><p className={compactDensity.formLabel}>{t.accounting.reports.financialRatios.totalAssets}</p><p className="font-semibold">{formatBDT(data.ratios.total_assets, { locale })}</p></div>
                            <div><p className={compactDensity.formLabel}>Total Liabilities</p><p className="font-semibold">{formatBDT(data.ratios.total_liabilities, { locale })}</p></div>
                        </div>
                    </CompactSection>
                </div>
            ) : null}
        </AccountingPageShell>
    );
}