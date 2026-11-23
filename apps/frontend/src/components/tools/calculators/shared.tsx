'use client';

import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { toast } from '@/lib/toast';

/** A number box that keeps what was typed as text, so "12." survives a keystroke. */
export function NumField({
    id,
    label,
    value,
    onChange,
    hint,
    step = 'any',
}: {
    id: string;
    label: ReactNode;
    value: string;
    onChange: (value: string) => void;
    hint?: ReactNode;
    step?: string;
}) {
    return (
        <Field label={label} hint={hint} htmlFor={id}>
            <Input id={id} type="number" inputMode="decimal" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value)} className="w-full" />
        </Field>
    );
}

export interface ResultRow {
    label: string;
    value: string;
    strong?: boolean;
    tone?: 'default' | 'positive' | 'negative' | 'muted';
}

const TONE: Record<NonNullable<ResultRow['tone']>, string> = {
    default: 'text-gray-900',
    positive: 'text-emerald-700',
    negative: 'text-red-600',
    muted: 'text-gray-500',
};

/** The answer block every calculator ends with: label on the left, figure on the right. */
export function ResultList({ rows }: { rows: ResultRow[] }) {
    return (
        <dl className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-gray-50">
            {rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className={`text-sm ${row.strong ? 'font-medium text-gray-900' : 'text-gray-600'}`}>{row.label}</dt>
                    <dd className={`text-end tabular-nums ${row.strong ? 'text-base font-semibold' : 'text-sm'} ${TONE[row.tone ?? 'default']}`}>{row.value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function CopyButton({ text, label, copied, failed }: { text: string; label: string; copied: string; failed: string }) {
    return (
        <Button
            variant="secondary"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    toast.success(copied);
                } catch {
                    toast.error(failed);
                }
            }}
            disabled={!text}
        >
            <Copy className="h-4 w-4" aria-hidden /> {label}
        </Button>
    );
}

/** A row of choices that behaves as a radio group: VAT rates, modes. */
export function Choice<T extends string | number>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: Array<{ value: NoInfer<T>; label: string }>;
    onChange: (value: NoInfer<T>) => void;
}) {
    return (
        <div>
            <p className="text-xs font-medium text-gray-600">{label}</p>
            <div role="radiogroup" aria-label={label} className="mt-1 flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <button
                        key={String(option.value)}
                        type="button"
                        role="radio"
                        aria-checked={value === option.value}
                        onClick={() => onChange(option.value)}
                        className={`min-h-touch rounded-md border px-3 text-sm md:min-h-0 md:py-1.5 ${
                            value === option.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Two columns on a wide screen: the inputs, then the answer. */
export function CalculatorLayout({ inputs, result, footer }: { inputs: ReactNode; result: ReactNode; footer?: ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">{inputs}</div>
                <div className="space-y-3">{result}</div>
            </div>
            {footer}
        </div>
    );
}
