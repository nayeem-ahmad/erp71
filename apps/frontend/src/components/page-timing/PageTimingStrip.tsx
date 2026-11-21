'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Gauge, Loader2 } from 'lucide-react';
import { pageTiming, type PageTimingSnapshot } from '@/lib/page-timing/collector';
import { formatMs, SPEED_TEXT, speedTone } from '@/lib/page-timing/format';
import { usePageTimingViewer } from '@/lib/page-timing/viewer';
import { useI18n } from '@/lib/i18n';
import PageTimingModal from './PageTimingModal';
import PhaseBar, { PhaseSwatch, type PhaseSegment } from './PhaseBar';
import { PHASE_ORDER, phaseValue } from './phases';

const EMPTY: PageTimingSnapshot = { current: null, history: [] };

/**
 * How long this page took and where the time went, in a slim strip along the
 * bottom of the content area. The app shell renders it, so every page has it
 * whatever its own layout. Only platform staff who switched page timing on in
 * the avatar menu see it; for everyone else it renders nothing.
 */
export default function PageTimingStrip() {
    const viewer = usePageTimingViewer();
    if (!viewer.visible) return null;
    return <VisibleStrip />;
}

function VisibleStrip() {
    const { t } = useI18n();
    const m = t.admin.pageTiming;
    const pathname = usePathname();
    const snapshot = useSyncExternalStore(pageTiming.subscribe, pageTiming.getSnapshot, () => EMPTY);
    const [open, setOpen] = useState(false);

    const measuring = snapshot.current !== null && snapshot.current.committedAt !== null;
    const latest = snapshot.history[0] ?? null;
    const phases = latest?.phases ?? null;
    const isLoad = latest?.navType === 'load';

    const segments: PhaseSegment[] = phases
        ? PHASE_ORDER.flatMap((key) => {
              const ms = phaseValue(phases, key);
              const label = key === 'boot' && !isLoad ? m.phases.route : m.phases[key];
              return ms === null ? [] : [{ key, label, ms }];
          })
        : [];
    const spoken = segments.map((segment) => `${segment.label} ${formatMs(segment.ms)}`).join(', ');

    return (
        <div
            role="region"
            aria-label={m.title}
            className="flex min-h-touch flex-shrink-0 items-center gap-3 border-t border-gray-200 bg-white px-3 text-xs text-gray-600 md:min-h-0 md:px-4 md:py-1.5"
        >
            <Gauge className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" aria-hidden />

            {phases && latest ? (
                <>
                    <span className={`font-semibold tabular-nums ${SPEED_TEXT[speedTone(phases.totalMs)]}`}>
                        {formatMs(phases.totalMs)}
                    </span>
                    <span className="hidden text-gray-500 sm:inline">{isLoad ? m.fullLoad : m.navigation}</span>
                    {latest.path !== pathname ? (
                        <span className="hidden min-w-0 truncate font-mono text-gray-400 md:inline" title={latest.path}>
                            {latest.path}
                        </span>
                    ) : null}
                    <div className="hidden w-32 flex-shrink-0 md:block">
                        <PhaseBar size="sm" segments={segments} label={spoken} />
                    </div>
                    <ul className="hidden min-w-0 items-center gap-3 lg:flex" aria-label={spoken}>
                        {segments.map((segment) => (
                            <li key={segment.key} className="flex items-center gap-1 whitespace-nowrap">
                                <PhaseSwatch phase={segment.key} />
                                {segment.label} <span className="tabular-nums text-gray-800">{formatMs(segment.ms)}</span>
                            </li>
                        ))}
                    </ul>
                    <span className="hidden whitespace-nowrap xl:inline">
                        {m.apiCalls} {phases.apiCalls} · {m.callParts.server}{' '}
                        <span className="tabular-nums">{formatMs(phases.serverMs)}</span> · {m.callParts.db}{' '}
                        <span className="tabular-nums">{formatMs(phases.dbMs)}</span>
                    </span>
                </>
            ) : null}

            {measuring ? (
                <span className="flex items-center gap-1 text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {m.measuring}
                </span>
            ) : null}
            {!phases && !measuring ? <span className="text-gray-400">—</span> : null}

            {snapshot.history.length > 0 ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={m.badgeLabel}
                    className="ms-auto inline-flex min-h-touch flex-shrink-0 items-center rounded-md px-2 font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 md:min-h-0 md:py-0.5"
                >
                    {m.details}
                </button>
            ) : null}

            {open ? <PageTimingModal views={snapshot.history} onClose={() => setOpen(false)} /> : null}
        </div>
    );
}
