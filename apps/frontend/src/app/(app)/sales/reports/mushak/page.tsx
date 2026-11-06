'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, Download, FileText, Landmark, Printer, Receipt, Scale, Wallet } from 'lucide-react';
import { MUSHAK_FORMS, MushakForm, toBengaliDigits } from '@erp71/shared-types';
import { Alert, BranchFilter, Button, PageHeader, PageShell } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import MushakDocument, {
    MushakColumnHead,
    type MushakIssuerBlock,
} from '@/components/mushak/MushakDocument';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { matchesSearch } from '@/lib/list-filter';
import type { CreatedRange, CreatedRangePreset } from '@/lib/created-range';

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
function currentTaxPeriod(): Required<CreatedRange> {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(first), to: iso(last) };
}

const PERIOD_PRESETS: readonly CreatedRangePreset[] = ['thisMonth', 'last3Months', 'last6Months', 'thisYear'];

function csvCell(value: string | number | null): string {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const sum = (rows: BookRow[], pick: (row: BookRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * মূসক-৬.২ · বিক্রয় হিসাব পুস্তক and মূসক-৬.১০ · the statement of large supplies
 * to unregistered buyers.
 *
 * One screen for both: they read the same sales over the same tax period and
 * differ only in which rows survive, so splitting them would duplicate the
 * period controls, the export and the table for no gain.
 *
 * On screen the book is a list like any other — the tax period and the
 * taxable-only switch in the toolbar, the totals in the strip. Printed, it is
 * the gazetted form: `MushakDocument`, with its Bangla headings and its own
 * column numbers, always the whole book whatever the search box holds.
 */
export default function MushakBooksPage() {
    const { t, locale } = useI18n();
    const m = t.sales.mushak;
    const branch = useBranchScope();
    const storeId = branch.apiStoreId;

    const [form, setForm] = useState<string>(MushakForm.SALES_BOOK);
    // Cleared, the period goes back to the tax period under way.
    const [period, setPeriod] = useState<CreatedRange>(currentTaxPeriod);
    const from = period.from ?? '';
    const to = period.to ?? '';
    const [taxableOnly, setTaxableOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const isStatement = form === MushakForm.LARGE_SUPPLY_STATEMENT;

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = { from: from || undefined, to: to || undefined, storeId };
            const data = isStatement
                ? await api.getMushakLargeSupplyStatement(params)
                : await api.getMushakSalesBook({ ...params, taxableOnly });
            setBook(data);
        } catch (err: any) {
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            setError(err?.message || m.loadFailed);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStatement, from, to, storeId, taxableOnly, m]);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
    }, [branch.ready, load]);

    // Sl. is the row's place in the book, so it matches the printed form.
    const serial = useMemo(
        () => new Map((book?.rows ?? []).map((row, index) => [row.saleId, index + 1])),
        [book],
    );

    const rows = useMemo(
        () => (book?.rows ?? []).filter((row) => matchesSearch(
            search,
            row.invoiceNumber,
            row.buyer.name,
            row.buyer.bin,
            row.buyer.nid,
            row.buyer.address,
            row.description,
        )),
        [book, search],
    );

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

    const money = useCallback((value: number) => formatBDT(value, { locale }), [locale]);
    const title = isStatement ? m.largeSupplyTitle : m.salesBookTitle;
    const c = m.columns;

    const columns = useMemo(() => {
        const amount = (value: number) => <span className="tabular-nums">{money(value)}</span>;
        const figure = (id: keyof BookRow, header: string, mobile = false) => ({
            id,
            header,
            accessorKey: id,
            meta: mobile ? { align: 'end' } : { align: 'end', hideOnMobile: true },
            cell: ({ row }: { row: { original: BookRow } }) => amount(row.original[id] as number),
            footer: () => amount(sum(rows, (row) => row[id] as number)),
        });
        return [
            {
                id: 'sl',
                header: c.sl,
                accessorFn: (row: BookRow) => serial.get(row.saleId) ?? 0,
                meta: { align: 'end', hideOnMobile: true },
                size: 60,
            },
            {
                id: 'date',
                header: c.date,
                accessorKey: 'date',
                cell: ({ row }: { row: { original: BookRow } }) => formatDate(row.original.date, locale),
                footer: () => t.common.total,
            },
            {
                id: 'invoiceNumber',
                header: c.invoice,
                accessorKey: 'invoiceNumber',
                cell: ({ row }: { row: { original: BookRow } }) => (
                    <Link href={routes.sales.mushak(row.original.saleId)} className="font-mono text-blue-600 hover:underline">
                        {row.original.invoiceNumber}
                    </Link>
                ),
            },
            {
                id: 'buyer',
                header: c.buyer,
                accessorFn: (row: BookRow) => row.buyer.name,
            },
            {
                id: 'buyerId',
                header: isStatement ? c.nid : c.buyerBin,
                accessorFn: (row: BookRow) => (isStatement ? row.buyer.nid : row.buyer.bin) ?? '—',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: BookRow } }) => (
                    <span className="font-mono">{(isStatement ? row.original.buyer.nid : row.original.buyer.bin) ?? '—'}</span>
                ),
            },
            {
                id: 'address',
                header: c.address,
                accessorFn: (row: BookRow) => row.buyer.address ?? '—',
                meta: { hideOnMobile: true },
            },
            {
                id: 'description',
                header: c.description,
                accessorKey: 'description',
                meta: { hideOnMobile: true },
            },
            ...(isStatement
                ? []
                : [
                    {
                        id: 'quantity',
                        header: c.quantity,
                        accessorKey: 'quantity',
                        meta: { align: 'end', hideOnMobile: true },
                        cell: ({ row }: { row: { original: BookRow } }) => (
                            <span className="tabular-nums">{row.original.quantity}</span>
                        ),
                    },
                    figure('totalValue', c.valueExclTax),
                    figure('sdAmount', c.sd),
                    figure('vatAmount', c.vat),
                ]),
            figure('inclusiveTotal', c.totalInclTax, true),
        ];
    }, [c, t, isStatement, rows, serial, locale, money]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: m.taxPeriod,
            value: period,
            onChange: (next) => setPeriod(next ?? currentTaxPeriod()),
            presets: PERIOD_PRESETS,
            operators: true,
        },
        ...(isStatement ? [] : [{
            id: 'taxableOnly',
            type: 'toggle' as const,
            label: m.taxableOnly,
            pressed: taxableOnly,
            onChange: setTaxableOnly,
            control: 'button' as const,
        }]),
    ], [m, period, isStatement, taxableOnly]);

    const stats = useMemo(() => {
        const items: ListStat[] = isStatement
            ? [
                { id: 'invoices', icon: <Receipt aria-hidden />, label: m.invoices, value: rows.length.toLocaleString() },
                {
                    id: 'inclusiveTotal',
                    icon: <Wallet aria-hidden />,
                    label: c.totalInclTax,
                    value: money(sum(rows, (row) => row.inclusiveTotal)),
                },
                {
                    id: 'threshold',
                    icon: <Scale aria-hidden />,
                    label: m.threshold,
                    value: book?.threshold != null ? money(book.threshold) : '—',
                },
            ]
            : [
                { id: 'invoices', icon: <Receipt aria-hidden />, label: m.invoices, value: rows.length.toLocaleString() },
                { id: 'totalValue', icon: <FileText aria-hidden />, label: c.valueExclTax, value: money(sum(rows, (row) => row.totalValue)) },
                { id: 'sdAmount', icon: <Landmark aria-hidden />, label: c.sd, value: money(sum(rows, (row) => row.sdAmount)) },
                { id: 'vatAmount', icon: <Calculator aria-hidden />, label: c.vat, value: money(sum(rows, (row) => row.vatAmount)) },
                {
                    id: 'inclusiveTotal',
                    icon: <Wallet aria-hidden />,
                    label: c.totalInclTax,
                    value: money(sum(rows, (row) => row.inclusiveTotal)),
                },
            ];
        return { items, loading: loading && !book, label: m.statsLabel };
    }, [isStatement, rows, book, loading, m, c, money]);

    return (
        <PageShell>
            <div className="no-print space-y-4 print:hidden">
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
                            <BranchFilter scope={branch} />
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

                {error ? <Alert tone="danger">{error}</Alert> : null}
                {book && !book.issuer.readiness.ready ? (
                    <Alert tone="warning" title={m.issuerIncomplete.title}>
                        {m.issuerIncomplete.body}{' '}
                        <Link href={routes.settings.tax} className="font-semibold underline">
                            {m.issuerIncomplete.link}
                        </Link>
                    </Alert>
                ) : null}
                {book?.estimated ? (
                    <Alert tone="warning" title={m.estimated.title}>
                        {m.estimated.body}
                    </Alert>
                ) : null}
                {isStatement ? <p className="text-xs text-gray-500">{m.largeSupplyHint}</p> : null}

                <DataTable
                    title={title}
                    tableId="sales-mushak-books"
                    columns={columns as never}
                    data={rows}
                    getRowId={(row: BookRow) => row.saleId}
                    isLoading={loading}
                    emptyMessage={m.noRows}
                    emptyIcon={<Receipt className="h-16 w-16 text-gray-200" />}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                    toolbarActions={(
                        <GroupByChip<string>
                            label={m.form}
                            value={form}
                            onChange={setForm}
                            options={[MushakForm.SALES_BOOK, MushakForm.LARGE_SUPPLY_STATEMENT].map((code) => ({
                                value: code,
                                label: `মূসক-${toBengaliDigits(code)}`,
                            }))}
                        />
                    )}
                />

                {/* What this build does not produce. Said plainly, so a
                    workspace knows which books it still keeps by hand. */}
                <div className="rounded-md border border-gray-200 bg-white p-3">
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

            {/* The statutory form, for the printer only: the gazetted layout,
                the whole book, its Bangla headings untouched. */}
            {book && !loading ? (
                <div className="hidden print:block">
                    <MushakDocument form={book.form} issuer={book.issuer}>
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
                </div>
            ) : null}
        </PageShell>
    );
}
