import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaymentMethodRow } from '@/lib/api';
import type { Payment } from '@/lib/hooks/useNewSaleCart';
import { canonicalFor, matchPaymentToMethod } from '@/components/document-entry/payment-match';
import { refundPrefill } from '@/lib/return-refund-prefill';

interface UseReturnRefundInput {
    context: 'sale_return' | 'purchase_return';
    /**
     * The source document the return is raised against (a sale or a purchase
     * id), or null before one is chosen. A different one starts over.
     */
    docKey: string | null;
    /** The return's total as the lines stand. */
    total: number;
    /** The customer's or supplier's current due; null = the document has no party. */
    partyDue: number | null;
    /** The original sale's payments. Keep the array stable between renders of one sale. */
    originalTenders?: Payment[];
}

const NO_TENDERS: Payment[] = [];

/**
 * The tenders of a return being entered, opened the way `refundPrefill`
 * describes.
 *
 * It fills once the strip has said which methods the user sees (the strip is
 * what knows, so `onLayoutReady` hands it over rather than the layout being
 * fetched twice) and keeps the fill in step with the total while the return's
 * lines are still being decided — dropping a line's quantity must not leave a
 * refund larger than the return. The moment the user edits the strip the fill
 * stops: their figures are never replaced. Choosing another document starts
 * over.
 *
 * Wire `payments` / `onPaymentChange` / `onLayoutReady` to the strip, hold the
 * submit until `ready`, and key
 * the strip by `docKey` so a new document announces its layout afresh.
 */
export function useReturnRefund({ context, docKey, total, partyDue, originalTenders = NO_TENDERS }: UseReturnRefundInput) {
    const [payments, setPayments] = useState<Payment[]>([]);
    const [layout, setLayout] = useState<{
        docKey: string | null;
        visible: PaymentMethodRow[];
        available: PaymentMethodRow[];
    } | null>(null);
    const touched = useRef(false);

    useEffect(() => {
        touched.current = false;
        setLayout(null);
        setPayments([]);
    }, [docKey]);

    // Remembers which document the answer was for, so one that lands late is
    // never read against the next.
    const onLayoutReady = useCallback(
        (visible: PaymentMethodRow[], available: PaymentMethodRow[]) => setLayout({ docKey, visible, available }),
        [docKey],
    );

    const onPaymentChange = useCallback((next: Payment[]) => {
        touched.current = true;
        setPayments(next);
    }, []);

    useEffect(() => {
        if (!docKey || !layout || layout.docKey !== docKey || touched.current) return;
        // The sale's FIRST tender stands if the branch still offers its method
        // (the server refuses one that is not), else the refund goes in the
        // user's first visible method — a later tender is never promoted. It is
        // resolved against the offered methods the way the strip does, so a
        // sale saved before methods were recorded (no id) lands on the method
        // the user sees in the strip and goes out with that method's id,
        // rather than being left for the server to classify by type.
        const original = originalTenders[0];
        const match = original ? matchPaymentToMethod(layout.available, original) : undefined;
        const usable: Payment[] = original && match
            ? [{ ...original, method: canonicalFor(match.type), label: match.name, paymentMethodId: match.id }]
            : [];
        const first = layout.visible[0];
        setPayments(
            refundPrefill({
                context,
                total,
                originalTenders: usable,
                partyDue,
                firstVisible: first ? { id: first.id, name: first.name, type: first.type } : null,
            }),
        );
    }, [context, docKey, layout, total, partyDue, originalTenders]);

    // False until the strip has answered for this document. A return submitted
    // before then would carry no refund, which reads as "all against the due".
    const ready = !!docKey && layout?.docKey === docKey;

    return { payments, onPaymentChange, onLayoutReady, ready };
}
