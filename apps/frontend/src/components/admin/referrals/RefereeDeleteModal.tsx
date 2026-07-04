'use client';

import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { RefereeRecord } from './types';

type Props = {
    open: boolean;
    referee: RefereeRecord | null;
    hasLedger: boolean;
    deleting: boolean;
    onClose: () => void;
    onConfirm: () => void;
};

export default function RefereeDeleteModal({ open, referee, hasLedger, deleting, onClose, onConfirm }: Props) {
    const { t } = useI18n();
    const m = t.admin.referrals.delete;

    if (!open || !referee) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-black text-gray-900">{m.title}</h2>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="space-y-4 p-6">
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                        <p className="text-sm font-medium text-amber-900">
                            {hasLedger ? m.archiveMessage : m.deleteMessage}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                        <p className="font-semibold text-gray-900">{referee.name}</p>
                        <p className="text-gray-600">{referee.email}</p>
                        <p className="mt-1 font-mono text-xs font-bold tracking-wider text-gray-700">{referee.referral_code}</p>
                    </div>
                    {hasLedger && (
                        <p className="text-xs text-gray-500">{m.archiveHint}</p>
                    )}
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                    <button type="button" onClick={onClose} disabled={deleting} className="rounded-2xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60">
                        {m.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {deleting ? m.deleting : hasLedger ? m.confirmArchive : m.confirmDelete}
                    </button>
                </div>
            </div>
        </div>
    );
}