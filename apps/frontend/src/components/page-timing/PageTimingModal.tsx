'use client';

import { useState } from 'react';
import Link from 'next/link';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import type { ApiCallTiming, PageView } from '@/lib/page-timing/collector';
import { formatMs, SPEED_TEXT, speedTone } from '@/lib/page-timing/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PhaseBar, { PhaseSwatch, type PhaseSegment } from './PhaseBar';
import { PHASE_COLORS, PHASE_ORDER, phaseValue } from './phases';

type Props = {
    views: PageView[];
    onClose: () => void;
};

/** The breakdown of the last page views: phases, the page's own download, and every API call. */
export default function PageTimingModal({ views, onClose }: Props) {
    const { t } = useI18n();
    const m = t.admin.pageTiming;
    const [selectedId, setSelectedId] = useState<number | null>(views[0]?.id ?? null);
    const view = views.find((candidate) => candidate.id === selectedId) ?? views[0] ?? null;

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader title={m.title} subtitle={view ? view.path : undefined} onClose={onClose} closeLabel={t.common.close} />
            <div className="space-y-4 overflow-y-auto p-4">
                {view?.phases ? <ViewBreakdown view={view} /> : <p className="text-sm text-gray-500">{m.measuring}</p>}

                {views.length > 1 ? (
                    <section className="space-y-2">
                        <h3 className="text-xs font-semibold text-gray-500">{m.recent}</h3>
                        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                            {views.map((candidate) => (
                                <li key={candidate.id}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(candidate.id)}
                                        aria-pressed={candidate.id === view?.id}
                                        className={`flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2 text-start text-xs hover:bg-gray-50 ${
                                            candidate.id === view?.id ? 'bg-blue-50' : ''
                                        }`}
                                    >
                                        <span className="min-w-0 truncate font-mono text-gray-700">{candidate.path}</span>
                                        <span className={`flex-shrink-0 font-semibold tabular-nums ${SPEED_TEXT[speedTone(candidate.phases?.totalMs)]}`}>
                                            {formatMs(candidate.phases?.totalMs)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}

                <Link
                    href={routes.admin.systemHealth}
                    onClick={onClose}
                    className="inline-flex min-h-touch items-center text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                    {m.dashboardLink}
                </Link>
            </div>
        </ModalShell>
    );
}

function ViewBreakdown({ view }: { view: PageView }) {
    const { t, fmt } = useI18n();
    const m = t.admin.pageTiming;
    const phases = view.phases!;
    const isLoad = view.navType === 'load';

    const phaseLabel = (key: (typeof PHASE_ORDER)[number]) =>
        key === 'boot' && !isLoad ? m.phases.route : m.phases[key];
    const phaseHint = (key: (typeof PHASE_ORDER)[number]) =>
        key === 'boot' && !isLoad ? m.phaseHints.route : m.phaseHints[key];

    const segments: PhaseSegment[] = PHASE_ORDER.flatMap((key) => {
        const ms = phaseValue(phases, key);
        return ms === null ? [] : [{ key, label: phaseLabel(key), ms }];
    });
    const spokenSegments = segments.map((segment) => `${segment.label} ${formatMs(segment.ms)}`).join(', ');

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={`text-2xl font-semibold tabular-nums ${SPEED_TEXT[speedTone(phases.totalMs)]}`}>
                    {formatMs(phases.totalMs)}
                </p>
                <p className="text-xs text-gray-500">{isLoad ? m.fullLoad : m.navigation}</p>
            </div>

            <PhaseBar segments={segments} label={spokenSegments} />

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {segments.map((segment) => (
                    <div key={segment.key} className="flex items-start gap-2">
                        <span className="mt-1">
                            <PhaseSwatch phase={segment.key} />
                        </span>
                        <div className="min-w-0">
                            <dt className="text-sm text-gray-800">
                                {segment.label} <span className="font-semibold tabular-nums">{formatMs(segment.ms)}</span>
                            </dt>
                            <dd className="text-xs text-gray-500">{phaseHint(segment.key)}</dd>
                        </div>
                    </div>
                ))}
            </dl>

            {view.document ? (
                <p className="text-xs text-gray-500">
                    {m.phases.document}: {m.documentParts.dns} {formatMs(view.document.dnsMs)} · {m.documentParts.connect}{' '}
                    {formatMs(view.document.connectMs)} · {m.documentParts.wait} {formatMs(view.document.waitMs)} ·{' '}
                    {m.documentParts.download} {formatMs(view.document.downloadMs)}
                </p>
            ) : null}

            <section className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-500">
                    {m.apiCalls} ({phases.apiCalls})
                </h3>
                {view.calls.length === 0 ? (
                    <p className="text-sm text-gray-500">{m.noApiCalls}</p>
                ) : (
                    <ul className="space-y-2">
                        {[...view.calls]
                            .sort((a, b) => a.startedAt - b.startedAt)
                            .map((call) => (
                                <CallRow key={call.id} call={call} view={view} fmt={fmt} />
                            ))}
                    </ul>
                )}
            </section>

            {!view.reported ? <p className="text-xs text-amber-700">{m.notReported}</p> : null}
        </div>
    );
}

function CallRow({
    call,
    view,
    fmt,
}: {
    call: ApiCallTiming;
    view: PageView;
    fmt: (template: string, values: Record<string, string | number>) => string;
}) {
    const { t } = useI18n();
    const m = t.admin.pageTiming;
    const total = Math.max(1, view.phases?.totalMs ?? 1);
    const ended = call.endedAt ?? view.endedAt ?? call.startedAt;
    const took = ended - call.startedAt;
    const sentAt = call.sentAt ?? call.startedAt;
    const tokenMs = sentAt - call.startedAt;
    const serverMs = call.server?.totalMs ?? 0;
    const networkMs = Math.max(0, ended - sentAt - serverMs);
    const offset = ((call.startedAt - view.startedAt) / total) * 100;
    const width = Math.max(0.5, (took / total) * 100);
    const failed = call.status !== null && call.status >= 400;

    const parts = [
        tokenMs >= 1 ? `${m.callParts.token} ${formatMs(tokenMs)}` : null,
        `${m.callParts.network} ${formatMs(networkMs)}`,
        call.server ? `${m.callParts.server} ${formatMs(serverMs)}` : null,
    ].filter(Boolean);

    const server = call.server;
    const serverDetail = server
        ? [
              `auth ${formatMs(server.authMs)}${server.authQueries !== undefined ? ` (${fmt(m.queries, { count: server.authQueries })})` : ''}`,
              `${m.callParts.db} ${formatMs(server.dbMs)}${server.dbQueries !== undefined ? ` (${fmt(m.queries, { count: server.dbQueries })})` : ''}`,
              `app ${formatMs(server.appMs)}`,
          ].join(' · ')
        : m.noServerSplit;

    return (
        <li className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-mono text-gray-700" title={call.path}>
                    {call.method} {call.path}
                    {failed ? <span className="ms-2 font-sans font-semibold text-red-700">{call.status}</span> : null}
                </span>
                <span className="flex-shrink-0 font-semibold tabular-nums text-gray-800">{formatMs(took)}</span>
            </div>
            <div className="relative h-2 w-full rounded bg-gray-100" aria-hidden>
                <div
                    className="absolute inset-y-0 rounded"
                    style={{
                        insetInlineStart: `${Math.min(99.5, Math.max(0, offset))}%`,
                        width: `${Math.min(100 - Math.min(99.5, Math.max(0, offset)), width)}%`,
                        backgroundColor: PHASE_COLORS.data,
                    }}
                />
            </div>
            <p className="text-xs text-gray-500">{parts.join(' · ')}</p>
            <p className="text-xs text-gray-400">{serverDetail}</p>
        </li>
    );
}
