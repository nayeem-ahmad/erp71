'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Printer } from 'lucide-react';
import { MUSHAK_FORMS, MushakForm, toBengaliDigits } from '@erp71/shared-types';
import { Alert, Button, Checkbox, Field, Input, PageHeader, PageShell } from '@/components/ui';
import MushakDocument, {
    MushakColumnHead,
    type MushakIssuerBlock,
} from '@/components/mushak/MushakDocument';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';

interface BookRow {
    saleId: string;
    date: string;
    invoiceNumber: string;
    buyer: { name: string; bin: string | null; nid: string | null; address: string | null };
    branch: string | null;
    description: string;
    quantity: number;
    totalValue: number;
    sdAmount: number;
    vatAmount: number;
    inclusiveTotal: number;
}

interface Book {
    form: string;
    issuer: MushakIssuerBlock;
    period: { from: string | null; to: string | null; timezone: string };
    threshold?: number;
    rows: BookRow[];
    totals: {
        invoices: number;
        totalValue: number;
        sdAmount: number;
        vatAmount: number;
        inclusiveTotal: number;
    };
    estimated: boolean;
}

/** First and last day of the month a date falls in — NBR's tax period. */
function currentTaxPeriod() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(first), to: iso(last) };
}

function csvCell(value: string | number | null): string {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * মূসক-৬.২ · বিক্রয় হিসাব পুস্তক and মূসক-৬.১০ · the statement of large supplies
 * to unregistered buyers.
 *
 * One screen for both: they read the same sales over the same tax period and
 * differ only in which rows survive, so splitting them would duplicate the
 * period controls, the export and the table for no gain.
 */
export default function MushakBooksPage() {
    const { t, locale } = useI18n();
    const m = t.sales.mushak;
    const period = useMemo(currentTaxPeriod, []);

    const [form, setForm] = useState<string>(MushakForm.SALES_BOOK);
    const [from, setFrom] = useState(period.from);
    const [to, setTo] = useState(period.to);
    const [taxableOnly, setTaxableOnly] = useState(false);
    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const isStatement = form === MushakForm.LARGE_SUPPLY_STATEMENT;

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = isStatement
                ? await api.getMushakLargeSupplyStatement({ from, to })
                : await api.getMushakSalesBook({ from, to, taxableOnly });
            setBook(data);
        } catch (err: any) {
            setError(err?.message || m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [isStatement, from, to, taxableOnly, m]);

    useEffect(() => {
        void load();
    }, [load]);

    const exportCsv = () => {
        if (!book) return;
        const header = isStatement
            ? ['Sl.', 'Date', 'Invoice no.', 'Buyer', 'NID', 'Address', 'Description', 'Value incl. tax']
            : ['Sl.', 'Date', 'Invoice no.', 'Buyer', 'BIN', 'Address', 'Description', 'Quantity',
                'Value excl. tax', 'SD', 'VAT', 'Total incl. tax'];

        const body = book.rows.map((row, index) =>
            isStatement
                ? [index + 1, formatDate(row.date, 'en'), row.invoiceNumber, row.buyer.name, row.buyer.nid,
                    row.buyer.address, row.description, row.inclusiveTotal]
                : [index + 1, formatDate(row.date, 'en'), row.invoiceNumber, row.buyer.name, row.buyer.bin,
                    row.buyer.address, row.description, row.quantity, row.totalValue, row.sdAmount,
                    row.vatAmount, row.inclusiveTotal],
        );

        const csv = [header, ...body].map((cells) => cells.map(csvCell).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `mushak-${form}-${from}-to-${to}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const money = (value: number) => formatBDT(value, { locale });
    const title = isStatement ? m.largeSupplyTitle : m.salesBookTitle;

    return (
        <PageShell>
            <div className="no-print space-y-4">
                <PageHeader
                    title={title}
                    subtitle={m.booksSubtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        title,
                        'sales',
                    )}
                    actions={
                        <>
                            <Button variant="secondary" onClick={exportCsv} disabled={!book?.rows.length}>
                                <Download className="h-4 w-4" />
                                {m.exportCsv}
                            </Button>
                            <Button variant="primary" onClick={() => window.print()} disabled={!book}>
                                <Printer className="h-4 w-4" />
                                {m.print}
                            </Button>
                        </>
                    }
                />

                <div className="grid items-end gap-3 rounded-md border border-gray-200 bg-white p-3 md:grid-cols-4">
                    <Field label={m.form}>
                        <div className="flex gap-2">
                            {[MushakForm.SALES_BOOK, MushakForm.LARGE_SUPPLY_STATEMENT].map((code) => (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => setForm(code)}
                                    className={`min-h-touch rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors md:min-h-0 ${
                                        form === code
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    মূসক-{toBengaliDigits(code)}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label={m.periodFrom}>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </Field>
                    <Field label={m.periodTo}>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                    </Field>
                    {!isStatement ? (
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                            <Checkbox
                                checked={taxableOnly}
                                onChange={(e) => setTaxableOnly(e.target.checked)}
                            />
                            {m.taxableOnly}
                        </label>
                    ) : (
                        <p className="text-xs text-gray-500">{m.largeSupplyHint}</p>
                    )}
                </div>

                {error ? <Alert tone="danger">{error}</Alert> : null}
                {loading ? <p className="text-sm text-gray-400">{t.common.loading}</p> : null}
            </div>

            {book && !loading ? (
                <div className="mt-4">
                    <MushakDocument
                        form={book.form}
                        issuer={book.issuer}
                        banner={
                            <>
                                {!book.issuer.readiness.ready && (
                                    <Alert tone="warning" title={m.issuerIncomplete.title}>
                                        {m.issuerIncomplete.body}{' '}
                                        <Link href={routes.settings.tax} className="font-semibold underline">
                                            {m.issuerIncomplete.link}
                                        </Link>
                                    </Alert>
                                )}
                                {book.estimated && (
                                    <Alert tone="warning" title={m.estimated.title}>
                                        {m.estimated.body}
                                    </Alert>
                                )}
                            </>
                        }
                    >
                        <div className="border-b border-gray-300 py-2 text-xs text-gray-700">
                            করমেয়াদ
                            <span className="ms-1 text-[10px] text-gray-400">(Tax period)</span>:{' '}
                            <span className="font-medium">
                                {formatDate(from, locale)} — {formatDate(to, locale)}
                            </span>
                        </div>

                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[820px] border-collapse text-xs">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <MushakColumnHead bn="ক্রমিক" en="Sl." index={1} align="center" className="w-10" />
                                        <MushakColumnHead bn="তারিখ" en="Date" index={2} />
                                        <MushakColumnHead bn="চালানপত্র নম্বর" en="Invoice no." index={3} />
                                        <MushakColumnHead bn="ক্রেতার নাম" en="Buyer" index={4} />
                                        {isStatement ? (
                                            <MushakColumnHead bn="জাতীয় পরিচয়পত্র নম্বর" en="NID" index={5} />
                                        ) : (
                                            <MushakColumnHead bn="ক্রেতার বিআইএন" en="Buyer BIN" index={5} />
                                        )}
                                        <MushakColumnHead bn="ক্রেতার ঠিকানা" en="Address" index={6} />
                                        <MushakColumnHead bn="সরবরাহের বর্ণনা" en="Description" index={7} />
                                        {!isStatement ? (
                                            <>
                                                <MushakColumnHead bn="পরিমাণ" en="Quantity" index={8} align="end" />
                                                <MushakColumnHead
                                                    bn="মূল্য (কর ব্যতীত)"
                                                    en="Value excl. tax"
                                                    index={9}
                                                    align="end"
                                                />
                                                <MushakColumnHead
                                                    bn="সম্পূরক শুল্ক"
                                                    en="SD"
                                                    index={10}
                                                    align="end"
                                                />
                                                <MushakColumnHead bn="মূসক" en="VAT" index={11} align="end" />
                                                <MushakColumnHead
                                                    bn="সর্বমোট মূল্য"
                                                    en="Total incl. tax"
                                                    index={12}
                                                    align="end"
                                                />
                                            </>
                                        ) : (
                                            <MushakColumnHead
                                                bn="সর্বমোট মূল্য"
                                                en="Total incl. tax"
                                                index={8}
                                                align="end"
                                            />
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {book.rows.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={isStatement ? 8 : 12}
                                                className="border border-gray-300 px-2 py-6 text-center text-gray-400"
                                            >
                                                {m.noRows}
                                            </td>
                                        </tr>
                                    ) : (
                                        book.rows.map((row, index) => (
                                            <tr key={row.saleId}>
                                                <td className="border border-gray-300 px-2 py-1.5 text-center">
                                                    {index + 1}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5">
                                                    {formatDate(row.date, locale)}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5">
                                                    <Link
                                                        href={routes.sales.mushak(row.saleId)}
                                                        className="font-mono text-blue-600 hover:underline"
                                                    >
                                                        {row.invoiceNumber}
                                                    </Link>
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5">{row.buyer.name}</td>
                                                <td className="border border-gray-300 px-2 py-1.5 font-mono">
                                                    {(isStatement ? row.buyer.nid : row.buyer.bin) ?? '—'}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5">
                                                    {row.buyer.address ?? '—'}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5">{row.description}</td>
                                                {!isStatement ? (
                                                    <>
                                                        <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                            {row.quantity}
                                                        </td>
                                                        <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                            {money(row.totalValue)}
                                                        </td>
                                                        <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                            {money(row.sdAmount)}
                                                        </td>
                                                        <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                            {money(row.vatAmount)}
                                                        </td>
                                                    </>
                                                ) : null}
                                                <td className="border border-gray-300 px-2 py-1.5 text-end font-semibold">
                                                    {money(row.inclusiveTotal)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                                <tfoot className="bg-gray-50 font-semibold">
                                    <tr>
                                        <td
                                            className="border border-gray-300 px-2 py-1.5 text-end"
                                            colSpan={isStatement ? 7 : 8}
                                        >
                                            সর্বমোট
                                            <span className="ms-1 text-[10px] font-normal text-gray-500">(Total)</span>
                                        </td>
                                        {!isStatement ? (
                                            <>
                                                <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                    {money(book.totals.totalValue)}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                    {money(book.totals.sdAmount)}
                                                </td>
                                                <td className="border border-gray-300 px-2 py-1.5 text-end">
                                                    {money(book.totals.vatAmount)}
                                                </td>
                                            </>
                                        ) : null}
                                        <td className="border border-gray-300 px-2 py-1.5 text-end">
                                            {money(book.totals.inclusiveTotal)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </MushakDocument>

                    {/* What this build does not produce. Said plainly, so a
                        workspace knows which books it still keeps by hand. */}
                    <div className="no-print mt-4 rounded-md border border-gray-200 bg-white p-3">
                        <div className="mb-2 text-xs font-semibold text-gray-700">{m.otherForms.title}</div>
                        <p className="mb-2 text-xs text-gray-500">{m.otherForms.body}</p>
                        <ul className="grid gap-1 text-xs text-gray-500 md:grid-cols-2">
                            {MUSHAK_FORMS.filter((entry) => !entry.supported).map((entry) => (
                                <li key={entry.code}>
                                    <span className="font-medium text-gray-700">মূসক-{toBengaliDigits(entry.code)}</span>
                                    {' — '}
                                    {entry.titleBn} <span className="text-gray-400">({entry.titleEn})</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : null}
        </PageShell>
    );
}
