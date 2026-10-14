'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { openSaleLineQty } from '@/lib/open-sale-line';
import {
    exchangeSettlementSentence,
    previewExchangeSettlement,
    roundMoney,
    type ExchangeSettlementCopy,
} from '@/lib/exchange-settlement';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import ProductSearch from '@/components/document-entry/ProductSearch';

/** The invoice's first payment, oldest first, matching the server settlement. */
function firstPaymentMethod(sale: any): string | null {
    const payments = [...(sale?.payments ?? [])].sort((left: any, right: any) => {
        const leftAt = left?.created_at ? new Date(left.created_at).getTime() : 0;
        const rightAt = right?.created_at ? new Date(right.created_at).getTime() : 0;
        return leftAt - rightAt;
    });
    return payments[0]?.payment_method ?? null;
}

interface DraftLine {
    saleItemId: string;
    productName: string;
    openQty: number;
    quantity: number;
    saleUnitPrice: number;
    replacementProductId: string;
    replacementName: string;
    replacementQuantity: number;
    unitPrice: number;
}

function linesFromSale(sale: any): DraftLine[] {
    return (sale.items ?? [])
        .map((item: any) => {
            const openQty = openSaleLineQty(item);
            const saleUnitPrice = Number(item.price_at_sale);
            return {
                saleItemId: item.id,
                productName: item.product?.name || '',
                openQty,
                quantity: openQty,
                saleUnitPrice,
                replacementProductId: '',
                replacementName: '',
                replacementQuantity: openQty,
                unitPrice: Number.isFinite(saleUnitPrice) ? saleUnitPrice : 0,
            };
        })
        .filter((line: DraftLine) => line.openQty > 0);
}

function NewExchangePageContent() {
    const { t, locale } = useI18n();
    const copy = t.exchanges;
    const router = useRouter();
    const searchParams = useSearchParams();
    const saleIdParam = searchParams.get('saleId');

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [serialNumber, setSerialNumber] = useState('');
    const [sale, setSale] = useState<any>(null);
    const [lines, setLines] = useState<DraftLine[]>([]);
    const [reason, setReason] = useState('');
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showErrors, setShowErrors] = useState(false);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    const acceptSale = useCallback((fullSale: any) => {
        if (fullSale?.status === 'DRAFT' || fullSale?.status === 'CANCELLED') {
            toast.error(copy.lookup.notExchangeable);
            return;
        }
        const next = linesFromSale(fullSale);
        if (next.length === 0) {
            toast.error(copy.lookup.nothingOpen);
            return;
        }
        setSale(fullSale);
        setLines(next);
        setSerialNumber(fullSale.serial_number ?? '');
        setShowErrors(false);
    }, [copy.lookup.notExchangeable, copy.lookup.nothingOpen]);

    useEffect(() => {
        if (!saleIdParam) return;
        let cancelled = false;
        setSearching(true);
        api.getSale(saleIdParam)
            .then((full) => {
                if (!cancelled) acceptSale(full);
            })
            .catch((error: any) => {
                if (!cancelled) toast.error(error?.message || copy.postFailed);
            })
            .finally(() => {
                if (!cancelled) setSearching(false);
            });
        return () => {
            cancelled = true;
        };
    }, [saleIdParam, acceptSale, copy.postFailed]);

    const findSale = async () => {
        const serial = serialNumber.trim();
        if (!serial) return;
        setSearching(true);
        try {
            const page = await api.getSalesList({ search: serial, limit: 20 });
            const found = (page.items ?? []).find((entry: any) => entry.serial_number === serial);
            if (!found) {
                toast.error(formatMessage(copy.lookup.notFound, { serial }, locale));
                return;
            }
            acceptSale(await api.getSale(found.id));
        } catch (error: any) {
            toast.error(error?.message || copy.postFailed);
        } finally {
            setSearching(false);
        }
    };

    const startOver = () => {
        setSale(null);
        setLines([]);
        setSerialNumber('');
        setShowErrors(false);
        if (saleIdParam) router.replace(routes.sales.exchangeNew);
    };

    const updateLine = (saleItemId: string, patch: Partial<DraftLine>) => {
        setLines((current) => current.map((line) => (
            line.saleItemId === saleItemId ? { ...line, ...patch } : line
        )));
    };

    const totals = useMemo(() => {
        let returnedTotal = 0;
        let replacementTotal = 0;
        for (const line of lines) {
            returnedTotal = roundMoney(returnedTotal + roundMoney(line.saleUnitPrice * line.quantity));
            const unit = roundMoney(line.unitPrice);
            replacementTotal = roundMoney(replacementTotal + roundMoney(unit * line.replacementQuantity));
        }
        return { returnedTotal, replacementTotal };
    }, [lines]);

    const preview = useMemo(() => {
        if (!sale) return null;
        return previewExchangeSettlement({
            returnedTotal: totals.returnedTotal,
            replacementTotal: totals.replacementTotal,
            saleTotal: Number(sale.total_amount),
            amountPaid: Number(sale.amount_paid),
            firstPaymentMethod: firstPaymentMethod(sale),
        });
    }, [sale, totals]);

    const settlementCopy: ExchangeSettlementCopy = {
        ...copy.settlement,
        tender: copy.tender,
    };
    const sentence = preview
        ? exchangeSettlementSentence(
            preview,
            settlementCopy,
            (amount) => formatBDT(amount, { locale }),
            (template, values) => formatMessage(template, values, locale),
        )
        : '';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!sale || lines.length === 0) {
            setShowErrors(true);
            return;
        }
        if (lines.some((line) => !line.replacementProductId)) {
            setShowErrors(true);
            return;
        }
        setSubmitting(true);
        try {
            const trimmed = reason.trim();
            const created = await api.createExchange({
                saleId: sale.id,
                ...(trimmed ? { reason: trimmed } : {}),
                lines: lines.map((line) => ({
                    saleItemId: line.saleItemId,
                    quantity: line.quantity,
                    replacementProductId: line.replacementProductId,
                    replacementQuantity: line.replacementQuantity,
                    unitPrice: roundMoney(line.unitPrice),
                })),
            });
            toast.success(copy.posted);
            router.push(created?.id
                ? `${routes.sales.exchangeDetail(created.id)}?print=1`
                : routes.sales.exchanges);
        } catch (error: any) {
            toast.error(error?.message || copy.postFailed);
        } finally {
            setSubmitting(false);
        }
    };

    const salePicker = (
        <div className="flex items-end gap-2">
            <div className="relative flex-1 min-w-0">
                <label htmlFor="exchange-serial" className="block text-[11px] text-gray-500 mb-0.5">
                    {copy.lookup.label}
                </label>
                <Search className="absolute start-2.5 bottom-2.5 text-gray-400 w-4 h-4" />
                <input
                    id="exchange-serial"
                    type="text"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void findSale();
                        }
                    }}
                    disabled={!!sale || searching}
                    placeholder={copy.lookup.placeholder}
                    className="w-full ps-8 pe-3 py-1.5 border rounded text-sm min-h-touch focus:ring-1 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
                />
            </div>
            {sale ? (
                <button
                    type="button"
                    onClick={startOver}
                    aria-label={t.common.remove}
                    className="px-3 py-1.5 border rounded text-sm text-gray-700 hover:bg-gray-50 min-h-touch inline-flex items-center"
                >
                    <X className="w-4 h-4" />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => void findSale()}
                    disabled={searching || !serialNumber.trim()}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400 min-h-touch"
                >
                    {searching ? copy.lookup.searching : copy.lookup.search}
                </button>
            )}
        </div>
    );

    return (
        <DocumentEntryLayout
            title={copy.newExchange}
            backHref={routes.sales.exchanges}
            backLabel={t.common.back}
            onSubmit={handleSubmit}
            metaBar={
                <DocumentMetaBar
                    docLabel={copy.columns.number}
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                >
                    <MetaField label={copy.detail.originalInvoice}>
                        <span className={`${metaFieldInputClass} bg-gray-50 text-gray-700 font-medium`}>
                            {sale?.serial_number || t.shared.dash}
                        </span>
                    </MetaField>
                </DocumentMetaBar>
            }
            picker={salePicker}
            table={
                <div className="h-full overflow-y-auto space-y-2">
                    {lines.length === 0 ? (
                        <p className="text-sm text-gray-400 p-2">
                            {showErrors ? t.shared.form.atLeastOneItemRequired : copy.subtitle}
                        </p>
                    ) : lines.map((line) => (
                        <div key={line.saleItemId} className="border rounded bg-white p-2 space-y-2">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-[11px] text-gray-500">{copy.line.comingBack}</div>
                                    <div className="text-sm font-medium text-gray-900">{line.productName || t.shared.unknown}</div>
                                    <div className="text-xs text-gray-500">
                                        {formatMessage(copy.line.open, { count: line.openQty }, locale)}
                                    </div>
                                </div>
                                <label className="flex flex-col gap-0.5">
                                    <span className="text-[11px] text-gray-500">{copy.line.quantity}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={line.openQty}
                                        step={1}
                                        inputMode="numeric"
                                        value={line.quantity}
                                        onChange={(e) => {
                                            const n = parseInt(e.target.value, 10);
                                            if (!Number.isInteger(n)) return;
                                            const quantity = Math.min(line.openQty, Math.max(1, n));
                                            updateLine(line.saleItemId, {
                                                quantity,
                                                ...(line.replacementProductId ? {} : { replacementQuantity: quantity }),
                                            });
                                        }}
                                        className="w-20 border rounded px-2 py-1 text-sm text-end min-h-touch"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setLines((current) => current.filter((row) => row.saleItemId !== line.saleItemId))}
                                    className="text-xs text-red-600 hover:underline min-h-touch"
                                >
                                    {copy.line.remove}
                                </button>
                            </div>
                            <div>
                                <div className="text-[11px] text-gray-500 mb-1">{copy.line.replacement}</div>
                                {line.replacementProductId ? (
                                    <div className="flex flex-wrap items-end gap-2">
                                        <div className="text-sm font-medium text-gray-900 min-w-[8rem]">
                                            {line.replacementName}
                                        </div>
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-gray-500">{copy.line.quantity}</span>
                                            <input
                                                type="number"
                                                min={1}
                                                step={1}
                                                inputMode="numeric"
                                                value={line.replacementQuantity}
                                                onChange={(e) => {
                                                    const n = parseInt(e.target.value, 10);
                                                    if (!Number.isInteger(n) || n < 1) return;
                                                    updateLine(line.saleItemId, { replacementQuantity: n });
                                                }}
                                                className="w-20 border rounded px-2 py-1 text-sm text-end min-h-touch"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-gray-500">{copy.line.price}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                inputMode="decimal"
                                                value={line.unitPrice}
                                                onChange={(e) => {
                                                    const n = Number(e.target.value);
                                                    if (!Number.isFinite(n) || n < 0) return;
                                                    updateLine(line.saleItemId, { unitPrice: n });
                                                }}
                                                className="w-28 border rounded px-2 py-1 text-sm text-end min-h-touch"
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => updateLine(line.saleItemId, {
                                                replacementProductId: '',
                                                replacementName: '',
                                            })}
                                            aria-label={copy.line.replacement}
                                            className="text-gray-400 hover:text-gray-700 min-h-touch px-1"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <ProductSearch
                                            placeholder={copy.line.replacement}
                                            priceLabel={copy.line.price}
                                            warnOverStock={false}
                                            initialQuantity={line.quantity}
                                            initialPriceOf={() => line.unitPrice}
                                            onProductSelect={(product, options) => {
                                                const qty = Math.max(1, Math.trunc(Number(options.quantity)) || 1);
                                                const price = Number(options.price);
                                                updateLine(line.saleItemId, {
                                                    replacementProductId: product.id,
                                                    replacementName: product.name,
                                                    replacementQuantity: qty,
                                                    unitPrice: Number.isFinite(price) && price >= 0 ? price : line.unitPrice,
                                                });
                                            }}
                                        />
                                        {showErrors && (
                                            <p className="text-xs text-red-600 mt-1">{t.common.required}</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            }
            note={
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={copy.reasonPlaceholder}
                    aria-label={copy.reason}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                />
            }
            panel={
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                        <span className="text-gray-500">{copy.totals.returned}</span>
                        <span>{formatBDT(totals.returnedTotal, { locale })}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="text-gray-500">{copy.totals.replacement}</span>
                        <span>{formatBDT(totals.replacementTotal, { locale })}</span>
                    </div>
                    <div className="flex justify-between gap-2 border-t pt-2 font-semibold">
                        <span>{copy.totals.difference}</span>
                        <span>{formatBDT(preview?.difference ?? 0, { locale })}</span>
                    </div>
                    {sentence && <p className="text-xs text-gray-600">{sentence}</p>}
                </div>
            }
            actions={
                <>
                    <Link
                        href={routes.sales.exchanges}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm min-h-touch inline-flex items-center"
                    >
                        {t.common.cancel}
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium min-h-touch"
                    >
                        {submitting ? copy.posting : copy.post}
                    </button>
                </>
            }
        />
    );
}

export default function NewExchangePage() {
    return (
        <Suspense>
            <NewExchangePageContent />
        </Suspense>
    );
}
