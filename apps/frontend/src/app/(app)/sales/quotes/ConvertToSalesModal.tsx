'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/** What `POST /sales/from-quotations` takes at once — see `QUOTATION_BATCH_LIMIT`. */
export const BULK_CONVERT_LIMIT = 50;

/** Mirrors `BULK_CONVERTIBLE_QUOTATION_STATUSES` on the server. */
const CONVERTIBLE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED'];

type SkipReason =
    | 'NOT_FOUND'
    | 'NOT_CONVERTIBLE'
    | 'ALREADY_INVOICED'
    | 'NO_CUSTOMER'
    | 'NO_ITEMS'
    | 'NO_EXCHANGE_RATE'
    | 'BRANCH_FORBIDDEN'
    | 'TOTAL_CHANGED';

export interface ConvertibleQuote {
    id: string;
    quote_number: string;
    status: string;
    total_amount: string;
    currency?: string;
    exchange_rate?: string | null;
    customer_id?: string | null;
    customer?: { name: string } | null;
    items: unknown[];
}

interface ConversionResult {
    converted: { quotationId: string; quoteNumber: string; saleId: string; serialNumber: string; totalAmount: number }[];
    skipped: { quotationId: string; quoteNumber: string | null; reason: SkipReason; status?: string }[];
    failed: { quotationId: string; quoteNumber: string; message: string }[];
}

const isForeign = (quote: ConvertibleQuote) => !!quote.currency && quote.currency !== 'BDT';

/**
 * What the screen can already tell from the row. The server checks these
 * again, along with what only it can see — a sale already raised against the
 * quote, branch access, a total its lines no longer reach.
 */
function precheck(quote: ConvertibleQuote): SkipReason | null {
    if (!CONVERTIBLE_STATUSES.includes(quote.status)) return 'NOT_CONVERTIBLE';
    if (!quote.customer_id && !quote.customer) return 'NO_CUSTOMER';
    if (!quote.items?.length) return 'NO_ITEMS';
    if (isForeign(quote) && !Number(quote.exchange_rate)) return 'NO_EXCHANGE_RATE';
    return null;
}

interface ConvertToSalesModalProps {
    quotes: ConvertibleQuote[];
    onClose: () => void;
    /** Called once sales exist, so the list can show the quotes as converted. */
    onConverted: () => void;
}

/**
 * Confirms, then reports, "Convert to sales" for the rows selected on the
 * quotations list. Every quotation becomes a credit sale: nothing is taken, so
 * the whole total lands on the customer's account.
 *
 * The result stays on screen rather than closing into a toast. A batch is
 * allowed to be partly refused — one customer over their credit limit, one
 * product short of stock — and a person needs to see which, and why, to go
 * and deal with those one at a time.
 */
export default function ConvertToSalesModal({ quotes, onClose, onConverted }: ConvertToSalesModalProps) {
    const { t, locale } = useI18n();
    const copy = t.quotes.bulkConvert;
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ConversionResult | null>(null);

    const checked = useMemo(
        () => quotes.map((quote) => ({ quote, reason: precheck(quote) })),
        [quotes],
    );
    const eligible = checked.filter((row) => !row.reason).map((row) => row.quote);
    const preSkipped = checked.filter((row) => row.reason);
    const tooMany = quotes.length > BULK_CONVERT_LIMIT;
    // In BDT, at the rate each proforma was written at — what the sales will
    // come to unless the server finds a total that has since changed.
    const quotedTotal = eligible.reduce(
        (sum, quote) => sum + Number(quote.total_amount) * (isForeign(quote) ? Number(quote.exchange_rate) : 1),
        0,
    );

    const reasonLabel = (reason: SkipReason, status?: string) =>
        reason === 'NOT_CONVERTIBLE'
            ? formatMessage(copy.reasons.NOT_CONVERTIBLE, {
                status: t.shared.statuses.quote[status as keyof typeof t.shared.statuses.quote] ?? status ?? '',
            })
            : copy.reasons[reason];

    const close = busy ? undefined : onClose;

    const handleConvert = async () => {
        setBusy(true);
        try {
            const outcome: ConversionResult = await api.createSalesFromQuotations(quotes.map((quote) => quote.id));
            setResult(outcome);
            if (outcome.converted.length > 0) {
                toast.success(formatMessage(copy.convertedToast, { count: outcome.converted.length }));
                onConverted();
            }
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : copy.requestFailed);
        } finally {
            setBusy(false);
        }
    };

    if (result) {
        const quoteNumberOf = (row: { quotationId: string; quoteNumber: string | null }) =>
            row.quoteNumber ?? quotes.find((quote) => quote.id === row.quotationId)?.quote_number ?? row.quotationId;

        return (
            <ModalShell size="md" onBackdropClick={onClose}>
                <ModalHeader
                    title={copy.title}
                    subtitle={result.converted.length > 0
                        ? formatMessage(copy.convertedHeading, { count: result.converted.length })
                        : copy.nothingConverted}
                    onClose={onClose}
                    closeLabel={t.common.close}
                />
                <div className="space-y-4 overflow-y-auto p-4">
                    {result.converted.length > 0 && (
                        <section aria-label={formatMessage(copy.convertedHeading, { count: result.converted.length })}>
                            <h3 className="mb-1 text-xs font-semibold text-emerald-700">
                                {formatMessage(copy.convertedHeading, { count: result.converted.length })}
                            </h3>
                            <ul className="divide-y divide-gray-100 text-sm">
                                {result.converted.map((row) => (
                                    <li key={row.quotationId} className="flex items-center justify-between gap-3 py-1.5">
                                        <span className="text-gray-700">{row.quoteNumber}</span>
                                        <span className="flex items-center gap-3">
                                            <Link
                                                href={routes.sales.detail(row.saleId)}
                                                className="font-medium text-blue-600 hover:underline"
                                            >
                                                {row.serialNumber}
                                            </Link>
                                            <span className="text-gray-500">{formatBDT(row.totalAmount, { locale })}</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {result.failed.length > 0 && (
                        <section aria-label={formatMessage(copy.failedHeading, { count: result.failed.length })}>
                            <h3 className="mb-1 text-xs font-semibold text-red-700">
                                {formatMessage(copy.failedHeading, { count: result.failed.length })}
                            </h3>
                            <ul className="divide-y divide-gray-100 text-sm">
                                {result.failed.map((row) => (
                                    <li key={row.quotationId} className="py-1.5">
                                        <Link
                                            href={routes.sales.quoteDetail(row.quotationId)}
                                            className="font-medium text-blue-600 hover:underline"
                                        >
                                            {quoteNumberOf(row)}
                                        </Link>
                                        <span className="block text-xs text-gray-500">{row.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {result.skipped.length > 0 && (
                        <section aria-label={formatMessage(copy.skippedHeading, { count: result.skipped.length })}>
                            <h3 className="mb-1 text-xs font-semibold text-amber-700">
                                {formatMessage(copy.skippedHeading, { count: result.skipped.length })}
                            </h3>
                            <ul className="divide-y divide-gray-100 text-sm">
                                {result.skipped.map((row) => (
                                    <li key={row.quotationId} className="flex items-start justify-between gap-3 py-1.5">
                                        <span className="text-gray-700">{quoteNumberOf(row)}</span>
                                        <span className="text-end text-xs text-gray-500">{reasonLabel(row.reason, row.status)}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
                <ModalFooter>
                    <Button variant="primary" size="md" onClick={onClose}>
                        {t.common.close}
                    </Button>
                </ModalFooter>
            </ModalShell>
        );
    }

    return (
        <ModalShell size="md" onBackdropClick={close} dismissOnBackdrop={!busy}>
            <ModalHeader
                title={copy.title}
                subtitle={formatMessage(copy.ready, { count: eligible.length, total: quotes.length })}
                onClose={close}
                closeLabel={t.common.close}
            />
            <div className="space-y-4 overflow-y-auto p-4">
                <p className="text-sm text-gray-700">{copy.intro}</p>

                <div className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                    <span className="text-gray-500">{copy.quotedTotal}</span>
                    <span className="font-semibold text-gray-900">{formatBDT(quotedTotal, { locale })}</span>
                </div>

                {tooMany && (
                    <Alert tone="danger">{formatMessage(copy.tooMany, { max: BULK_CONVERT_LIMIT })}</Alert>
                )}

                {preSkipped.length > 0 && (
                    <section aria-label={copy.willSkip}>
                        <h3 className="mb-1 text-xs font-semibold text-amber-700">{copy.willSkip}</h3>
                        <ul className="divide-y divide-gray-100 text-sm">
                            {preSkipped.map(({ quote, reason }) => (
                                <li key={quote.id} className="flex items-start justify-between gap-3 py-1.5">
                                    <span className="text-gray-700">{quote.quote_number}</span>
                                    <span className="text-end text-xs text-gray-500">
                                        {reasonLabel(reason as SkipReason, quote.status)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button
                    variant="primary"
                    size="md"
                    icon={<ReceiptText className="h-4 w-4" />}
                    loading={busy}
                    disabled={eligible.length === 0 || tooMany}
                    onClick={() => void handleConvert()}
                >
                    {busy ? copy.working : formatMessage(copy.confirm, { count: eligible.length })}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
