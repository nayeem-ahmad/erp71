'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Copy, Loader2, Printer } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages';
import { isoToTenantLocal, tenantLocalToIso } from '@/lib/schedule-time';
import { toast } from '@/lib/toast';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { ModalFooter } from '@/components/ModalShell';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import { PaymentDiscountField, paymentDiscountError } from '../PaymentDiscountField';
import { PaymentSerialDateFields, isFutureLocal, nowLocal, useNextPaymentNumber } from '../PaymentSerialDateFields';
import { BillAllocationField } from './BillAllocationField';
import { allocateOldestFirst, allocationTotal, allocationsToSend, type BillAllocations } from './bill-allocation';
import { DueFlowCard } from './DueFlowCard';
import { PaymentMethodChips } from './PaymentMethodChips';
import { defaultPaymentMethodId, type PaymentMethodOption } from './usePaymentMethods';
import type { MoneyFlow, OpenBill, PartyOption, PartyPayment, PartyPaymentsAdapter, PartyPaymentsLabels } from './types';

export type PartiesStatus = 'loading' | 'ready' | 'error';

interface PaymentEntryFormProps {
    adapter: PartyPaymentsAdapter;
    labels: PartyPaymentsLabels;
    ui: MessageDictionary['partyPayments'];
    common: MessageDictionary['common'];
    mode: 'create' | 'edit';
    /** Edit: the payment. Create: the payment being duplicated, if any. */
    payment?: PartyPayment | null;
    /** Create: the party picked before the form opened (`?customerId=`). */
    presetPartyId?: string;
    parties: PartyOption[];
    partiesStatus: PartiesStatus;
    onRetryParties: () => void;
    methods: PaymentMethodOption[];
    onSaved: (payment: PartyPayment, options: { print: boolean }) => void;
    onCancel: () => void;
    onDuplicate?: (payment: PartyPayment) => void;
}

function paisa(value: number): number {
    return Math.round(value * 100) / 100;
}

/** A form value as a non-negative number, or NaN when it is not one. */
function parseNonNegative(value: string): number {
    if (value.trim() === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

function parsedOrZero(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function partyDetail(party: { phone?: string | null; customer_code?: string | null } | null | undefined): string {
    return [party?.phone, party?.customer_code].filter(Boolean).join(' · ');
}

/**
 * Records a new payment or edits one. The same form for customers and
 * suppliers; the adapter says which direction is the usual one and so takes
 * the discount and (for suppliers) the bills.
 */
export function PaymentEntryForm({
    adapter,
    labels,
    ui,
    common,
    mode,
    payment,
    presetPartyId,
    parties,
    partiesStatus,
    onRetryParties,
    methods,
    onSaved,
    onCancel,
    onDuplicate,
}: PaymentEntryFormProps) {
    const isEdit = mode === 'edit' && !!payment;
    const idPrefix = `${adapter.kind}-payment${isEdit ? '-edit' : ''}`;
    const source = payment ?? null;

    const [direction, setDirection] = useState<MoneyFlow>(source ? adapter.directionOf(source) : adapter.primary);
    const [partyId, setPartyId] = useState(() => (source ? adapter.partyOf(source)?.id ?? '' : presetPartyId ?? ''));
    const [amount, setAmount] = useState(source ? String(source.amount) : '');
    // A duplicate does not carry the discount: it settled one particular
    // remainder, and the copy will be settling a different one.
    const [discount, setDiscount] = useState(() => {
        const stored = Number(source?.discount_amount ?? 0);
        return isEdit && stored > 0 ? String(stored) : '';
    });
    const [notes, setNotes] = useState(source?.notes ?? '');
    // Empty means "now" on a new payment and "unchanged" on an edit: only a
    // time the operator picked goes over the wire.
    const [date, setDate] = useState('');
    // null until typed: a new payment shows the next number and the server
    // allocates it at save time; an edit keeps its own.
    const [serial, setSerial] = useState<string | null>(null);
    const [serialError, setSerialError] = useState<string | null>(null);
    const [serialOpen, setSerialOpen] = useState(false);
    const [methodId, setMethodId] = useState<string | null>(() => {
        if (isEdit) return source?.payment_method_id ?? null;
        const copied = source?.payment_method_id;
        if (copied && methods.some((m) => m.id === copied)) return copied;
        return defaultPaymentMethodId(methods);
    });
    const methodTouched = useRef(false);
    const [partyError, setPartyError] = useState<string | null>(null);
    const [amountError, setAmountError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [bills, setBills] = useState<OpenBill[]>([]);
    const [allocations, setAllocations] = useState<BillAllocations>({});
    const [allocationsTouched, setAllocationsTouched] = useState(false);

    // Methods arrive after the form on a cold page; pick the default then.
    useEffect(() => {
        if (isEdit || methodTouched.current || methodId) return;
        const fallback = defaultPaymentMethodId(methods);
        if (fallback) setMethodId(fallback);
    }, [isEdit, methodId, methods]);

    const { preview: serialPreview, refresh: refreshSerialPreview } = useNextPaymentNumber(
        !isEdit,
        direction,
        adapter.nextNumber,
    );

    const isPrimary = direction === adapter.primary;
    const discountApplies = isPrimary;
    const billsApply = !isEdit && isPrimary && !!adapter.openBills;

    const party = parties.find((p) => p.id === partyId) ?? null;
    const partyFromPayment = source ? adapter.partyOf(source) : null;

    // What the party owed before this payment. On an edit that is today's due
    // with this payment taken back out.
    const dueBefore = useMemo<number | null>(() => {
        if (!party) return null;
        const today = Number(party.due_balance ?? 0);
        if (!isEdit || !source) return today;
        const settled = Number(source.amount) + Number(source.discount_amount ?? 0);
        return adapter.directionOf(source) === adapter.primary ? today + settled : today - Number(source.amount);
    }, [party, isEdit, source, adapter]);

    const settles = paisa(parsedOrZero(amount) + (discountApplies ? parsedOrZero(discount) : 0));
    const dueAfter = dueBefore === null || (amount.trim() === '' && discount.trim() === '')
        ? null
        : paisa(isPrimary ? dueBefore - settles : dueBefore + parsedOrZero(amount));

    const discountError = discountApplies
        ? paymentDiscountError(dueBefore, amount, discount, labels.discount.tooLarge)
        : null;
    const dateError = isFutureLocal(date) ? labels.dateInFuture : null;
    const allocationError = billsApply && allocationTotal(allocations) - settles > 0.005
        ? labels.allocation?.exceedsAmount ?? null
        : null;

    // The supplier's open bills, refetched whenever the party changes.
    useEffect(() => {
        if (!billsApply || !partyId || !adapter.openBills) {
            setBills([]);
            return;
        }
        let cancelled = false;
        adapter.openBills(partyId)
            .then((rows) => { if (!cancelled) setBills(rows); })
            .catch(() => { if (!cancelled) setBills([]); });
        setAllocationsTouched(false);
        return () => { cancelled = true; };
    }, [adapter, billsApply, partyId]);

    // Oldest first, following the amount, until the operator takes over.
    useEffect(() => {
        if (!allocationsTouched) setAllocations(allocateOldestFirst(bills, settles));
    }, [bills, settles, allocationsTouched]);

    const showSerialFields = serialOpen || !!serialError || !!dateError;
    const shownSerial = serial ?? (isEdit ? source?.payment_number ?? '' : serialPreview);
    const shownDate = date
        ? formatDateTime(tenantLocalToIso(date))
        : isEdit && source ? formatDateTime(source.created_at) : ui.now;

    const partiesUsable = isEdit || (partiesStatus === 'ready' && parties.length > 0);

    const dueFlowLabels = {
        before: isEdit ? ui.dueBefore : ui.dueNow,
        after: ui.dueAfter,
        advance: ui.advance,
        ledger: ui.ledger,
    };

    const submit = async (print: boolean) => {
        setPartyError(null);
        setAmountError(null);
        if (!isEdit && !partyId) {
            setPartyError(labels.requiredFields);
            return;
        }
        if (amount.trim() === '') {
            setAmountError(labels.requiredFields);
            return;
        }
        const amt = parseNonNegative(amount);
        const disc = discountApplies ? parseNonNegative(discount) : 0;
        if (Number.isNaN(amt) || Number.isNaN(disc)) {
            setAmountError(labels.invalidAmount);
            return;
        }
        if (amt + disc <= 0 || (!discountApplies && amt <= 0)) {
            setAmountError(discountApplies ? labels.discount.amountOrDiscount : labels.invalidAmount);
            return;
        }
        if (discountError || dateError || allocationError) return;

        setSaving(true);
        try {
            let saved: PartyPayment;
            if (isEdit && source) {
                saved = await adapter.update(source.id, {
                    amount: amt,
                    discount: disc,
                    direction,
                    notes: notes.trim() || undefined,
                    date: tenantLocalToIso(date) ?? undefined,
                    paymentNumber: serial?.trim() || undefined,
                    paymentMethodId: methodId && methodId !== source.payment_method_id ? methodId : undefined,
                });
            } else {
                const sendAllocations = billsApply ? allocationsToSend(allocations) : [];
                saved = await adapter.record(partyId, {
                    amount: amt,
                    discount: disc > 0 ? disc : undefined,
                    direction,
                    notes: notes.trim() || undefined,
                    date: tenantLocalToIso(date) ?? undefined,
                    paymentNumber: serial?.trim() || undefined,
                    paymentMethodId: methodId ?? undefined,
                    allocations: sendAllocations.length > 0 ? sendAllocations : undefined,
                });
            }
            onSaved(saved, { print });
        } catch (error: unknown) {
            const typed = isEdit ? serial?.trim() ?? '' : serial?.trim() || serialPreview;
            // A serial past the series' next number would skip every number
            // between; the server refuses it, and it belongs under the field
            // like a taken one.
            if (error instanceof ApiError && error.code === 'SERIAL_AHEAD_OF_SERIES') {
                setSerialError(formatMessage(labels.serialAhead, { serial: typed }));
                return;
            }
            if (error instanceof ApiError && error.status === 409) {
                setSerialError(formatMessage(labels.serialTaken, { serial: typed }));
                if (!isEdit) refreshSerialPreview();
                return;
            }
            toast.error(error instanceof Error && error.message ? error.message : labels.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        void submit(!isEdit);
    };

    const directionOptions: MoneyFlow[] = adapter.primary === 'receive' ? ['receive', 'pay'] : ['pay', 'receive'];

    return (
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div role="radiogroup" aria-label={labels.direction} className="flex rounded-md border border-gray-200 bg-white p-0.5">
                    {directionOptions.map((flow) => {
                        const on = direction === flow;
                        const Icon = flow === 'receive' ? ArrowDownLeft : ArrowUpRight;
                        return (
                            <button
                                key={flow}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setDirection(flow)}
                                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                                    on ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon className="h-3.5 w-3.5" aria-hidden />
                                {flow === 'receive' ? labels.receive : labels.pay}
                            </button>
                        );
                    })}
                </div>

                {showSerialFields ? (
                    <PaymentSerialDateFields
                        idPrefix={idPrefix}
                        serial={serial ?? (isEdit ? source?.payment_number ?? '' : serialPreview)}
                        serialPlaceholder={isEdit ? source?.payment_number ?? undefined : serialPreview}
                        onSerialChange={(value) => { setSerial(value); setSerialError(null); }}
                        serialError={serialError}
                        date={date || (isEdit && source ? isoToTenantLocal(source.created_at) : nowLocal())}
                        onDateChange={setDate}
                        dateError={dateError}
                        labels={{ serial: labels.columns.serial, date: labels.paymentDate }}
                    />
                ) : (
                    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500">
                        <span className="font-mono font-semibold text-gray-900">{shownSerial || '—'}</span>
                        <span aria-hidden>·</span>
                        <span>{shownDate}</span>
                        <button
                            type="button"
                            onClick={() => setSerialOpen(true)}
                            className="ms-auto font-medium text-primary hover:underline"
                        >
                            {ui.change}
                        </button>
                    </div>
                )}

                {!isEdit && source?.payment_number ? (
                    <Alert tone="info">{formatMessage(labels.duplicateNotice, { paymentNumber: source.payment_number })}</Alert>
                ) : null}

                {!isEdit && partiesStatus === 'loading' ? (
                    <p className="flex items-center text-sm text-gray-500">
                        <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                        {labels.loadingParties}
                    </p>
                ) : !isEdit && partiesStatus === 'error' ? (
                    <Alert tone="danger">
                        <span>{labels.partiesLoadFailed}</span>
                        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onRetryParties}>
                            {labels.retry}
                        </Button>
                    </Alert>
                ) : !partiesUsable ? (
                    <Alert tone="warning">{labels.noParties}</Alert>
                ) : (
                    <>
                        {isEdit ? (
                            <DueFlowCard
                                name={partyFromPayment?.name ?? '—'}
                                detail={partyDetail(partyFromPayment)}
                                ledgerHref={partyFromPayment ? adapter.ledgerHref(partyFromPayment.id) : undefined}
                                before={dueBefore ?? 0}
                                after={dueBefore === null ? null : dueAfter}
                                labels={dueFlowLabels}
                            />
                        ) : (
                            <div>
                                <IdSearchSelect
                                    id={`${idPrefix}-party`}
                                    items={parties}
                                    value={partyId}
                                    onChange={(id) => { setPartyId(id); setPartyError(null); }}
                                    label={labels.party}
                                    placeholder={labels.pickParty}
                                    emptyLabel={labels.noParties}
                                    noMatchLabel={labels.noParties}
                                    summary={(picked) => (
                                        <DueFlowCard
                                            name={picked.name}
                                            detail={partyDetail(picked)}
                                            ledgerHref={adapter.ledgerHref(picked.id)}
                                            before={Number(picked.due_balance ?? 0)}
                                            after={dueAfter}
                                            labels={dueFlowLabels}
                                        />
                                    )}
                                />
                                {partyError ? <p role="alert" className="mt-1 text-xs text-danger">{partyError}</p> : null}
                            </div>
                        )}

                        <div>
                            <Field label={labels.amount} htmlFor={`${idPrefix}-amount`} error={amountError ?? undefined}>
                                <Input
                                    id={`${idPrefix}-amount`}
                                    type="number"
                                    inputMode="decimal"
                                    min={discountApplies ? '0' : '0.01'}
                                    step="0.01"
                                    value={amount}
                                    onChange={(e) => { setAmount(e.target.value); setAmountError(null); }}
                                    placeholder={labels.amountPlaceholder}
                                    error={!!amountError}
                                    className="w-full text-lg font-bold tabular-nums"
                                />
                            </Field>
                            {isPrimary && dueBefore !== null && dueBefore > 0.005 && paisa(parsedOrZero(amount)) !== paisa(dueBefore) ? (
                                <button
                                    type="button"
                                    onClick={() => { setAmount(String(paisa(dueBefore))); setAmountError(null); }}
                                    className="mt-1 text-xs font-medium text-primary hover:underline"
                                >
                                    {formatMessage(ui.fullDue, { amount: formatBDT(dueBefore) })}
                                </button>
                            ) : null}
                        </div>

                        {methods.length > 0 ? (
                            <PaymentMethodChips
                                methods={methods}
                                value={methodId}
                                onChange={(id) => { methodTouched.current = true; setMethodId(id); }}
                                labels={ui}
                                inactiveName={isEdit && methodId && !methods.some((m) => m.id === methodId) ? source?.payment_method_name : null}
                            />
                        ) : null}

                        {discountApplies ? (
                            <PaymentDiscountField
                                id={`${idPrefix}-discount`}
                                value={discount}
                                onChange={setDiscount}
                                amount={amount}
                                dueBefore={dueBefore}
                                labels={labels.discount}
                            />
                        ) : null}

                        {billsApply && partyId && labels.allocation ? (
                            <div>
                                <BillAllocationField
                                    bills={bills}
                                    allocations={allocations}
                                    onChange={(next) => { setAllocationsTouched(true); setAllocations(next); }}
                                    settles={settles}
                                    idPrefix={`${idPrefix}-bill`}
                                    labels={{
                                        title: ui.billsTitle,
                                        oldestFirst: ui.billsOldestFirst,
                                        billDue: ui.billDue,
                                        allAllocated: ui.billsAllAllocated,
                                        advanceLeft: ui.billsAdvanceLeft,
                                        clear: ui.billsClear,
                                        exceedsAmount: labels.allocation.exceedsAmount,
                                        noOpenBills: labels.allocation.noOpenBills,
                                    }}
                                />
                            </div>
                        ) : null}

                        <Field label={labels.notes} htmlFor={`${idPrefix}-notes`}>
                            <Textarea
                                id={`${idPrefix}-notes`}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                placeholder={labels.notesPlaceholder}
                                className="w-full"
                            />
                        </Field>
                    </>
                )}
            </div>

            <ModalFooter className="bg-gray-50/80">
                {isEdit && source ? (
                    <>
                        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                            {common.cancel}
                        </Button>
                        {onDuplicate ? (
                            <Button type="button" variant="secondary" size="md" icon={<Copy className="h-4 w-4" />} onClick={() => onDuplicate(source)}>
                                {common.duplicate}
                            </Button>
                        ) : null}
                        <Button type="submit" variant="primary" size="md" loading={saving}>
                            {common.saveChanges}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            className="flex-1 justify-center"
                            disabled={!partiesUsable || saving}
                            onClick={() => void submit(false)}
                        >
                            {ui.save}
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            size="md"
                            className="flex-1 justify-center"
                            disabled={!partiesUsable}
                            loading={saving}
                            icon={<Printer className="h-4 w-4" />}
                        >
                            {ui.saveAndPrint}
                        </Button>
                    </>
                )}
            </ModalFooter>
        </form>
    );
}
