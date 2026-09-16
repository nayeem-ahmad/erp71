'use client';

import { useEffect, useState } from 'react';
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
import { formatBDT, formatDate } from '@/lib/format';

interface CreditNoteLine {
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

interface CreditNote {
    form: string;
    issuer: MushakIssuerBlock;
    buyer: MushakPartyBlock;
    note: {
        returnId: string;
        number: string;
        issuedAt: string;
        reason: string | null;
        branch: string | null;
    };
    against: { saleId: string; number: string; issuedAt: string };
    lines: CreditNoteLine[];
    totals: { totalValue: number; sdAmount: number; vatAmount: number; inclusiveTotal: number };
    estimated: boolean;
}

/**
 * মূসক-৬.৭ · ক্রেডিট নোট — the note that reduces the value of a supply already
 * invoiced, raised against a sales return.
 *
 * Rule 40(1)(ঞ) requires it to name the চালানপত্র it reduces, so a return
 * recorded without a linked sale cannot produce one; the API refuses, and the
 * message it returns is what this page shows.
 */
export default function MushakCreditNotePage() {
    const { t, locale } = useI18n();
    const params = useParams();
    const m = t.sales.mushak;

    const [doc, setDoc] = useState<CreditNote | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const returnId = params.id as string;

    useEffect(() => {
        if (!returnId) return;
        api.getMushakCreditNote(returnId)
            .then((data: CreditNote) => setDoc(data))
            .catch((err: any) => setError(err?.message || m.creditNoteUnavailable))
            .finally(() => setLoading(false));
    }, [returnId, m]);

    if (loading) {
        return (
            <PageShell>
                <p className="text-sm text-gray-400">{t.common.loading}</p>
            </PageShell>
        );
    }

    if (error || !doc) {
        return (
            <PageShell>
                <PageHeader title={m.creditNoteTitle} />
                <Alert tone="warning" title={m.creditNoteUnavailable}>
                    {error}
                </Alert>
                <div className="mt-3">
                    <Link href={routes.sales.returns} className="text-xs font-medium text-blue-600 hover:underline">
                        {m.backToReturns}
                    </Link>
                </div>
            </PageShell>
        );
    }

    const { issuer, buyer, note, against, lines, totals } = doc;
    const money = (value: number) => formatBDT(value, { locale });

    return (
        <PageShell>
            <div className="no-print">
                <PageHeader
                    title={m.creditNoteTitle}
                    subtitle={note.number}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        'sales',
                        [
                            { label: t.returns.title, href: routes.sales.returns },
                            { label: note.number, href: routes.sales.returnDetail(note.returnId) },
                        ],
                        m.creditNoteTitle,
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
                    </>
                }
            >
                <section className="grid gap-x-6 gap-y-3 border-b border-gray-300 py-3 md:grid-cols-2">
                    <MushakPartyPanel heading={{ bn: 'ক্রেতার তথ্য', en: 'Buyer' }} party={buyer} />
                    <div className="space-y-1">
                        <MushakField bn="ক্রেডিট নোট নম্বর" en="Credit note no." value={note.number} mono />
                        <MushakField
                            bn="ইস্যুর তারিখ"
                            en="Date of issue"
                            value={formatDate(note.issuedAt, locale)}
                        />
                        <MushakField
                            bn="সংশ্লিষ্ট চালানপত্র নম্বর"
                            en="Against invoice no."
                            value={
                                <Link
                                    href={routes.sales.mushak(against.saleId)}
                                    className="font-mono text-blue-600 hover:underline"
                                >
                                    {against.number}
                                </Link>
                            }
                        />
                        <MushakField
                            bn="চালানপত্রের তারিখ"
                            en="Invoice date"
                            value={formatDate(against.issuedAt, locale)}
                        />
                        <MushakField bn="হ্রাসের কারণ" en="Reason for reduction" value={note.reason} />
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
                                <MushakColumnHead bn="হ্রাসকৃত মূল্য" en="Value reduced" index={6} align="end" />
                                <MushakColumnHead bn="সম্পূরক শুল্ক" en="SD reduced" index={7} align="end" />
                                <MushakColumnHead bn="মূসকের হার" en="VAT rate" index={8} align="end" />
                                <MushakColumnHead bn="হ্রাসকৃত মূসক" en="VAT reduced" index={9} align="end" />
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
