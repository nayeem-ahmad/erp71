/**
 * How a takings breakdown groups tenders for a person to read: bKash and Nagad
 * apart from each other and from the bank, cards apart from transfers.
 *
 * Display only. Posting goes through `classifyPaymentMode`, which collapses
 * cards, transfers and every unnamed wallet into `bank` because that is where
 * the ledger puts them; a shop owner looking at today's takings wants to see
 * them apart. Neither may borrow the other's answer.
 *
 * A sale entered as the generic `Mobile Wallet` carries no record of which
 * wallet took it (see the dynamic payment methods plan), so it is reported as
 * `wallet` rather than guessed into bKash or Nagad.
 */
export type TenderKey = 'cash' | 'bkash' | 'nagad' | 'wallet' | 'card' | 'bank' | 'credit';

export const TENDER_LABELS: Record<TenderKey, string> = {
    cash: 'Cash',
    bkash: 'bKash',
    nagad: 'Nagad',
    wallet: 'Mobile wallet',
    card: 'Card',
    bank: 'Bank',
    credit: 'On account',
};

export function tenderKey(method: string): TenderKey {
    const name = method.toLowerCase();
    if (name.includes('bkash')) return 'bkash';
    if (name.includes('nagad')) return 'nagad';
    if (name.includes('wallet') || name.includes('rocket') || name.includes('upay')) return 'wallet';
    // "Credit Card" is a card. Only bare credit means the customer's account.
    if (name.includes('card')) return 'card';
    if (name.includes('credit')) return 'credit';
    if (name.includes('bank') || name.includes('transfer') || name.includes('cheque')) return 'bank';
    // The ledger's assumption for an unrecognised custom method, kept so the
    // two never disagree about what counts as cash.
    return 'cash';
}
