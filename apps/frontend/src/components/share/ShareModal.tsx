'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

type Props = {
    title: string;
    /** Path form, e.g. "/s/aB3xK9m". Made absolute against the current origin. */
    shortPath: string;
    onClose: () => void;
};

/**
 * WhatsApp gets first-class placement because that is how these links are
 * actually sent in Bangladesh; copy is the fallback for everything else.
 */
export default function ShareModal({ title, shortPath, onClose }: Props) {
    const [copied, setCopied] = useState(false);
    const url = typeof window === 'undefined' ? shortPath : `${window.location.origin}${shortPath}`;

    const copy = async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-900">Share {title}</h2>
                <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-3 p-4">
                <p className="text-xs text-gray-600">
                    Anyone with this link can view the quotation. No login required.
                </p>

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
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>

                <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${title}: ${url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <MessageCircle className="h-4 w-4" />
                    Share on WhatsApp
                </a>
            </div>
        </ModalShell>
    );
}
