'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import CrmActivityPanel from './CrmActivityPanel';
import { useI18n } from '@/lib/i18n';

type Props = {
    /** Exactly one of the two, matching the CrmActivityPanel contract. */
    leadId?: string;
    customerId?: string;
    /** The lead or customer the timeline belongs to — the drawer's title. */
    name: string;
    phone?: string | null;
    /** That record's page, for when the timeline is not the whole answer. */
    href?: string | null;
    onClose: () => void;
    /** Forwarded to the panel: a write in here moves a row in the list behind. */
    onChanged?: () => void;
};

/**
 * One lead's — or customer's — whole activity timeline, slid in beside the
 * tenant-wide activities list rather than replacing it.
 *
 * The list's rows are single activities, and the question a row raises is
 * almost always about the record it belongs to: what else is planned for this
 * lead, what was said last time, is this the third chase or the first. Opening
 * the lead page answered that and lost the list — the filters, the scroll
 * position, and the next fifteen rows to work through. This keeps them, and
 * because it is `CrmActivityPanel` rather than a read-only copy of it, the
 * complete / edit / cancel actions are the same ones the lead page offers.
 */
export default function CrmActivityDrawer({
    leadId,
    customerId,
    name,
    phone,
    href,
    onClose,
    onChanged,
}: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.crm.activitiesPage;

    return (
        <ModalShell variant="drawer" size="lg" onBackdropClick={onClose}>
            <ModalHeader title={name} subtitle={t.crm.activities.title} onClose={onClose} closeLabel={t.common.close}>
                {href && (
                    <Link
                        href={href}
                        className="inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm font-semibold text-blue-600 hover:bg-gray-100"
                    >
                        {m.openRecord}
                        <ArrowUpRight className="h-4 w-4" />
                    </Link>
                )}
            </ModalHeader>
            <div className="flex-1 overflow-y-auto p-4">
                <CrmActivityPanel
                    leadId={leadId}
                    customerId={customerId}
                    targetLabel={{ name, phone }}
                    onChanged={onChanged}
                />
            </div>
        </ModalShell>
    );
}
