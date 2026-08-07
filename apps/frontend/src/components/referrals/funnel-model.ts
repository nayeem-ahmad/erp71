export type FunnelStageKey = 'clicks' | 'signups' | 'earned' | 'paid';

export type FunnelStage = {
    key: FunnelStageKey;
    value: number;
    /** Percent lost since the previous stage. Null on the first stage, and null
     *  rather than NaN when the previous stage was zero. */
    dropOffPct: number | null;
};

/**
 * Stages are cumulative: `earned` counts commissions that reached EARNED *or*
 * went on to be PAID. Without that the funnel would appear to shrink and then
 * grow, which is not what a funnel means.
 */
export function buildFunnel(input: {
    clicks: number;
    signups: number;
    earned: number;
    paid: number;
}): FunnelStage[] {
    const values: Array<{ key: FunnelStageKey; value: number }> = [
        { key: 'clicks', value: input.clicks },
        { key: 'signups', value: input.signups },
        { key: 'earned', value: input.earned },
        { key: 'paid', value: input.paid },
    ];

    return values.map((stage, index) => {
        if (index === 0) return { ...stage, dropOffPct: null };
        const previous = values[index - 1].value;
        if (previous <= 0) return { ...stage, dropOffPct: null };
        // Clamped at zero: click tracking was added after the first signups, so a
        // partner can legitimately have more signups than recorded clicks, and
        // "-200% drop-off" would be nonsense.
        const lost = Math.max(0, previous - stage.value);
        return { ...stage, dropOffPct: Math.round((lost / previous) * 100) };
    });
}
