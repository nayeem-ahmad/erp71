'use client';

import type { FunnelStage } from './funnel-model';
import { CHART_BLUE } from './chart-theme';

export type FunnelLabels = {
    clicks: string;
    signups: string;
    earned: string;
    paid: string;
    /** Contains a `{pct}` placeholder. */
    dropOff: string;
    empty: string;
};

/**
 * Four descending stages, magnitude by bar length. One hue on purpose: the stages
 * are an ordered sequence, not distinct identities, so this is a sequential job
 * and categorical colour would imply a difference in kind that is not there.
 *
 * Built with divs rather than SVG — the bars are horizontal and text-labelled, so
 * HTML gives correct text wrapping and screen-reader order for free.
 */
export default function FunnelChart({
    stages,
    labels,
}: {
    stages: FunnelStage[];
    labels: FunnelLabels;
}) {
    const top = stages[0]?.value ?? 0;

    if (top <= 0) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {stages.map((stage) => (
                <div key={stage.key}>
                    {stage.dropOffPct !== null && (
                        <p className="pb-1 ps-1 text-[11px] text-gray-400">
                            {labels.dropOff.replace('{pct}', String(stage.dropOffPct))}
                        </p>
                    )}
                    <div className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs text-gray-600">{labels[stage.key]}</span>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div
                                data-testid="funnel-bar"
                                className="h-5 rounded-e-sm"
                                style={{
                                    background: CHART_BLUE,
                                    // Floor at 2% so a non-zero stage is never invisible.
                                    width: `${Math.max(2, (stage.value / top) * 100)}%`,
                                }}
                            />
                            <span className="shrink-0 text-xs font-semibold text-gray-900">{stage.value}</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
