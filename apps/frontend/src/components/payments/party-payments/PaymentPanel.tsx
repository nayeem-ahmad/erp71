'use client';

import type { ReactNode } from 'react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';

interface PaymentPanelProps {
    /** Beside the list on a wide screen; otherwise a drawer (a bottom sheet on a phone). */
    docked: boolean;
    title: ReactNode;
    subtitle?: ReactNode;
    onClose: () => void;
    closeLabel: string;
    children: ReactNode;
}

/**
 * Where entering, reading and editing a payment happen. Docked, it sits beside
 * the table and stays open between payments so a run of them can be keyed in
 * without reopening anything; below 1280px there is no room for that and it
 * becomes the usual drawer.
 */
export function PaymentPanel({ docked, title, subtitle, onClose, closeLabel, children }: PaymentPanelProps) {
    const header = <ModalHeader title={title} subtitle={subtitle} onClose={onClose} closeLabel={closeLabel} />;

    if (docked) {
        return (
            <aside
                aria-label={typeof title === 'string' ? title : undefined}
                className="sticky top-0 flex max-h-[calc(100dvh-7rem)] w-96 shrink-0 flex-col self-start overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
            >
                {header}
                {children}
            </aside>
        );
    }

    return (
        <ModalShell variant="drawer" size="md" onBackdropClick={onClose}>
            {header}
            {children}
        </ModalShell>
    );
}
