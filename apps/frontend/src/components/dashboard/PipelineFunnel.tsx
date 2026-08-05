'use client';

import { OrdinalBars, type OrdinalBar } from './OrdinalBars';

export type FunnelStage = OrdinalBar;

/**
 * Lead stage counts. A thin naming of `OrdinalBars` for CRM, which was where the
 * form was first needed; stock aging uses the same bars under its own name.
 *
 * Stage is an *ordinal* dimension, so the open stages step down one hue rather
 * than taking four categorical colors. The two outcomes sit below a rule: won is
 * emerald because it is the good end state, lost is gray because losing a deal is
 * an outcome, not an error.
 */
export function PipelineFunnel({
    title,
    subtitle,
    stages,
    emptyLabel,
    formatCount,
}: Readonly<{
    title: string;
    subtitle?: string;
    stages: FunnelStage[];
    emptyLabel: string;
    formatCount: (count: number, share: number | null) => string;
}>) {
    return (
        <OrdinalBars
            title={title}
            subtitle={subtitle}
            bars={stages}
            emptyLabel={emptyLabel}
            formatCount={formatCount}
        />
    );
}
