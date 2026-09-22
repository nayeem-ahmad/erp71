'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Monitor, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

/**
 * Which till the current user's sales are being stamped with, stated on the
 * entry screens rather than left to be discovered at reconciliation.
 *
 * Deliberately read-only. The till is not a per-sale choice: the server takes
 * it from the seller's own open shift (`resolveCashierSession` in
 * sales.service.ts), because the browser used to be the authority on it and
 * put the wrong counter on a sale whenever a shift was opened on one device
 * and sales were rung on another. A picker here would hand that back — and let
 * a cashier attribute their takings to someone else's drawer, which is the
 * accountability the close-of-shift variance depends on.
 *
 * So this shows what will happen and links to where it is changed. On the
 * back-office form, no open shift is a legitimate state (an ordinary invoice
 * belongs to no till), which is why that case is a note and not an error.
 */
/** The subset of GET /cashier-sessions/open this chip reads. */
interface OpenShift {
    id: string;
    opened_at?: string | null;
    counter?: { name?: string | null; counter_number?: number | null } | null;
}

export default function ShiftContextChip() {
    const { t } = useI18n();
    const [session, setSession] = useState<OpenShift | null>(null);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let cancelled = false;
        // A failure here must not block sales entry: the chip is informational,
        // and the server resolves the shift regardless of what this renders.
        api.getOpenCashierSession()
            .then((s) => { if (!cancelled) setSession(s ?? null); })
            .catch(() => { if (!cancelled) setSession(null); })
            .finally(() => { if (!cancelled) setChecked(true); });
        return () => { cancelled = true; };
    }, []);

    // Nothing is claimed until the answer is in — a chip that says "no shift"
    // and then corrects itself is worse than a beat of nothing.
    if (!checked) return null;

    const chip = 'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium';

    if (!session) {
        return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`${chip} border-gray-200 bg-gray-50 text-gray-600`}>
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    {t.cashierSessions.shiftChip.noShift}
                </span>
                <span className="text-xs text-gray-500">
                    {t.cashierSessions.shiftChip.noShiftHint}
                </span>
                <Link
                    href={routes.sales.cashierSessions}
                    className="text-xs font-semibold text-blue-600 underline hover:text-blue-700"
                >
                    {t.cashierSessions.shiftChip.openShift}
                </Link>
            </div>
        );
    }

    // A shift can be open without a counter: counters are optional, and a
    // tenant that runs shifts without tagging tills is a supported setup.
    const counterName = session.counter?.name ?? session.counter?.counter_number;

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`${chip} border-blue-200 bg-blue-50 text-blue-800`}>
                <Monitor className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
                {counterName
                    ? formatMessage(t.cashierSessions.shiftChip.counter, { counter: counterName })
                    : t.cashierSessions.sessionActive}
            </span>
            {session.opened_at && (
                <span className="text-xs text-gray-500">
                    {formatMessage(t.cashierSessions.shiftChip.openSince, {
                        time: formatDateTime(session.opened_at),
                    })}
                </span>
            )}
        </div>
    );
}
