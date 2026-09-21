'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clock, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/**
 * Says, on every page, that this workspace has not been switched on yet.
 *
 * Deliberately not dismissible, unlike the demo and email-verification banners
 * beside it: those interrupt a working workspace, while this one explains why
 * half the product answers with a locked screen. Dismissing it would leave the
 * owner with the locks and no explanation.
 *
 * The layout decides *whether* to render this, from the `pending_activation`
 * flag already on the session; the banner then asks `/activation/status` only to
 * choose between its two wordings. That request is therefore made by the small
 * minority of workspaces that are actually waiting, not on every page load.
 */
export default function ActivationPendingBanner() {
    const { t } = useI18n();
    const copy = t.activation.banner;
    const [awaitingReview, setAwaitingReview] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getActivationStatus()
            .then((status) => {
                if (!cancelled) setAwaitingReview(status.latest_request?.status === 'PENDING');
            })
            // The "activate now" wording is the safe default: it points at a page
            // that shows the real state, so a failed probe cannot strand anyone.
            .catch(() => null);
        return () => {
            cancelled = true;
        };
    }, []);

    if (awaitingReview) {
        return (
            <div className="bg-amber-500 text-white px-4 md:px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium">{copy.awaitingReview}</span>
            </div>
        );
    }

    return (
        <div className="bg-blue-600 text-white px-4 md:px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{copy.message}</span>
            </div>
            <Link
                href={routes.billing}
                className="text-xs font-bold bg-white text-blue-700 px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0 max-md:min-h-touch inline-flex items-center"
            >
                {copy.cta}
            </Link>
        </div>
    );
}
