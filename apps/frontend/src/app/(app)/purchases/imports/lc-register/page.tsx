'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatCurrency, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';

type LcRow = {
    id: string;
    reference_number: string;
    lc_number: string | null;
    lc_type: string | null;
    bank_name: string | null;
    supplier: string | null;
    status: string;
    currency: string;
    invoice_value_fc: number;
    invoice_value_bdt: number;
    lc_expiry_date: string | null;
    latest_shipment_date: string | null;
    days_to_expiry: number | null;
    is_expired: boolean;
    costs_to_date_bdt: number;
};

type BankRow = { bank_name: string; open_lcs: number; outstanding_bdt: number };

/**
 * An expired LC is a real loss — the bank's undertaking lapses while the goods
 * may already be on the water — so expiry is the column the page is sorted and
 * coloured by. Red only once it has actually expired; amber inside a fortnight.
 */
function expiryClass(row: LcRow): string {
    if (row.is_expired) return 'text-red-600 font-semibold';
    if (row.days_to_expiry !== null && row.days_to_expiry <= 14) return 'text-amber-600 font-semibold';
    return 'text-gray-700';
}

export default function LcRegisterPage() {
    const { t, locale } = useI18n();
    const copy = t.imports.lcRegister;
    const [rows, setRows] = useState<LcRow[]>([]);
    const [banks, setBanks] = useState<BankRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([api.getLcRegister(), api.getImportBankLimits()])
            .then(([register, limits]) => {
                setRows(register);
                setBanks(limits);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    'purchases',
                    [{ label: t.imports.title, href: routes.purchases.imports.root }],
                    copy.title,
                )}
            />

            {banks.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-2 text-xs font-semibold uppercase text-gray-500">{copy.bankLimits}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {banks.map((bank) => (
                            <div key={bank.bank_name} className="rounded-lg border border-gray-100 p-3">
                                <p className="text-sm font-semibold text-gray-900">{bank.bank_name}</p>
                                <p className="text-xs text-gray-500">
                                    {bank.open_lcs} {copy.openLcs}
                                </p>
                                <p className="mt-1 text-sm font-semibold text-blue-600">
                                    {formatBDT(bank.outstanding_bdt, { locale })}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white">
                {loading ? (
                    <p className="p-4 text-sm text-gray-500">{t.common.loading}</p>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-8 text-center">
                        <FileText className="h-12 w-12 text-gray-200" />
                        <p className="text-sm text-gray-500">{copy.empty}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="p-3">{t.imports.columns.reference}</th>
                                    <th className="p-3">{t.imports.columns.lcNumber}</th>
                                    <th className="hidden p-3 md:table-cell">{t.imports.columns.supplier}</th>
                                    <th className="hidden p-3 lg:table-cell">Bank</th>
                                    <th className="p-3 text-end">{t.imports.columns.invoiceValue}</th>
                                    <th className="p-3">{copy.daysToExpiry}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id} className="border-b border-gray-50">
                                        <td className="p-3">
                                            <Link
                                                href={routes.purchases.imports.shipmentDetail(row.id)}
                                                className="font-semibold text-blue-600 hover:underline"
                                            >
                                                {row.reference_number}
                                            </Link>
                                        </td>
                                        <td className="p-3 text-gray-700">{row.lc_number ?? '—'}</td>
                                        <td className="hidden p-3 text-gray-700 md:table-cell">{row.supplier ?? '—'}</td>
                                        <td className="hidden p-3 text-gray-700 lg:table-cell">{row.bank_name ?? '—'}</td>
                                        <td className="p-3 text-end text-gray-900">
                                            {formatCurrency(row.invoice_value_fc, { currency: row.currency, locale })}
                                        </td>
                                        <td className={`p-3 ${expiryClass(row)}`}>
                                            {row.lc_expiry_date === null ? (
                                                '—'
                                            ) : row.is_expired ? (
                                                copy.expired
                                            ) : (
                                                <>
                                                    {row.days_to_expiry}
                                                    <span className="ms-2 text-xs font-normal text-gray-400">
                                                        {formatDate(row.lc_expiry_date, locale)}
                                                    </span>
                                                </>
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
