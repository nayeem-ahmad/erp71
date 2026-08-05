'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';

type Props = {
    /** What is being shared, already localized, e.g. "Quotation Q-1001". */
    subject: string;
    /** Path form, e.g. "/s/aB3xK9m". Made absolute against the current origin. */
    shortPath: string;
    /**
     * Kills the link for good. Optional: not everything shareable is revocable,
     * and the button only appears when a handler is supplied. Rejecting surfaces
     * a toast and leaves the modal open with the link still shown, so the user
     * is never told a revocation happened that did not.
     */
    onRevoke?: () => Promise<void>;
    onClose: () => void;
};

/**
 * WhatsApp gets first-class placement because that is how these links are
 * actually sent in Bangladesh; copy is the fallback for everything else.
 *
 * Nothing here is quotation-specific — the subject is a prop and every string
 * comes from the catalog — so the storefront-product share can reuse it as-is.
 */
export default function ShareModal({ subject, shortPath, onRevoke, onClose }: Props) {
    const { t } = useI18n();
    const m = t.components.shareModal;

    const [copied, setCopied] = useState(false);
    const [confirmingRevoke, setConfirmingRevoke] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const url = typeof window === 'undefined' ? shortPath : `${window.location.origin}${shortPath}`;

    const copy = async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Two-step in-modal confirm rather than a native confirm() dialog: this
    // invalidates a URL the customer may already be holding, and it cannot be
    // undone — the next share mints a different code. An inline step also keeps
    // the warning readable on a phone, which is where these get sent from.
    const revoke = async () => {
        if (!onRevoke) return;
        setRevoking(true);
        try {
            await onRevoke();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.revokeError);
            setRevoking(false);
            setConfirmingRevoke(false);
            return;
        }
        toast.success(m.revokeSuccess);
        setRevoking(false);
        onClose();
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-900">
                    {formatMessage(m.title, { subject })}
                </h2>
                <button onClick={onClose} aria-label={m.close} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-3 p-4">
                <p className="text-xs text-gray-600">{m.description}</p>

                <div className="flex gap-2">
                    <input
                        readOnly
                        value={url}
                        className="min-h-touch flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900"
                    />
                    <button
                        onClick={copy}
                        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? m.copied : m.copy}
                    </button>
                </div>

                <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${subject}: ${url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <MessageCircle className="h-4 w-4" />
                    {m.whatsapp}
                </a>

                {onRevoke && (
                    <div className="border-t border-gray-100 pt-3">
                        {confirmingRevoke ? (
                            <div className="space-y-2">
                                <p className="text-xs text-gray-600">{m.revokePrompt}</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => void revoke()}
                                        disabled={revoking}
                                        className="inline-flex min-h-touch flex-1 items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                    >
                                        {m.revokeConfirm}
                                    </button>
                                    <button
                                        onClick={() => setConfirmingRevoke(false)}
                                        disabled={revoking}
                                        className="inline-flex min-h-touch flex-1 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {m.revokeCancel}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmingRevoke(true)}
                                className="min-h-touch text-sm font-semibold text-red-600 hover:text-red-700"
                            >
                                {m.revoke}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </ModalShell>
    );
}
