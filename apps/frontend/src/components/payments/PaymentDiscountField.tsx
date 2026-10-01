'use client';

import { Button, Field, Input } from '@/components/ui';
import { formatBDT } from '@/lib/format';
import { formatMessage } from '@/lib/i18n';

export interface PaymentDiscountLabels {
    label: string;
    hint: string;
    fillRemainder: string;
    settles: string;
    tooLarge: string;
}

/** Rounds to the paisa so a filled-in remainder never carries float dust. */
function toPaisa(value: number): number {
    return Math.round(value * 100) / 100;
}

function parseMoney(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** What is still due once the money in `amount` lands, never below zero. */
export function remainderAfterPayment(dueBefore: number, amount: string): number {
    return Math.max(0, toPaisa(dueBefore - parseMoney(amount)));
}

/**
 * The inline error for a discount, or null. Mirrors the backend's rule: a
 * discount may settle what the payment leaves due, and nothing beyond it.
 * `dueBefore` null means the due is not known here, so only the server checks.
 */
export function paymentDiscountError(
    dueBefore: number | null,
    amount: string,
    discount: string,
    tooLargeMessage: string,
): string | null {
    const value = parseMoney(discount);
    if (value === 0 || dueBefore === null) return null;
    const remainder = remainderAfterPayment(dueBefore, amount);
    if (value - remainder > 0.005) {
        return formatMessage(tooLargeMessage, { amount: formatBDT(remainder) });
    }
    return null;
}

interface PaymentDiscountFieldProps {
    value: string;
    onChange: (value: string) => void;
    amount: string;
    /** The party's due before this payment; null when it is not known. */
    dueBefore: number | null;
    labels: PaymentDiscountLabels;
    id?: string;
}

/**
 * The optional discount settled alongside a customer receipt or a supplier
 * payment — mostly the last few taka nobody will ever collect. Shows what the
 * payment settles in total and offers to discount whatever the money leaves.
 */
export function PaymentDiscountField({ value, onChange, amount, dueBefore, labels, id = 'payment-discount' }: PaymentDiscountFieldProps) {
    const error = paymentDiscountError(dueBefore, amount, value, labels.tooLarge);
    const remainder = dueBefore === null ? 0 : remainderAfterPayment(dueBefore, amount);
    const settles = toPaisa(parseMoney(amount) + parseMoney(value));

    return (
        <div className="space-y-1">
            <Field label={labels.label} htmlFor={id} error={error ?? undefined} hint={labels.hint}>
                <div className="flex items-center gap-2">
                    <Input
                        id={id}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="0.00"
                        error={!!error}
                        className="flex-1"
                    />
                    {remainder > 0 && toPaisa(parseMoney(value)) !== remainder ? (
                        <Button type="button" variant="tinted" size="sm" onClick={() => onChange(remainder.toFixed(2))}>
                            {labels.fillRemainder}
                        </Button>
                    ) : null}
                </div>
            </Field>
            {parseMoney(value) > 0 ? (
                <p className="text-xs font-medium text-gray-600" data-testid="payment-discount-settles">
                    {formatMessage(labels.settles, { amount: formatBDT(settles) })}
                </p>
            ) : null}
        </div>
    );
}
