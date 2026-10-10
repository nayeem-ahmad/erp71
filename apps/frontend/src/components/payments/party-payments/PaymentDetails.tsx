'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Copy, Link2, Pencil, Printer, Trash2 } from 'lucide-react';
import { formatBDT, formatDateTime } from '@/lib/format';
import { formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages';
import { Button, StatusBadge } from '@/components/ui';
import { ModalFooter } from '@/components/ModalShell';
import { DueFlowCard } from './DueFlowCard';
import type { PartyPayment, PartyPaymentsAdapter, PartyPaymentsLabels } from './types';

interface PaymentDetailsProps {
    adapter: PartyPaymentsAdapter;
    payment: PartyPayment;
    labels: PartyPaymentsLabels;
    ui: MessageDictionary['partyPayments'];
    common: MessageDictionary['common'];
    locale: string;
    onPrint: () => void;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /** Supplier payments with an unapplied amount. */
    onAllocate?: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
            <dt className="shrink-0 text-gray-500">{label}</dt>
            <dd className="min-w-0 text-end text-gray-900">{children}</dd>
        </div>
    );
}

/** One payment, read-only: what moved, which way, by what, and what it did to the due. */
export function PaymentDetails({
    adapter,
    payment,
    labels,
    ui,
    common,
    locale,
    onPrint,
    onEdit,
    onDuplicate,
    onDelete,
    onAllocate,
}: PaymentDetailsProps) {
    const flow = adapter.directionOf(payment);
    const isIn = flow === 'receive';
    const party = adapter.partyOf(payment);
    const amount = Number(payment.amount);
    const discount = Number(payment.discount_amount ?? 0);
    const hasBalance = payment.balance_after !== undefined && payment.balance_after !== null;
    const after = hasBalance ? Number(payment.balance_after) : null;
    // Undo this payment's effect on the due to get what it was before.
    const before = after === null
        ? null
        : flow === adapter.primary ? after + amount + discount : after - amount;
    const unapplied = Number(payment.unapplied_amount ?? 0);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="text-center">
                    <p className={`text-2xl font-bold tabular-nums ${isIn ? 'text-emerald-600' : 'text-danger'}`}>
                        {isIn ? '+' : '−'}{formatBDT(amount)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                        <StatusBadge tone={isIn ? 'success' : 'danger'}>{isIn ? labels.receive : labels.pay}</StatusBadge>
                        <StatusBadge tone="neutral">{payment.payment_method_name || ui.methodNotRecorded}</StatusBadge>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">
                        {formatDateTime(payment.created_at, locale)}
                        {payment.creator?.name ? ` · ${formatMessage(ui.recordedBy, { name: payment.creator.name })}` : ''}
                    </p>
                </div>

                {party ? (
                    <DueFlowCard
                        name={party.name}
                        detail={[party.phone, party.customer_code].filter(Boolean).join(' · ')}
                        ledgerHref={adapter.ledgerHref(party.id)}
                        before={before ?? 0}
                        after={after}
                        labels={{ before: ui.dueBefore, after: ui.dueAfter, advance: ui.advance, ledger: ui.ledger }}
                    />
                ) : null}

                <dl className="divide-y divide-gray-100">
                    {discount > 0 ? <Row label={labels.discount.label}>{formatBDT(discount)}</Row> : null}
                    {payment.accounting_voucher_number ? (
                        <Row label={labels.voucherNumber}>
                            {payment.voucher_id ? (
                                <Link href={`/accounting/vouchers/${payment.voucher_id}`} className="font-mono text-xs text-primary hover:underline">
                                    {payment.accounting_voucher_number} ↗
                                </Link>
                            ) : (
                                <span className="font-mono text-xs">{payment.accounting_voucher_number}</span>
                            )}
                        </Row>
                    ) : null}
                    {payment.discount_voucher_number ? (
                        <Row label={labels.discount.voucher}>
                            <span className="font-mono text-xs">{payment.discount_voucher_number}</span>
                        </Row>
                    ) : null}
                    {unapplied > 0.005 && labels.allocation ? (
                        <Row label={labels.allocation.unappliedAmount}>
                            <span className="font-semibold text-amber-700">{formatBDT(unapplied)}</span>
                        </Row>
                    ) : null}
                    {payment.notes ? (
                        <Row label={labels.columns.notes}>
                            <span className="whitespace-pre-line">{payment.notes}</span>
                        </Row>
                    ) : null}
                </dl>
            </div>

            <ModalFooter className="flex-col items-stretch bg-gray-50/80">
                <Button type="button" variant="primary" size="md" className="w-full justify-center" icon={<Printer className="h-4 w-4" />} onClick={onPrint}>
                    {flow === 'pay' ? labels.printVoucher : labels.printReceipt}
                </Button>
                {onAllocate && unapplied > 0.005 ? (
                    <Button type="button" variant="tinted" size="md" className="w-full justify-center" icon={<Link2 className="h-4 w-4" />} onClick={onAllocate}>
                        {ui.allocateAdvance}
                    </Button>
                ) : null}
                <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
                        {common.edit}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />} onClick={onDuplicate}>
                        {common.duplicate}
                    </Button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="ms-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-danger hover:bg-red-50 max-md:min-h-touch"
                    >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {common.delete}
                    </button>
                </div>
            </ModalFooter>
        </div>
    );
}
