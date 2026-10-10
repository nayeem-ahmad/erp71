'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatBDT } from '@/lib/format';
import type { MessageDictionary } from '@/lib/localization/messages';
import { Button } from '@/components/ui';
import { ModalFooter } from '@/components/ModalShell';
import { BillAllocationField } from './BillAllocationField';
import { allocateOldestFirst, allocationTotal, allocationsToSend, type BillAllocations } from './bill-allocation';
import type { OpenBill, PartyPayment, PartyPaymentsAdapter, PartyPaymentsLabels } from './types';

interface AllocateAdvanceProps {
    adapter: PartyPaymentsAdapter;
    payment: PartyPayment;
    labels: PartyPaymentsLabels;
    ui: MessageDictionary['partyPayments'];
    common: MessageDictionary['common'];
    onDone: () => void;
    onCancel: () => void;
}

/**
 * Matches what a supplier payment left unapplied to the supplier's open bills,
 * offered oldest first like the entry form.
 */
export function AllocateAdvance({ adapter, payment, labels, ui, common, onDone, onCancel }: AllocateAdvanceProps) {
    const unapplied = Number(payment.unapplied_amount ?? 0);
    const partyId = adapter.partyOf(payment)?.id ?? '';
    const copy = labels.allocation;

    const [bills, setBills] = useState<OpenBill[] | null>(null);
    const [allocations, setAllocations] = useState<BillAllocations>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!adapter.openBills || !partyId) {
            setBills([]);
            return;
        }
        let cancelled = false;
        adapter.openBills(partyId)
            .then((rows) => {
                if (cancelled) return;
                setBills(rows);
                setAllocations(allocateOldestFirst(rows, unapplied));
            })
            .catch(() => { if (!cancelled) setBills([]); });
        return () => { cancelled = true; };
    }, [adapter, partyId, unapplied]);

    if (!copy || !adapter.allocate) return null;

    const over = allocationTotal(allocations) - unapplied > 0.005;

    const submit = async () => {
        const send = allocationsToSend(allocations);
        if (send.length === 0 || over) {
            setError(copy.exceedsAmount);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await adapter.allocate!(payment.id, send);
            onDone();
        } catch (err: unknown) {
            setError(err instanceof Error && err.message ? err.message : copy.allocateFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                    <span className="text-gray-700">{copy.unappliedAmount}</span>
                    <span className="font-bold text-amber-800 tabular-nums">{formatBDT(unapplied)}</span>
                </div>
                {bills === null ? (
                    <p className="flex items-center text-sm text-gray-500">
                        <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                        {labels.loading}
                    </p>
                ) : (
                    <BillAllocationField
                        bills={bills}
                        allocations={allocations}
                        onChange={(next) => { setAllocations(next); setError(null); }}
                        settles={unapplied}
                        idPrefix="allocate-bill"
                        labels={{
                            title: ui.billsTitle,
                            oldestFirst: ui.billsOldestFirst,
                            billDue: ui.billDue,
                            allAllocated: ui.billsAllAllocated,
                            advanceLeft: ui.billsAdvanceLeft,
                            clear: ui.billsClear,
                            exceedsAmount: copy.exceedsAmount,
                            noOpenBills: copy.noOpenBills,
                        }}
                    />
                )}
                {error && !over ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
            </div>
            <ModalFooter className="bg-gray-50/80">
                <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                    {common.cancel}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    size="md"
                    loading={saving}
                    disabled={!bills || bills.length === 0}
                    onClick={() => void submit()}
                >
                    {copy.allocateSubmit}
                </Button>
            </ModalFooter>
        </div>
    );
}
