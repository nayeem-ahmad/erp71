'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';

export type RateHistoryType = 'sale' | 'purchase';

export interface RateHistoryRow {
    documentId: string;
    documentNumber: string;
    date: string;
    partyId: string | null;
    partyName: string | null;
    quantity: number;
    rate: number;
    lineTotal: number;
}

export interface RateHistoryData {
    type: RateHistoryType;
    forParty: RateHistoryRow[];
    recent: RateHistoryRow[];
    summary: { lastRate: number; avgRate: number; minRate: number; maxRate: number } | null;
}

/**
 * Answers cache-key → response for the life of the tab. A staged product is
 * often removed and re-picked while an operator settles on a rate, and the
 * answer cannot have changed in between — nothing on this screen writes a sale
 * or a purchase without navigating away.
 */
const cache = new Map<string, RateHistoryData>();

const cacheKey = (productId: string, type: RateHistoryType, partyId?: string) =>
    `${type}:${productId}:${partyId ?? ''}`;

/** Exposed for tests, which would otherwise leak answers between cases. */
export function clearRateHistoryCache() {
    cache.clear();
}

export function useRateHistory(
    productId: string | undefined,
    type: RateHistoryType | undefined,
    partyId?: string,
) {
    const key = productId && type ? cacheKey(productId, type, partyId) : null;
    const [data, setData] = useState<RateHistoryData | null>(() => (key ? cache.get(key) ?? null : null));
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!productId || !type || !key) {
            setData(null);
            return;
        }

        const cached = cache.get(key);
        if (cached) {
            setData(cached);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        setData(null);
        setLoading(true);

        api.getProductRateHistory(productId, { type, partyId }, { signal: controller.signal })
            .then((result: RateHistoryData) => {
                if (controller.signal.aborted) return;
                cache.set(key, result);
                setData(result);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                // A missing rate hint is not worth a toast — the operator can
                // still type the rate. Log it and render the empty state.
                console.error('Failed to load rate history', error);
                setData(null);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [productId, type, partyId, key]);

    return { data, loading };
}

interface RateHistoryProps {
    productId: string;
    type: RateHistoryType;
    /** The customer or supplier selected on the document, when there is one. */
    partyId?: string;
    /** Adopt a historic rate. Omitted where the price is not editable. */
    onPickRate?: (rate: number) => void;
    /**
     * Drop the "Previous … rates" line. The modal puts that in its own header,
     * and printing it twice reads as a rendering bug.
     */
    hideHeading?: boolean;
}

const LABELS = {
    sale: {
        heading: 'Previous sale rates',
        partyless: 'Walk-in',
        thisParty: 'This customer',
        others: 'Other customers',
        empty: 'No previous sales of this item.',
        docHref: (id: string) => routes.sales.detail(id),
    },
    purchase: {
        heading: 'Previous purchase rates',
        partyless: 'No supplier',
        thisParty: 'This supplier',
        others: 'Other suppliers',
        empty: 'No previous purchases of this item.',
        docHref: (id: string) => routes.purchases.purchaseDetail(id),
    },
} as const;

function RateRow({
    row,
    labels,
    onPickRate,
}: {
    row: RateHistoryRow;
    labels: (typeof LABELS)[RateHistoryType];
    onPickRate?: (rate: number) => void;
}) {
    const rate = (
        <span className="font-semibold tabular-nums">{formatBDT(row.rate)}</span>
    );

    return (
        <li className="flex items-center gap-2 py-0.5">
            <span className="flex-1 min-w-0 truncate text-gray-700">
                {row.partyName || <span className="text-gray-400">{labels.partyless}</span>}
            </span>
            {onPickRate ? (
                <button
                    type="button"
                    onClick={() => onPickRate(row.rate)}
                    className="text-blue-600 hover:underline min-h-touch sm:min-h-0"
                    title="Use this rate"
                >
                    {rate}
                </button>
            ) : (
                <span className="text-gray-700">{rate}</span>
            )}
            <span className="w-12 text-end tabular-nums text-gray-500">×{row.quantity}</span>
            <span className="hidden sm:inline w-20 text-end text-gray-400">{formatDate(row.date)}</span>
            <Link
                href={labels.docHref(row.documentId)}
                className="hidden md:inline w-24 truncate text-end text-gray-400 hover:text-blue-600"
                title={row.documentNumber}
            >
                {row.documentNumber}
            </Link>
        </li>
    );
}

/**
 * "What did this item last go out at, and to whom?" — rendered beside the rate
 * field while it is being decided, on both sale and purchase entry.
 *
 * The selected party's own rows come first because "what did I quote *this*
 * customer last time" is the question actually being asked; a merged list
 * buries it. Clicking a rate adopts it.
 */
export default function RateHistory({
    productId,
    type,
    partyId,
    onPickRate,
    hideHeading = false,
}: RateHistoryProps) {
    const { data, loading } = useRateHistory(productId, type, partyId);
    const labels = LABELS[type];

    if (loading) {
        return (
            <div className="text-[11px] text-gray-400 py-1" role="status">
                Loading previous rates…
            </div>
        );
    }

    const forParty = data?.forParty ?? [];
    const recent = data?.recent ?? [];

    if (forParty.length === 0 && recent.length === 0) {
        return <div className="text-[11px] text-gray-400 py-1">{labels.empty}</div>;
    }

    return (
        <div className="text-[11px] leading-relaxed">
            <div className="flex flex-wrap items-baseline gap-x-2 text-gray-500">
                {!hideHeading && (
                    <span className="font-semibold uppercase tracking-wide">{labels.heading}</span>
                )}
                {data?.summary && (
                    <span className="text-gray-400">
                        avg {formatBDT(data.summary.avgRate)}
                        {data.summary.minRate !== data.summary.maxRate && (
                            <> · {formatBDT(data.summary.minRate)}–{formatBDT(data.summary.maxRate)}</>
                        )}
                    </span>
                )}
            </div>

            {forParty.length > 0 && (
                <>
                    {/* Labelled by role, not by name: every row in this
                        section already shows the party's name. */}
                    <div className="mt-0.5 text-gray-400">{labels.thisParty}</div>
                    <ul>
                        {forParty.map((row) => (
                            <RateRow key={`${row.documentId}-${row.rate}`} row={row} labels={labels} onPickRate={onPickRate} />
                        ))}
                    </ul>
                </>
            )}

            {recent.length > 0 && (
                <>
                    {forParty.length > 0 && <div className="mt-1 text-gray-400">{labels.others}</div>}
                    <ul>
                        {recent.map((row) => (
                            <RateRow key={`${row.documentId}-${row.rate}`} row={row} labels={labels} onPickRate={onPickRate} />
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
