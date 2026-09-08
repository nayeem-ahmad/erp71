'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/** All a quotation has to carry for its short link to be minted and titled. */
export type ShareableQuotation = {
    id: string;
    quote_number: string;
    doc_kind?: string | null;
};

export type ActiveQuotationShare = {
    /**
     * The quotation the open modal belongs to. Revoking targets this rather than
     * whichever row was clicked last, which is the difference between a working
     * revoke and a wrong one once a list can open the modal from any row.
     */
    id: string;
    /** Localized "Quotation Q-1001" / "Proforma Invoice PI-1001", for the modal title and WhatsApp text. */
    subject: string;
    /** `/s/<code>` — ShareModal makes it absolute against the current origin. */
    path: string;
};

/**
 * The short-link round trip for a quotation, in one place.
 *
 * The list's row action and the detail page's Share button mint the same link
 * against the same endpoint, so they share this instead of each keeping a copy
 * of the POST, the response unwrap, the error toast and the revoke.
 *
 * `POST /sales-quotations/:id/share` is idempotent — it reuses the quotation's
 * share token and the ShortLink row already minted against it — so pressing the
 * action a second time reopens the link that is already out there rather than
 * leaving another live URL behind.
 *
 * @param onRevoked Run after a successful revoke, for callers that need to
 *   refresh what they are showing (the detail page reloads the quotation).
 */
export function useQuotationShare(onRevoked?: () => void | Promise<void>) {
    const { t, locale } = useI18n();
    /** Quotation whose link is being minted right now, so only its button goes busy. */
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [share, setShare] = useState<ActiveQuotationShare | null>(null);

    const openShare = useCallback(
        async (quote: ShareableQuotation) => {
            setSharingId(quote.id);
            try {
                const result: any = await api.shareQuotation(quote.id);
                setShare({
                    id: quote.id,
                    subject: formatMessage(
                        quote.doc_kind === 'PROFORMA'
                            ? t.quotes.detail.shareSubjectProforma
                            : t.quotes.detail.shareSubject,
                        { number: quote.quote_number },
                        locale,
                    ),
                    // Envelope or bare body depending on the endpoint's shape; take whichever arrives.
                    path: (result?.data ?? result).path,
                });
            } catch (error: any) {
                toast.error(error?.message || t.quotes.detail.shareError);
            } finally {
                setSharingId(null);
            }
        },
        [locale, t],
    );

    /**
     * Deliberately lets the rejection through rather than catching it here:
     * ShareModal owns the confirm and failure UI, and swallowing the error would
     * let it report a revocation that never happened.
     */
    const revokeShare = useCallback(async () => {
        if (!share) return;
        await api.revokeQuotationShare(share.id);
        setShare(null);
        await onRevoked?.();
    }, [onRevoked, share]);

    const closeShare = useCallback(() => setShare(null), []);

    return { share, sharingId, openShare, revokeShare, closeShare };
}
