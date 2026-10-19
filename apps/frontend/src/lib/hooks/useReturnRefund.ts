import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaymentMethodRow } from '@/lib/api';
import type { Payment } from '@/lib/hooks/useNewSaleCart';
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
        // The sale's own way of paying only stands if the branch still takes it
        // (the server refuses a method not offered there); a tender with no
        // method id is matched by name there and left alone here.
        const offered = new Set(layout.available.map((m) => m.id));
        const usable = originalTenders.filter((t) => !t.paymentMethodId || offered.has(t.paymentMethodId));
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
