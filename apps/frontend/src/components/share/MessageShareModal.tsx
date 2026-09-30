'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { useI18n, formatMessage } from '@/lib/i18n';

type Props = {
    subject: string;
    text: string;
    onClose: () => void;
};

export default function MessageShareModal({ subject, text, onClose }: Props) {
    const { t } = useI18n();
    const m = t.components.shareMessageModal;
    const [body, setBody] = useState(text);
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        await navigator.clipboard.writeText(body);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
                <textarea
                    aria-label={m.previewLabel}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    className="min-h-touch w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <div className="flex gap-2">
                    <button
                        onClick={() => void copy()}
                        className="inline-flex min-h-touch flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? m.copied : m.copy}
                    </button>
                    <a
                        href={`https://wa.me/?text=${encodeURIComponent(body)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-touch flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        <MessageCircle className="h-4 w-4" />
                        {m.whatsapp}
                    </a>
                </div>
            </div>
        </ModalShell>
    );
}
