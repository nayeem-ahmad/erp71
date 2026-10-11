'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import LeadWorkspace from '@/components/crm/LeadWorkspace';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/**
 * A lead opened from its card on the board: the whole lead page, slid in beside
 * the board rather than replacing it, so the columns, filters and scroll are
 * still there when it closes. Same drawer as the activities list's timeline.
 */
export default function LeadModal({
    leadId,
    name,
    onClose,
    onChanged,
    onConvertResult,
    onDeleted,
}: Readonly<{
    leadId: string;
    /** The card's name, shown until the lead itself loads. */
    name: string;
    onClose: () => void;
    onChanged: () => void;
    onConvertResult: (result: { customerId: string; existing: boolean }) => void;
    onDeleted: () => void;
}>) {
    const { t } = useI18n();
    const [title, setTitle] = useState(name);

    return (
        <ModalShell variant="drawer" size="2xl" onBackdropClick={onClose}>
            <ModalHeader title={title} onClose={onClose} closeLabel={t.common.close}>
                <Link
                    href={routes.crm.leadDetail(leadId)}
                    className="inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm font-semibold text-blue-600 hover:bg-gray-100"
                >
                    {t.crm.activitiesPage.openRecord}
                    <ArrowUpRight className="h-4 w-4" />
                </Link>
            </ModalHeader>
            <div className="flex-1 overflow-y-auto bg-canvas p-3 md:p-4">
                <LeadWorkspace
                    leadId={leadId}
                    onLoaded={(lead) => setTitle(lead.name)}
                    onChanged={onChanged}
                    onConvertResult={onConvertResult}
                    onDeleted={onDeleted}
                />
            </div>
        </ModalShell>
    );
}
