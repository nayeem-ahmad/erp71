import type { PagePhases } from '@/lib/page-timing/collector';

export type PhaseKey = 'document' | 'boot' | 'data' | 'render';

/**
 * One fixed color per phase, the first four slots of the validated categorical
 * palette (docs: dataviz reference palette), always in this order so a phase
 * keeps its color whichever of them a view has. Inline styles, not Tailwind
 * classes: these are chart series colors, not UI tokens.
 */
export const PHASE_COLORS: Record<PhaseKey, string> = {
    document: '#2a78d6',
    boot: '#eb6834',
    data: '#1baf7a',
    render: '#eda100',
};

export const PHASE_ORDER: PhaseKey[] = ['document', 'boot', 'data', 'render'];

export function phaseValue(phases: Pick<PagePhases, 'documentMs' | 'bootMs' | 'dataMs' | 'renderMs'>, key: PhaseKey): number | null {
    switch (key) {
        case 'document':
            return phases.documentMs;
        case 'boot':
            return phases.bootMs;
        case 'data':
            return phases.dataMs;
        case 'render':
            return phases.renderMs;
    }
}
