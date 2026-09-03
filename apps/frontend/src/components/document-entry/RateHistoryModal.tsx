'use client';

import ModalShell, { ModalHeader } from '@/components/ModalShell';
import RateHistory, { type RateHistoryType } from './RateHistory';

interface RateHistoryModalProps {
    productId: string;
    /** Named in the header, so the operator knows which line they opened. */
    productName?: string;
    type: RateHistoryType;
    partyId?: string;
    partyName?: string;
    /** Adopt a rate. Picking one closes the modal — the choice is made. */
    onPickRate?: (rate: number) => void;
    onClose: () => void;
}

/**
 * Previous rates for one product, opened from the history icon on the entry
 * bar or on a line.
 *
 * A modal rather than an inline panel: the history is a reference the operator
 * consults and dismisses, and inlining it pushed the line table down the screen
 * every time — the thing they were actually working in.
 */
export default function RateHistoryModal({
    productId,
    productName,
    type,
    partyId,
    partyName,
    onPickRate,
    onClose,
}: RateHistoryModalProps) {
    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader
                title={type === 'purchase' ? 'Previous purchase rates' : 'Previous sale rates'}
                // The party is the comparison basis — whose rates lead the
                // list — so the header says which one, not just the product.
                subtitle={[productName, partyName].filter(Boolean).join(' · ') || undefined}
                onClose={onClose}
            />
            <div className="overflow-y-auto p-4">
                <RateHistory
                    productId={productId}
                    type={type}
                    partyId={partyId}
                    hideHeading
                    onPickRate={
                        onPickRate
                            ? (rate) => {
                                  onPickRate(rate);
                                  onClose();
                              }
                            : undefined
                    }
                />
            </div>
        </ModalShell>
    );
}
