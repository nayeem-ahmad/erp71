'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';

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
 * The rate a new line should start from: this party's most recent rate if they
 * have one, otherwise the most recent from anyone. Both lists arrive newest
 * first. `null` when the product has never traded this way.
 */
export function lastRateFrom(data: RateHistoryData | null | undefined): number | null {
    const row = data?.forParty?.[0] ?? data?.recent?.[0];
    return row && Number.isFinite(Number(row.rate)) ? Number(row.rate) : null;
}

/** Fetches (or reuses) the history for one product, outside of a component. */
export function loadRateHistory(productId: string, type: RateHistoryType, partyId?: string) {
    const key = cacheKey(productId, type, partyId);
    const cached = cache.get(key);
    return cached ? Promise.resolve(cached) : fetchRateHistory(key, productId, type, partyId);
}

/**
 * Answers cache-key → response for the life of the tab. A staged product is
 * often removed and re-picked while an operator settles on a rate, and the
 * answer cannot have changed in between — nothing on this screen writes a sale
 * or a purchase without navigating away.
 */
const cache = new Map<string, RateHistoryData>();

/**
 * Requests still in the air, keyed the same way. The entry bar now shows the
 * rates inline *and* keeps the icon's panel, so two or three readers ask for
 * the same product in the same tick; without this they would each miss the
 * result cache — which is only written when a response lands — and fire their
 * own request.
 *
 * The promise is deliberately not aborted when a reader unmounts: another
 * reader is usually still waiting on it, and the answer is worth caching even
 * if nobody is.
 */
const inFlight = new Map<string, Promise<RateHistoryData>>();

const cacheKey = (productId: string, type: RateHistoryType, partyId?: string) =>
    `${type}:${productId}:${partyId ?? ''}`;

/** Exposed for tests, which would otherwise leak answers between cases. */
export function clearRateHistoryCache() {
    cache.clear();
    inFlight.clear();
}

/** One request per product+party, however many panels are reading it. */
function fetchRateHistory(
    key: string,
    productId: string,
    type: RateHistoryType,
    partyId?: string,
): Promise<RateHistoryData> {
    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = api.getProductRateHistory(productId, { type, partyId })
        .then((result: RateHistoryData) => {
            cache.set(key, result);
            return result;
        })
        .finally(() => {
            inFlight.delete(key);
        });

    inFlight.set(key, request);
    return request;
}

/**
 * "This customer only" is one preference, not one per panel. An operator who
 * ticks it on the entry bar means it for the line they open next as well, so
 * the flag lives beside the cache rather than in any one component's state.
 *
 * Deliberately not persisted: it narrows what is shown to a party that is only
 * selected on the document in front of you, so carrying it into tomorrow's
 * session would hide rows for reasons no longer on screen.
 */
let partyOnly = false;
const partyOnlyListeners = new Set<() => void>();

function subscribePartyOnly(listener: () => void) {
    partyOnlyListeners.add(listener);
    return () => partyOnlyListeners.delete(listener);
}

function setPartyOnly(next: boolean) {
    if (partyOnly === next) return;
    partyOnly = next;
    partyOnlyListeners.forEach((listener) => listener());
}

/** Exposed for tests, which would otherwise leak the flag between cases. */
export function resetRateHistoryPartyOnly() {
    setPartyOnly(false);
}

/**
 * The shared "this party only" flag. Every history surface reads it, so ticking
 * the box on one narrows them all.
 */
export function useRateHistoryPartyOnly(): [boolean, (next: boolean) => void] {
    const value = useSyncExternalStore(
        subscribePartyOnly,
        () => partyOnly,
        () => false,
    );
    return [value, setPartyOnly];
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

        // Not an AbortController: the request is shared, so one panel closing
        // must not cancel it out from under another. Drop the answer instead.
        let live = true;
        setData(null);
        setLoading(true);

        fetchRateHistory(key, productId, type, partyId)
            .then((result) => {
                if (!live) return;
                setData(result);
            })
            .catch((error: unknown) => {
                if (!live) return;
                // A missing rate hint is not worth a toast — the operator can
                // still type the rate. Log it and render the empty state.
                console.error('Failed to load rate history', error);
                setData(null);
            })
            .finally(() => {
                if (live) setLoading(false);
            });

        return () => { live = false; };
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
    /**
     * `inline` is the always-on panel under the entry bar: one flat list of the
     * most recent lines, no section headings, capped so it cannot push the line
     * items table off the screen. `sections` is the fuller popover/modal list.
     */
    variant?: 'sections' | 'inline';
}

/** How many rows the inline panel under the entry bar shows. */
const INLINE_ROW_LIMIT = 5;

/** Most recent first — the inline panel merges two sorted lists into one. */
function byDateDesc(a: RateHistoryRow, b: RateHistoryRow) {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
}

/** Where a row's document number links to. The wording lives in the catalog. */
const DOC_HREF: Record<RateHistoryType, (id: string) => string> = {
    sale: (id) => routes.sales.detail(id),
    purchase: (id) => routes.purchases.purchaseDetail(id),
};

type RateHistoryLabels = {
    heading: string;
    partyless: string;
    thisParty: string;
    others: string;
    empty: string;
    emptyForParty: string;
    partyOnly: string;
    noParty: string;
    useRate: string;
    docHref: (id: string) => string;
};

function RateRow({
    row,
    labels,
    onPickRate,
}: {
    row: RateHistoryRow;
    labels: RateHistoryLabels;
    onPickRate?: (rate: number) => void;
}) {
    const rate = (
        <span className="font-semibold tabular-nums">{formatBDT(row.rate)}</span>
    );

    return (
        <li className="flex items-center gap-2 py-0.5">
            <span className="flex-1 min-w-0 truncate text-gray-700" data-testid="rate-history-party">
                {row.partyName || <span className="text-gray-400">{labels.partyless}</span>}
            </span>
            {onPickRate ? (
                <button
                    type="button"
                    onClick={() => onPickRate(row.rate)}
                    className="text-blue-600 hover:underline min-h-touch sm:min-h-0"
                    title={labels.useRate}
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
    variant = 'sections',
}: RateHistoryProps) {
    const { data, loading } = useRateHistory(productId, type, partyId);
    const [partyOnlyChecked, setPartyOnlyChecked] = useRateHistoryPartyOnly();
    const { t, locale } = useI18n();
    const copy = t.components.documentEntry.rateHistory;
    const labels: RateHistoryLabels = { ...copy[type], useRate: copy.useRate, docHref: DOC_HREF[type] };
    const checkboxId = useId();
    const inline = variant === 'inline';

    // Narrowing is only meaningful once there is a party to narrow to.
    const canNarrow = !!partyId;
    const narrowed = canNarrow && partyOnlyChecked;

    const forParty = data?.forParty ?? [];
    const recent = data?.recent ?? [];

    const checkbox = (
        <label
            htmlFor={checkboxId}
            className={`flex items-center gap-1 ${canNarrow ? 'text-gray-500 cursor-pointer' : 'text-gray-300 cursor-not-allowed'}`}
            title={canNarrow ? undefined : labels.noParty}
        >
            <input
                id={checkboxId}
                type="checkbox"
                checked={narrowed}
                disabled={!canNarrow}
                onChange={(e) => setPartyOnlyChecked(e.target.checked)}
                className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
            />
            {labels.partyOnly}
        </label>
    );

    if (loading) {
        return (
            <div className="text-[11px] text-gray-400 py-1" role="status">
                {copy.loading}
            </div>
        );
    }

    // Nothing has ever traded — there is no list to narrow, so the checkbox
    // would be a control over an empty set.
    if (forParty.length === 0 && recent.length === 0) {
        return <div className="text-[11px] text-gray-400 py-1">{labels.empty}</div>;
    }

    /* The inline panel answers "what does this item go out at" — one flat list
       across every party, newest first, cut to the few rows that fit under the
       entry bar without pushing the line items table down. Ticking the box
       turns it into "what does *this* party pay". */
    const merged = [...forParty, ...recent].sort(byDateDesc);
    const inlineRows = (narrowed ? forParty : merged).slice(0, INLINE_ROW_LIMIT);

    const heading = (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-gray-500">
            <div className="flex flex-wrap items-baseline gap-x-2">
                {!hideHeading && (
                    <span className="font-semibold uppercase tracking-wide">{labels.heading}</span>
                )}
                {data?.summary && (
                    <span className="text-gray-400">
                        {formatMessage(copy.average, { amount: formatBDT(data.summary.avgRate) }, locale)}
                        {data.summary.minRate !== data.summary.maxRate && (
                            <> · {formatBDT(data.summary.minRate)}–{formatBDT(data.summary.maxRate)}</>
                        )}
                    </span>
                )}
            </div>
            {checkbox}
        </div>
    );

    if (inline) {
        return (
            <div className="text-[11px] leading-relaxed" data-testid="inline-rate-history">
                {heading}
                {inlineRows.length === 0 ? (
                    <div className="text-gray-400 py-1">{labels.emptyForParty}</div>
                ) : (
                    <ul>
                        {inlineRows.map((row) => (
                            <RateRow
                                key={`${row.documentId}-${row.rate}`}
                                row={row}
                                labels={labels}
                                onPickRate={onPickRate}
                            />
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    // The sectioned list keeps the selected party at the top, where "what did I
    // quote them last time" is read first; narrowing simply drops the rest.
    const others = narrowed ? [] : recent;

    return (
        <div className="text-[11px] leading-relaxed">
            {heading}

            {narrowed && forParty.length === 0 && (
                <div className="text-gray-400 py-1">{labels.emptyForParty}</div>
            )}

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

            {others.length > 0 && (
                <>
                    {forParty.length > 0 && <div className="mt-1 text-gray-400">{labels.others}</div>}
                    <ul>
                        {others.map((row) => (
                            <RateRow key={`${row.documentId}-${row.rate}`} row={row} labels={labels} onPickRate={onPickRate} />
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
