'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Ban, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { SIMPLE_DOC_STYLES, openPrintWindow, renderHeaderHtml } from '@/lib/print';
import type { HeaderContext } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import {
    canCancelExchange,
    exchangeSettlementSentence,
    storedTenderDelta,
    type ExchangeSettlementCopy,
} from '@/lib/exchange-settlement';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { PostingBadge } from '@/components/PostingBadge';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const statusColors: Record<string, string> = {
    COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

function ExchangeDetailPageContent() {
    const { t, locale } = useI18n();
    const copy = t.exchanges;
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const exchangeId = params.id as string;
    const openedSlip = useRef(false);
    const printHeader = usePrintHeader('SALES_EXCHANGE');
    const { permissions, role } = useTenantPlanFeatures();

    const [exchange, setExchange] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showCancel, setShowCancel] = useState(false);

    const load = useCallback(async (id: string) => {
        try {
            setExchange(await api.getExchange(id));
        } catch (error) {
            console.error('Failed to load exchange', error);
            setExchange(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (exchangeId) void load(exchangeId);
    }, [exchangeId, load]);

    const settlementCopy: ExchangeSettlementCopy = {
        ...copy.settlement,
        tender: copy.tender,
    };

    const sentenceFor = (row: any) => {
        const difference = Number(row.difference);
        const dueDelta = Number(row.due_delta);
        return exchangeSettlementSentence(
            {
                difference,
                dueDelta,
                tenderDelta: storedTenderDelta(difference, dueDelta),
                settlementMode: row.settlement_mode,
            },
            settlementCopy,
            (amount) => formatBDT(amount, { locale }),
            (template, values) => formatMessage(template, values, locale),
        );
    };

    const handlePrint = async () => {
        if (!exchange) return;
        const header = await printHeader.resolve(exchange.store_id ?? exchange.store?.id);
        const sentence = sentenceFor(exchange);
        const money = (value: number) => formatBDT(value, { locale });
        const headerContext: HeaderContext = {
            docTitle: copy.title,
            docNumber: exchange.exchange_number,
            docDate: formatDate(exchange.created_at, locale),
            companyName: header.companyName,
        };
        const rows = (exchange.items ?? []).map((item: any) => {
            const returnedAmount = Number(item.returned_unit_price) * Number(item.returned_quantity);
            const replacementAmount = Number(item.replacement_unit_price) * Number(item.replacement_quantity);
            return `<tr>
                <td>${escapeHtml(item.returnedProduct?.name || t.shared.unknown)}</td>
                <td>${item.returned_quantity}</td>
                <td>${money(returnedAmount)}</td>
                <td>${escapeHtml(item.replacementProduct?.name || t.shared.unknown)}</td>
                <td>${item.replacement_quantity}</td>
                <td>${money(replacementAmount)}</td>
            </tr>`;
        }).join('');

        openPrintWindow({
            context: headerContext,
            title: exchange.exchange_number,
            paperSize: 'A4',
            headerConfig: header.headerConfig,
            headerHtml: renderHeaderHtml(header.headerConfig, headerContext, 'A4'),
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
            bodyHtml: `
                <h1>${escapeHtml(exchange.exchange_number)}</h1>
                <div class="subtitle">${escapeHtml(copy.detail.originalInvoice)}: ${escapeHtml(exchange.sale?.serial_number || t.shared.dash)}</div>
                ${exchange.sale?.customer?.name ? `<div class="subtitle">${escapeHtml(exchange.sale.customer.name)}</div>` : ''}
                <table>
                    <thead>
                        <tr>
                            <th>${escapeHtml(copy.detail.cameBack)}</th>
                            <th>${escapeHtml(copy.line.quantity)}</th>
                            <th>${escapeHtml(copy.totals.returned)}</th>
                            <th>${escapeHtml(copy.detail.wentOut)}</th>
                            <th>${escapeHtml(copy.line.quantity)}</th>
                            <th>${escapeHtml(copy.totals.replacement)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                        <tr class="total-row">
                            <td colspan="2">${escapeHtml(copy.totals.returned)}</td>
                            <td>${money(Number(exchange.returned_total))}</td>
                            <td colspan="2">${escapeHtml(copy.totals.replacement)}</td>
                            <td>${money(Number(exchange.replacement_total))}</td>
                        </tr>
                        <tr class="total-row">
                            <td colspan="5">${escapeHtml(copy.totals.difference)}</td>
                            <td>${money(Number(exchange.difference))}</td>
                        </tr>
                    </tbody>
                </table>
                <p>${escapeHtml(sentence)}</p>
                ${exchange.reason ? `<p><strong>${escapeHtml(copy.reason)}:</strong> ${escapeHtml(exchange.reason)}</p>` : ''}`,
            footerHtml: `<div class="footer">${escapeHtml(sentence)}</div>`,
        });
    };

    useEffect(() => {
        if (!exchange || searchParams.get('print') !== '1' || openedSlip.current) return;
        openedSlip.current = true;
        void handlePrint().finally(() => {
            router.replace(routes.sales.exchangeDetail(exchange.id));
        });
    }, [exchange, searchParams, router, handlePrint]);

    const handleCancel = async (note: string) => {
        await api.cancelExchange(exchange.id, note);
        setShowCancel(false);
        await load(exchange.id);
        toast.success(copy.detail.cancelled);
    };

    if (loading) {
        return (
            <PageShell>
                <p className="text-sm text-gray-400">{t.shared.loading.generic}</p>
            </PageShell>
        );
    }

    if (!exchange) {
        return (
            <PageShell>
                <p className="text-sm text-gray-400">{copy.empty}</p>
            </PageShell>
        );
    }

    const status = exchange.status ?? 'COMPLETED';
    const cancelled = status === 'CANCELLED';
    const canCancel = canCancelExchange(role, permissions, status);
    const sentence = sentenceFor(exchange);
    const statusLabel = copy.status[status as keyof typeof copy.status] ?? status;

    return (
        <PageShell>
            <PageHeader
                title={exchange.exchange_number}
                subtitle={formatDateTime(exchange.created_at, locale)}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    'sales',
                    [{ label: copy.title, href: routes.sales.exchanges }],
                    exchange.exchange_number,
                )}
                actions={
                    <>
                        <Link
                            href={routes.sales.exchangeMushak(exchange.id)}
                            className="inline-flex items-center px-3 py-2 border rounded text-sm text-blue-600 hover:bg-blue-50 min-h-touch"
                        >
                            {copy.detail.mushak}
                        </Link>
                        <Link
                            href={routes.sales.exchangeCreditNote(exchange.id)}
                            className="inline-flex items-center px-3 py-2 border rounded text-sm text-blue-600 hover:bg-blue-50 min-h-touch"
                        >
                            {copy.detail.creditNote}
                        </Link>
                        <button
                            type="button"
                            onClick={() => void handlePrint()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 min-h-touch"
                        >
                            <Printer className="w-4 h-4" />
                            {copy.detail.print}
                        </button>
                        {canCancel && (
                            <button
                                type="button"
                                onClick={() => setShowCancel(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-200 rounded text-sm text-red-600 hover:bg-red-50 min-h-touch"
                            >
                                <Ban className="w-4 h-4" />
                                {copy.detail.cancel}
                            </button>
                        )}
                    </>
                }
            />

            {cancelled && (
                <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    {copy.detail.cancelled}
                    {exchange.cancelled_at
                        ? ` — ${formatMessage(t.entryCancellation.cancelledOn, {
                            date: formatDate(exchange.cancelled_at, locale),
                        })}`
                        : ''}
                    {exchange.cancellation_note ? ` — ${exchange.cancellation_note}` : ''}
                </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={compactDensity.card}>
                    <div className="text-xs text-gray-500">{copy.detail.originalInvoice}</div>
                    {exchange.sale?.id ? (
                        <Link href={routes.sales.detail(exchange.sale.id)} className="text-sm font-medium text-blue-600 hover:underline">
                            {exchange.sale.serial_number || t.shared.dash}
                        </Link>
                    ) : (
                        <div className="text-sm text-gray-400">{t.shared.dash}</div>
                    )}
                    {exchange.sale?.customer?.name && (
                        <div className="text-xs text-gray-500 mt-1">{exchange.sale.customer.name}</div>
                    )}
                </div>
                <div className={compactDensity.card}>
                    <div className="text-xs text-gray-500">{copy.totals.returned}</div>
                    <div className="text-sm font-semibold">{formatBDT(Number(exchange.returned_total), { locale })}</div>
                </div>
                <div className={compactDensity.card}>
                    <div className="text-xs text-gray-500">{copy.totals.replacement}</div>
                    <div className="text-sm font-semibold">{formatBDT(Number(exchange.replacement_total), { locale })}</div>
                </div>
                <div className={compactDensity.card}>
                    <div className="text-xs text-gray-500">{copy.totals.difference}</div>
                    <div className="text-sm font-semibold">{formatBDT(Number(exchange.difference), { locale })}</div>
                    <span className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                        {statusLabel}
                    </span>
                </div>
            </div>

            <div className={compactDensity.card}>
                <div className="text-xs text-gray-500 mb-1">{copy.detail.settlement}</div>
                <p className="text-sm text-gray-800">{sentence}</p>
                <div className="mt-2">
                    <PostingBadge status={exchange.posting_status} voucherNumber={exchange.voucher_number} />
                </div>
            </div>

            <div className="divide-y rounded-lg border border-gray-200 bg-white">
                {(exchange.items ?? []).map((item: any) => {
                    const returnedAmount = Number(item.returned_unit_price) * Number(item.returned_quantity);
                    const replacementAmount = Number(item.replacement_unit_price) * Number(item.replacement_quantity);
                    return (
                        <div key={item.id} className="grid gap-3 p-3 md:grid-cols-2 text-sm">
                            <div>
                                <div className="text-[11px] text-gray-500">{copy.detail.cameBack}</div>
                                <div className="font-medium text-gray-900">{item.returnedProduct?.name || t.shared.unknown}</div>
                                <div className="text-xs text-gray-600">
                                    {item.returned_quantity} × {formatBDT(Number(item.returned_unit_price), { locale })}
                                    {' = '}
                                    {formatBDT(returnedAmount, { locale })}
                                </div>
                            </div>
                            <div>
                                <div className="text-[11px] text-gray-500">{copy.detail.wentOut}</div>
                                <div className="font-medium text-gray-900">{item.replacementProduct?.name || t.shared.unknown}</div>
                                <div className="text-xs text-gray-600">
                                    {item.replacement_quantity} × {formatBDT(Number(item.replacement_unit_price), { locale })}
                                    {' = '}
                                    {formatBDT(replacementAmount, { locale })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {exchange.reason && (
                <p className="text-sm text-gray-700">
                    <span className="text-gray-500">{copy.reason}: </span>
                    {exchange.reason}
                </p>
            )}

            {showCancel && (
                <CancelEntryModal
                    entryLabel={exchange.exchange_number}
                    entryAmount={formatBDT(Number(exchange.difference), { locale })}
                    onConfirm={handleCancel}
                    onClose={() => setShowCancel(false)}
                />
            )}
        </PageShell>
    );
}

export default function ExchangeDetailPage() {
    return (
        <Suspense>
            <ExchangeDetailPageContent />
        </Suspense>
    );
}
