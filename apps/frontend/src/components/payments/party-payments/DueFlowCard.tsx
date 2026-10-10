'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatBDT } from '@/lib/format';

export interface DueFlowLabels {
    before: string;
    after: string;
    advance: string;
    ledger: string;
}

interface DueFlowCardProps {
    name: string;
    detail?: string | null;
    ledgerHref?: string;
    /** What the party owed before this payment; negative is an advance. */
    before: number;
    /** And after it; null while there is no amount to show yet. */
    after: number | null;
    labels: DueFlowLabels;
}

function DueFigure({ label, value, advanceLabel, align }: { label: string; value: number; advanceLabel: string; align: 'start' | 'end' }) {
    const advance = value < -0.005;
    return (
        <div className={align === 'end' ? 'text-end' : ''}>
            <p className="text-[11px] text-gray-500">{advance ? `${label} · ${advanceLabel}` : label}</p>
            <p className={`text-sm font-bold tabular-nums ${advance ? 'text-emerald-700' : value > 0.005 ? 'text-danger' : 'text-gray-900'}`}>
                {formatBDT(Math.abs(value))}
            </p>
        </div>
    );
}

/**
 * The party, and what this payment does to what they owe: due now → due after,
 * with a bar for how much of it is cleared. A negative balance is an advance
 * and reads as one.
 */
export function DueFlowCard({ name, detail, ledgerHref, before, after, labels }: DueFlowCardProps) {
    const cleared = after !== null && before > 0.005 && after < before
        ? Math.min(100, Math.round(((before - Math.max(after, 0)) / before) * 100))
        : null;

    return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5" data-testid="due-flow">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
                    {detail ? <p className="truncate text-xs text-gray-500">{detail}</p> : null}
                </div>
                {ledgerHref ? (
                    <Link href={ledgerHref} className="shrink-0 text-xs font-medium text-primary hover:underline">
                        {labels.ledger} ↗
                    </Link>
                ) : null}
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-gray-100 pt-2">
                <DueFigure label={labels.before} value={before} advanceLabel={labels.advance} align="start" />
                <ArrowRight className="h-4 w-4 text-gray-300 rtl:rotate-180" aria-hidden />
                {after === null ? (
                    <div className="text-end text-sm text-gray-300">—</div>
                ) : (
                    <DueFigure label={labels.after} value={after} advanceLabel={labels.advance} align="end" />
                )}
            </div>
            {cleared !== null ? (
                <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-red-50"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cleared}
                >
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${cleared}%` }} />
                </div>
            ) : null}
        </div>
    );
}
