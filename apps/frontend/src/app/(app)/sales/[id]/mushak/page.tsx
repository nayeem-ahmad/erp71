'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Printer, Save } from 'lucide-react';
import { Alert, Button, Field, Input, PageHeader, PageShell } from '@/components/ui';
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
import { toast } from '@/lib/toast';
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
        number: string;
        serialNumber: string;
        issuedAt: string;
        status: string;
        cancelled: boolean;
        destination: string | null;
        vehicleNo: string | null;
        branch: string | null;
    };
    lines: TaxInvoiceLine[];
    totals: { totalValue: number; sdAmount: number; vatAmount: number; inclusiveTotal: number };
    estimated: boolean;
}

/**
 * মূসক-৬.৩ · কর চালানপত্র — the NBR tax invoice for one sale.
 *
 * Distinct from `/sales/[id]/invoice`, which is the shop's own branded invoice.
 * That one is a commercial document and can look however the shop likes; this
 * one is the statutory form and has to keep the gazetted column order and
 * wording, so the two deliberately do not share a layout.
 */
export default function MushakTaxInvoicePage() {
    const { t, locale } = useI18n();
    const params = useParams();
    const m = t.sales.mushak;

    const [doc, setDoc] = useState<TaxInvoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [destination, setDestination] = useState('');
    const [vehicleNo, setVehicleNo] = useState('');
    const [saving, setSaving] = useState(false);

    const saleId = params.id as string;

    const load = useCallback(async () => {
        try {
            const data: TaxInvoice = await api.getMushakTaxInvoice(saleId);
            setDoc(data);
            setDestination(data.invoice.destination ?? '');
            setVehicleNo(data.invoice.vehicleNo ?? '');
        } catch (err: any) {
            setError(err?.message || t.shared.errors.loadInvoice);
        } finally {
            setLoading(false);
        }
    }, [saleId, t]);

    useEffect(() => {
        if (saleId) void load();
    }, [saleId, load]);

    const saveDeliveryDetails = async () => {
        setSaving(true);
        try {
            await api.updateSale(saleId, {
                mushakDestination: destination,
                mushakVehicleNo: vehicleNo,
            });
            toast.success(m.deliverySaved);
            await load();
        } catch (err: any) {
            toast.error(err?.message || m.deliverySaveFailed);
        } finally {
            setSaving(false);
        }
    };

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
                            { label: t.sales.list.title, href: routes.sales.list },
                            { label: invoice.number, href: routes.sales.detail(invoice.saleId) },
                        ],
                        m.taxInvoiceTitle,
                    )}
                    actions={
                        <>
                            <Link
                                href={routes.sales.invoice(invoice.saleId)}
                                className="text-xs font-medium text-blue-600 hover:underline"
                            >
                                {m.viewPlainInvoice}
                            </Link>
                            <Button variant="primary" onClick={() => window.print()}>
                                <Printer className="h-4 w-4" />
                                {m.print}
                            </Button>
                        </>
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
                {/* Buyer block on the left, document identity on the right —
                    the layout the gazetted form prints. */}
                <section className="grid gap-x-6 gap-y-3 border-b border-gray-300 py-3 md:grid-cols-2">
                    <div className="space-y-1">
                        <MushakPartyPanel heading={{ bn: 'ক্রেতার তথ্য', en: 'Buyer' }} party={buyer} />
                        <MushakField
                            bn="সরবরাহের গন্তব্যস্থল"
                            en="Destination of supply"
                            value={invoice.destination}
                        />
                        <MushakField
                            bn="যানবাহনের প্রকৃতি ও নম্বর"
                            en="Vehicle type and number"
                            value={invoice.vehicleNo}
                        />
                    </div>
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

            {/* The two boxes nothing else in the system records. Kept off the
                sales entry form on purpose: a counter sale the customer carries
                out has neither, and only a delivered supply needs them. */}
            <div className="no-print mt-4 rounded-md border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">{m.deliveryDetails.title}</div>
                <p className="mb-3 text-xs text-gray-500">{m.deliveryDetails.hint}</p>
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label={m.deliveryDetails.destination}>
                        <Input
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                            placeholder={m.deliveryDetails.destinationPlaceholder}
                        />
                    </Field>
                    <Field label={m.deliveryDetails.vehicle}>
                        <Input
                            value={vehicleNo}
                            onChange={(e) => setVehicleNo(e.target.value)}
                            placeholder={m.deliveryDetails.vehiclePlaceholder}
                        />
                    </Field>
                </div>
                <div className="mt-3">
                    <Button variant="primary" onClick={saveDeliveryDetails} disabled={saving}>
                        <Save className="h-4 w-4" />
                        {saving ? m.saving : t.common.save}
                    </Button>
                </div>
            </div>
        </PageShell>
    );
}
