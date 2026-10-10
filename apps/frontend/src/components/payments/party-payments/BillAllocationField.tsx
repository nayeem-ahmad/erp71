'use client';

import { CheckCircle2 } from 'lucide-react';
import { formatBDT } from '@/lib/format';
import { formatMessage } from '@/lib/i18n';
import { allocationTotal, type BillAllocations } from './bill-allocation';
import type { OpenBill } from './types';

export interface BillAllocationLabels {
    title: string;
    oldestFirst: string;
    billDue: string;
    allAllocated: string;
    advanceLeft: string;
    clear: string;
    exceedsAmount: string;
    noOpenBills: string;
}

interface BillAllocationFieldProps {
    bills: OpenBill[];
    allocations: BillAllocations;
    onChange: (next: BillAllocations) => void;
    /** What the payment settles — money plus any discount. */
    settles: number;
    labels: BillAllocationLabels;
    idPrefix?: string;
}

function paisa(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * The open bills a supplier payment can settle, oldest first. Each has a tick
 * and an amount; ticking fills the bill from what is still unallocated, and the
 * footer says whether everything went to bills or what stays as an advance.
 */
export function BillAllocationField({ bills, allocations, onChange, settles, labels, idPrefix = 'bill' }: BillAllocationFieldProps) {
    if (bills.length === 0) {
        return <p className="text-xs text-gray-500">{labels.noOpenBills}</p>;
    }

    const total = allocationTotal(allocations);
    const over = total - settles > 0.005;
    const left = paisa(Math.max(0, settles - total));

    const toggle = (bill: OpenBill, on: boolean) => {
        if (!on) {
            onChange({ ...allocations, [bill.id]: '' });
            return;
        }
        const others = allocationTotal({ ...allocations, [bill.id]: '' });
        const take = paisa(Math.min(bill.balance_due, Math.max(0, settles - others)));
        onChange({ ...allocations, [bill.id]: take > 0 ? String(take) : String(bill.balance_due) });
    };

    return (
        <div>
            <p className="mb-1 flex items-baseline justify-between text-xs font-medium text-gray-600">
                <span>{labels.title}</span>
                <span className="font-normal text-gray-400">{labels.oldestFirst}</span>
            </p>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-2.5">
                {bills.map((bill) => {
                    const value = allocations[bill.id] ?? '';
                    const on = Number(value) > 0;
                    const inputId = `${idPrefix}-${bill.id}`;
                    return (
                        <div key={bill.id} className="flex items-center gap-2 py-1.5">
                            <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => toggle(bill, e.target.checked)}
                                aria-label={bill.purchase_number}
                                className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
                            />
                            <label htmlFor={inputId} className="min-w-0 flex-1 text-xs">
                                <span className="font-mono font-semibold text-gray-900">{bill.purchase_number}</span>{' '}
                                <span className="text-gray-500">
                                    {formatMessage(labels.billDue, { amount: formatBDT(bill.balance_due) })}
                                </span>
                            </label>
                            <input
                                id={inputId}
                                type="number"
                                inputMode="decimal"
                                min="0"
                                max={bill.balance_due}
                                step="0.01"
                                value={value}
                                placeholder="0.00"
                                onChange={(e) => onChange({ ...allocations, [bill.id]: e.target.value })}
                                className="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-end text-xs font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 max-md:min-h-touch"
                            />
                        </div>
                    );
                })}
            </div>
            {over ? (
                <p role="alert" className="mt-1.5 text-xs text-danger">{labels.exceedsAmount}</p>
            ) : total > 0 && left <= 0.005 ? (
                <p className="mt-1.5 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    {formatMessage(labels.allAllocated, { amount: formatBDT(total) })}
                    <button type="button" onClick={() => onChange({})} className="ms-auto font-medium text-primary hover:underline">
                        {labels.clear}
                    </button>
                </p>
            ) : settles > 0 ? (
                <p className="mt-1.5 text-xs text-gray-500">
                    {formatMessage(labels.advanceLeft, { amount: formatBDT(left) })}
                </p>
            ) : null}
        </div>
    );
}
