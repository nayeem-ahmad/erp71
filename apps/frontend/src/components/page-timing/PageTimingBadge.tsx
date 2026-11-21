'use client';

import { useState, useSyncExternalStore } from 'react';
import { Gauge } from 'lucide-react';
import { pageTiming, type PageTimingSnapshot } from '@/lib/page-timing/collector';
import { formatMs, SPEED_TEXT, speedTone } from '@/lib/page-timing/format';
import { usePageTimingViewer } from '@/lib/page-timing/viewer';
import { useI18n } from '@/lib/i18n';
import PageTimingModal from './PageTimingModal';

const EMPTY: PageTimingSnapshot = { current: null, history: [] };

/**
 * How long this page took, beside its title, for platform staff who switched
 * page timing on in the avatar menu. Opens the full breakdown.
 */
export default function PageTimingBadge() {
    const viewer = usePageTimingViewer();
    if (!viewer.visible) return null;
    return <VisibleBadge />;
}

function VisibleBadge() {
    const { t } = useI18n();
    const m = t.admin.pageTiming;
    const snapshot = useSyncExternalStore(pageTiming.subscribe, pageTiming.getSnapshot, () => EMPTY);
    const [open, setOpen] = useState(false);

    const measuring = snapshot.current !== null && snapshot.current.committedAt !== null;
    const latest = snapshot.history[0] ?? null;
    const total = latest?.phases?.totalMs ?? null;
    if (!measuring && !latest) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={m.badgeLabel}
                title={m.badgeLabel}
                className="inline-flex min-h-touch items-center gap-1 rounded-md px-1.5 text-xs text-gray-500 hover:bg-gray-100 md:min-h-0 md:py-0.5"
            >
                <Gauge className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                {measuring ? (
                    <span>{m.measuring}</span>
                ) : (
                    <span className={`font-semibold tabular-nums ${SPEED_TEXT[speedTone(total)]}`}>{formatMs(total)}</span>
                )}
            </button>
            {open ? <PageTimingModal views={snapshot.history} onClose={() => setOpen(false)} /> : null}
        </>
    );
}
