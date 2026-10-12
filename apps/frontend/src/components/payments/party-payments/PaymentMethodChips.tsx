'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { formatMessage } from '@/lib/i18n';
import type { PaymentMethodOption } from './usePaymentMethods';

export interface PaymentMethodChipsLabels {
    method: string;
    moreMethods: string;
    postsTo: string;
    noAccountLinked: string;
    linkAccount: string;
}

interface PaymentMethodChipsProps {
    methods: PaymentMethodOption[];
    value: string | null;
    onChange: (id: string) => void;
    labels: PaymentMethodChipsLabels;
    /** Read-only description of a stored method that is no longer active. */
    inactiveName?: string | null;
}

function accountLabel(account: NonNullable<PaymentMethodOption['account']>): string {
    return account.code ? `${account.name} · ${account.code}` : account.name;
}

/**
 * The tender picker: chips for the methods shown on entry, the rest one tap
 * away under More. Says where the money will post before it is saved — and
 * warns, in amber, when the method has no ledger account and will fall back to
 * Cash in Hand.
 */
export function PaymentMethodChips({ methods, value, onChange, labels, inactiveName }: PaymentMethodChipsProps) {
    const [expanded, setExpanded] = useState(false);
    const labelId = useId();
    const selected = methods.find((method) => method.id === value) ?? null;

    // Shown chips, plus the selected one if it lives under More, so the choice
    // never disappears from view.
    const visible = expanded
        ? methods
        : methods.filter((method) => method.show_on_entry || method.id === value);
    const hiddenCount = methods.length - visible.length;

    return (
        <div>
            <p id={labelId} className="mb-1 text-xs font-medium text-gray-600">{labels.method}</p>
            <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
                {visible.map((method) => {
                    const on = method.id === value;
                    return (
                        <button
                            key={method.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => onChange(method.id)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors max-md:min-h-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                                on
                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            {method.name}
                        </button>
                    );
                })}
                {hiddenCount > 0 ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 max-md:min-h-touch"
                    >
                        <Plus className="h-3 w-3" aria-hidden />
                        {labels.moreMethods}
                    </button>
                ) : null}
            </div>
            {selected ? (
                selected.account ? (
                    <p className="mt-1.5 text-xs text-gray-500">
                        {formatMessage(labels.postsTo, { account: accountLabel(selected.account) })}
                    </p>
                ) : (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                            {formatMessage(labels.noAccountLinked, { method: selected.name })}{' '}
                            <Link href="/settings/payment-methods" className="font-semibold text-primary hover:underline">
                                {labels.linkAccount}
                            </Link>
                        </span>
                    </p>
                )
            ) : inactiveName ? (
                <p className="mt-1.5 text-xs text-gray-500">{inactiveName}</p>
            ) : null}
        </div>
    );
}
