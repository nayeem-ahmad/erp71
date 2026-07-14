'use client';

import { useEffect, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function defaultTo() { return new Date().toISOString().slice(0, 10); }

interface VatAccount { id: string; name: string; code?: string | null; type: string; total: number; }
interface VatData {
    filters: { from: string; to: string };
    output_vat: { accounts: VatAccount[]; total: number };
    input_vat: { accounts: VatAccount[]; total: number };
    net_vat_payable: number;
    note: string;
}

export default function VatTaxPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<VatData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getVatTaxReport({ from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <PageHeader
                title={t.accounting.reports.vatTax.title}
                subtitle={t.accounting.reports.vatTax.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.reports.vatTax.title,
                    'accounting',
                )}
            />
            <AccountingToolbar>
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>To</span>
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
                    {data.net_vat_payable >= 0 ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex justify-between items-center">
                            <CompactStat
                                label="Net VAT Payable"
                                value={formatBDT(data.net_vat_payable, { locale })}
                                tone="warning"
                                className="border-0 p-0 shadow-none bg-transparent"
                            />
                            <p className="text-xs text-amber-600 max-w-xs text-right">{data.note}</p>
                        </div>
                    ) : (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex justify-between items-center">
                            <CompactStat
                                label="VAT Refundable"
                                value={formatBDT(Math.abs(data.net_vat_payable))}
                                tone="positive"
                                className="border-0 p-0 shadow-none bg-transparent"
                            />
                            <p className="text-xs text-emerald-600 max-w-xs text-right">{data.note}</p>
                        </div>
                    )}
                    <CompactSection title="Output VAT (Collected)" className="space-y-2">
                        {data.output_vat.accounts.map((a) => (
                            <div key={a.id} className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-700">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</span>
                                <span className="font-medium text-gray-900">{formatBDT(a.total, { locale })}</span>
                            </div>
                        ))}
                        <div className="flex justify-between font-semibold text-sm pt-1">
                            <span>Total Output VAT</span>
                            <span className="text-danger-text">{formatBDT(data.output_vat.total, { locale })}</span>
                        </div>
                    </CompactSection>
                    <CompactSection title="Input VAT (Paid)" className="space-y-2">
                        {data.input_vat.accounts.map((a) => (
                            <div key={a.id} className="flex justify-between text-sm py-1 border-b border-gray-50">
                                <span className="text-gray-700">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</span>
                                <span className="font-medium text-gray-900">{formatBDT(a.total, { locale })}</span>
                            </div>
                        ))}
                        <div className="flex justify-between font-semibold text-sm pt-1">
                            <span>Total Input VAT</span>
                            <span className="text-emerald-700">{formatBDT(data.input_vat.total, { locale })}</span>
                        </div>
                    </CompactSection>
                </div>
            ) : null}
        </AccountingPageShell>
    );
}