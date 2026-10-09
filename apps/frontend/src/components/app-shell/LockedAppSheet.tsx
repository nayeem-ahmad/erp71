'use client';

import Link from 'next/link';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import type { LockedApp } from './use-home-apps';

/** What a locked app is, and the way to get it: Billing. */
export default function LockedAppSheet({ app, onClose }: { app: LockedApp; onClose: () => void }) {
    const { t, fmt } = useI18n();
    const copy = t.components.appShell;
    const description = (copy.appDescriptions as Record<string, string>)[app.key];

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={fmt(copy.lockedSheetTitle, { app: app.label })} onClose={onClose} closeLabel={copy.close} />
            <div className="space-y-2 px-4 py-3 text-sm text-gray-600">
                {description ? <p>{description}</p> : null}
                <p>{copy.lockedSheetBody}</p>
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{copy.close}</Button>
                <Link
                    href={routes.billing}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover max-md:min-h-touch"
                >
                    {copy.seePlans}
                </Link>
            </ModalFooter>
        </ModalShell>
    );
}
