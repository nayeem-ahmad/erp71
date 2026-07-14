'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { RefereeRecord } from './types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

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
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={m.title} onClose={onClose} />

            <div className="space-y-4 p-6 overflow-y-auto">
                <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                    <p className="text-sm font-medium text-amber-900">
                        {hasLedger ? m.archiveMessage : m.deleteMessage}
                    </p>
                </div>
                <div className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                    <p className="font-semibold text-gray-900">{referee.name}</p>
                    <p className="text-gray-600">{referee.email}</p>
                    <p className="mt-1 font-mono text-xs font-bold tracking-wider text-gray-700">{referee.referral_code}</p>
                </div>
                {hasLedger && (
                    <p className="text-xs text-gray-500">{m.archiveHint}</p>
                )}
            </div>

            <ModalFooter>
                <button type="button" onClick={onClose} disabled={deleting} className="rounded-md px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60">
                    {m.cancel}
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={deleting}
                    className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {deleting ? m.deleting : hasLedger ? m.confirmArchive : m.confirmDelete}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}