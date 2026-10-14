'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { Alert, Button, PageHeader, PageShell } from '@/components/ui';
import MushakDocument, {
    MushakColumnHead,
    MushakField,
    MushakPartyPanel,
    MushakSignature,
    type MushakIssuerBlock,
    type MushakPartyBlock,
} from '@/components/mushak/MushakDocument';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';

interface TaxInvoiceLine {
    serial: number;
    description: string;
    sku: string | null;
    unitBn: string;
    unitEn: string;
    quantity: number;
    unitValue: number;
    totalValue: number;
    sdRate: number;
    sdAmount: number;
    vatRate: number;
    vatAmount: number;
    inclusiveTotal: number;
}

interface TaxInvoice {
    form: string;
    issuer: MushakIssuerBlock;
    buyer: MushakPartyBlock;
    invoice: {
        saleId: string;
        exchangeId: string;
        number: string;
        serialNumber: string;
        issuedAt: string;
        status: string;
        cancelled: boolean;
        branch: string | null;
    };
    lines: TaxInvoiceLine[];
    totals: { totalValue: number; sdAmount: number; vatAmount: number; inclusiveTotal: number };
    estimated: boolean;
}

/** মূসক-৬.৩ for the goods that went out on an exchange. */
export default function ExchangeMushakPage() {
    const { t, locale } = useI18n();
    const params = useParams();
    const m = t.sales.mushak;
    const exchangeId = params.id as string;

    const [doc, setDoc] = useState<TaxInvoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setDoc(await api.getExchangeMushak(exchangeId));
        } catch (err: any) {
            setError(err?.message || t.shared.errors.loadInvoice);
        } finally {
            setLoading(false);
        }
    }, [exchangeId, t]);

    useEffect(() => {
        if (exchangeId) void load();
    }, [exchangeId, load]);

    if (loading) {
        return (
            <PageShell>
                <p className="text-sm text-gray-400">{t.shared.loading.invoice}</p>
            </PageShell>
        );
    }

    if (error || !doc) {
        return (
            <PageShell>
                <Alert tone="danger">{error || t.shared.notFound.invoice}</Alert>
                <div className="mt-3">
                    <Link href={routes.sales.exchangeDetail(exchangeId)} className="text-xs font-medium text-blue-600 hover:underline">
                        {t.exchanges.title}
                    </Link>
                </div>
            </PageShell>
        );
    }

    const { issuer, buyer, invoice, lines, totals } = doc;
    const money = (value: number) => formatBDT(value, { locale });

    return (
        <PageShell>
            <div className="no-print">
                <PageHeader
                    title={m.taxInvoiceTitle}
                    subtitle={invoice.number}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        'sales',
                        [
                            { label: t.exchanges.title, href: routes.sales.exchanges },
                            { label: invoice.number, href: routes.sales.exchangeDetail(invoice.exchangeId) },
                        ],
                        m.taxInvoiceTitle,
                    )}
                    actions={
                        <Button variant="primary" onClick={() => window.print()}>
                            <Printer className="h-4 w-4" />
                            {m.print}
                        </Button>
                    }
                />
            </div>

            <MushakDocument
                form={doc.form}
                issuer={issuer}
                banner={
                    <>
                        {!issuer.readiness.ready && (
                            <Alert tone="warning" title={m.issuerIncomplete.title}>
                                {m.issuerIncomplete.body}{' '}
                                <Link href={routes.settings.tax} className="font-semibold underline">
                                    {m.issuerIncomplete.link}
                                </Link>
                            </Alert>
                        )}
                        {doc.estimated && (
                            <Alert tone="warning" title={m.estimated.title}>
                                {m.estimated.body}
                            </Alert>
                        )}
                        {invoice.cancelled && (
                            <Alert tone="danger" title={m.cancelled.title}>
                                {m.cancelled.body}
                            </Alert>
                        )}
                    </>
                }
            >
                <section className="grid gap-x-6 gap-y-3 border-b border-gray-300 py-3 md:grid-cols-2">
                    <MushakPartyPanel heading={{ bn: 'ক্রেতার তথ্য', en: 'Buyer' }} party={buyer} />
                    <div className="space-y-1">
                        <MushakField bn="চালানপত্র নম্বর" en="Invoice no." value={invoice.number} mono />
                        <MushakField
                            bn="ইস্যুর তারিখ"
                            en="Date of issue"
                            value={formatDate(invoice.issuedAt, locale)}
                        />
                        <MushakField
                            bn="ইস্যুর সময়"
                            en="Time of issue"
                            value={formatDateTime(invoice.issuedAt, locale)}
                        />
                        {invoice.branch ? (
                            <MushakField bn="শাখা" en="Branch" value={invoice.branch} />
                        ) : null}
                    </div>
                </section>

                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                        <thead className="bg-gray-50">
                            <tr>
                                <MushakColumnHead bn="ক্রমিক" en="Sl." index={1} align="center" className="w-10" />
                                <MushakColumnHead bn="পণ্য বা সেবার বর্ণনা" en="Description" index={2} />
                                <MushakColumnHead bn="সরবরাহের একক" en="Unit" index={3} align="center" />
                                <MushakColumnHead bn="পরিমাণ" en="Quantity" index={4} align="end" />
                                <MushakColumnHead bn="একক মূল্য" en="Unit price" index={5} align="end" />
                                <MushakColumnHead bn="মোট মূল্য" en="Total value" index={6} align="end" />
                                <MushakColumnHead bn="সম্পূরক শুল্ক" en="SD amount" index={7} align="end" />
                                <MushakColumnHead bn="মূসকের হার" en="VAT rate" index={8} align="end" />
                                <MushakColumnHead bn="মূসকের পরিমাণ" en="VAT amount" index={9} align="end" />
                                <MushakColumnHead
                                    bn="শুল্ক ও করসহ মূল্য"
                                    en="Total incl. all taxes"
                                    index={10}
                                    align="end"
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line) => (
                                <tr key={line.serial}>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">{line.serial}</td>
                                    <td className="border border-gray-300 px-2 py-1.5">
                                        {line.description}
                                        {line.sku ? (
                                            <span className="ms-1 font-mono text-[10px] text-gray-400">{line.sku}</span>
                                        ) : null}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">
                                        {line.unitBn}
                                        <span className="ms-1 text-[10px] text-gray-400">({line.unitEn})</span>
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">{line.quantity}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">{money(line.unitValue)}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">{money(line.totalValue)}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">
                                        {line.sdRate > 0 ? `${line.sdRate}% · ${money(line.sdAmount)}` : '—'}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">{line.vatRate}%</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end">{money(line.vatAmount)}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-end font-semibold">
                                        {money(line.inclusiveTotal)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 font-semibold">
                            <tr>
                                <td className="border border-gray-300 px-2 py-1.5 text-end" colSpan={5}>
                                    সর্বমোট
                                    <span className="ms-1 text-[10px] font-normal text-gray-500">(Total)</span>
                                </td>
                                <td className="border border-gray-300 px-2 py-1.5 text-end">{money(totals.totalValue)}</td>
                                <td className="border border-gray-300 px-2 py-1.5 text-end">{money(totals.sdAmount)}</td>
                                <td className="border border-gray-300 px-2 py-1.5" />
                                <td className="border border-gray-300 px-2 py-1.5 text-end">{money(totals.vatAmount)}</td>
                                <td className="border border-gray-300 px-2 py-1.5 text-end">
                                    {money(totals.inclusiveTotal)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <MushakSignature issuer={issuer} />
            </MushakDocument>
        </PageShell>
    );
}
