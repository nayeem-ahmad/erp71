'use client';

import { useCallback, useEffect, useState } from 'react';
import { Field, Input } from '@/components/ui';
import { isoToTenantLocal, tenantLocalToIso } from '@/lib/schedule-time';

/** The current minute as a `datetime-local` value, in workspace time. */
export function nowLocal(): string {
    return isoToTenantLocal(new Date().toISOString());
}

/** Whether a `datetime-local` value, read in workspace time, is still to come. */
export function isFutureLocal(value: string): boolean {
    const iso = tenantLocalToIso(value);
    return !!iso && new Date(iso).getTime() > Date.now();
}

/**
 * The serial a new payment would get, fetched while the form is open and again
 * whenever the direction — and with it the series — changes. A preview only:
 * a form whose serial is left alone is numbered by the server at save time, so
 * two people with the form open at once cannot collide.
 */
export function useNextPaymentNumber<D extends string>(
    active: boolean,
    direction: D,
    fetchNext: (direction: D) => Promise<{ payment_number?: string } | null | undefined>,
): { preview: string; refresh: () => void } {
    const [preview, setPreview] = useState('');
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        fetchNext(direction)
            .then((data) => { if (!cancelled) setPreview(data?.payment_number ?? ''); })
            .catch(() => { if (!cancelled) setPreview(''); });
        return () => { cancelled = true; };
    }, [active, direction, fetchNext, nonce]);

    const refresh = useCallback(() => setNonce((n) => n + 1), []);
    return { preview, refresh };
}

export interface PaymentSerialDateFieldsProps {
    /** Prefixes the inputs' ids: `customer-payment` → `customer-payment-serial`, `customer-payment-date`. */
    idPrefix: string;
    serial: string;
    /** Shown while the serial is blank: the number it will get, or the one it keeps. */
    serialPlaceholder?: string;
    onSerialChange: (value: string) => void;
    serialError?: string | null;
    date: string;
    onDateChange: (value: string) => void;
    dateError?: string | null;
    labels: { serial: string; date: string };
}

/**
 * The top row of a payment entry form: its serial, and beside it when the money
 * changed hands. Shared by customer and supplier payments so the two forms read
 * the same.
 */
export function PaymentSerialDateFields({
    idPrefix,
    serial,
    serialPlaceholder,
    onSerialChange,
    serialError,
    date,
    onDateChange,
    dateError,
    labels,
}: PaymentSerialDateFieldsProps) {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Field label={labels.serial} htmlFor={`${idPrefix}-serial`} error={serialError ?? undefined} className="sm:col-span-2">
                <Input
                    id={`${idPrefix}-serial`}
                    value={serial}
                    placeholder={serialPlaceholder}
                    onChange={(e) => onSerialChange(e.target.value)}
                    error={!!serialError}
                    maxLength={40}
                    autoComplete="off"
                    className="w-full font-mono"
                />
            </Field>
            <Field label={labels.date} htmlFor={`${idPrefix}-date`} error={dateError ?? undefined} className="sm:col-span-3">
                <Input
                    id={`${idPrefix}-date`}
                    type="datetime-local"
                    value={date}
                    onChange={(e) => onDateChange(e.target.value)}
                    error={!!dateError}
                    className="w-full"
                />
            </Field>
        </div>
    );
}
