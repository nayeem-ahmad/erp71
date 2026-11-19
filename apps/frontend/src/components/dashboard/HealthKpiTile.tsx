'use client';

import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useUiStyle } from '@/lib/ui-theme';
import { Sparkline } from './Sparkline';

export type KpiTone = 'violet' | 'emerald' | 'orange' | 'sky' | 'pink' | 'teal';

/** A band's tiles take these in order, so neighbours never share a hue. */
export const KPI_TONES: KpiTone[] = ['violet', 'emerald', 'orange', 'sky', 'pink', 'teal'];

// The gradients end on a -700 shade so white text stays readable across the card.
const TONE_CLASS: Record<KpiTone, string> = {
    violet: 'from-violet-500 to-indigo-700 shadow-violet-200',
    emerald: 'from-emerald-500 to-emerald-700 shadow-emerald-200',
    orange: 'from-orange-500 to-red-600 shadow-orange-200',
    sky: 'from-sky-500 to-blue-700 shadow-sky-200',
    pink: 'from-pink-500 to-rose-700 shadow-pink-200',
    teal: 'from-teal-500 to-cyan-700 shadow-teal-200',
};

type HealthKpiTileProps = {
    title: string;
    value: string;
    delta: string;
    deltaPositive: boolean;
    deltaContext?: string;
    points: number[];
    note?: string;
    /** COLORFUL only. */
    tone?: KpiTone;
    /** COLORFUL only. */
    icon?: LucideIcon;
};

export function HealthKpiTile(props: HealthKpiTileProps) {
    const { polished, colorful } = useUiStyle();
    if (colorful) return <ColorfulTile {...props} />;
    if (polished) return <PolishedTile {...props} />;
    return <ClassicTile {...props} />;
}

function ClassicTile({ title, value, delta, deltaPositive, deltaContext, points, note }: HealthKpiTileProps) {
    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-gray-900">{value}</p>
            <p className="mt-0.5 flex items-baseline gap-1.5 text-[10px] font-bold">
                <span className={deltaPositive ? 'text-success-text' : 'text-danger-text'}>{delta}</span>
                {deltaContext ? <span className="font-medium text-gray-400">{deltaContext}</span> : null}
            </p>
            <div className="mt-2 flex h-[30px] items-center">
                {points.length >= 2 ? (
                    <Sparkline points={points} positive={deltaPositive} />
                ) : note ? (
                    <span className="rounded-full border border-amber-200 bg-warning-light px-2 py-0.5 text-[10px] font-bold text-warning-text">
                        {note}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/** A dash is the absence of a comparison, not a figure to badge. */
const hasComparison = (delta: string) => Boolean(delta) && delta !== '—';
const stripArrow = (delta: string) => delta.replace(/^[▲▼]\s*/, '');

function PolishedTile({ title, value, delta, deltaPositive, deltaContext, points, note }: HealthKpiTileProps) {
    const hasDelta = hasComparison(delta);
    const DeltaIcon = deltaPositive ? ArrowUpRight : ArrowDownRight;
    return (
        <div className="flex items-end justify-between gap-3 rounded-lg border border-gray-200/70 bg-white p-3 transition-shadow hover:shadow-sm md:p-4">
            <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500">{title}</p>
                <p className="mt-1 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums text-gray-950 md:text-2xl">{value}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {hasDelta ? (
                        <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${deltaPositive ? 'bg-success-light text-success-text' : 'bg-danger-light text-danger-text'}`}>
                            <DeltaIcon className="h-3 w-3" aria-hidden />
                            {stripArrow(delta)}
                        </span>
                    ) : null}
                    {hasDelta && deltaContext ? <span className="hidden text-gray-400 md:inline">{deltaContext}</span> : null}
                    {!hasDelta && note ? (
                        <span className="rounded-full bg-warning-light px-2 py-0.5 font-medium text-warning-text">{note}</span>
                    ) : null}
                </p>
            </div>
            {points.length >= 2 ? (
                <div className="hidden w-24 shrink-0 lg:block">
                    <Sparkline points={points} positive={deltaPositive} />
                </div>
            ) : null}
        </div>
    );
}

function ColorfulTile({ title, value, delta, deltaPositive, deltaContext, points, note, tone = 'violet', icon: Icon }: HealthKpiTileProps) {
    const hasDelta = hasComparison(delta);
    const DeltaIcon = deltaPositive ? ArrowUpRight : ArrowDownRight;
    return (
        <div className={`relative flex flex-col overflow-hidden rounded-xl bg-gradient-to-br p-3 text-white shadow-md md:p-4 ${TONE_CLASS[tone]}`}>
            {/* A soft highlight in the corner, the way a lit card catches the light. */}
            <span aria-hidden className="pointer-events-none absolute -end-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
            <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-white/90">{title}</p>
                {Icon ? (
                    <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20 md:inline-flex">
                        <Icon className="h-4 w-4" aria-hidden />
                    </span>
                ) : null}
            </div>
            <p className="mt-1 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums md:text-2xl">{value}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                {hasDelta ? (
                    // The card's hue is decoration; up or down is carried by the arrow
                    // and by a darker chip for a fall.
                    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${deltaPositive ? 'bg-white/20' : 'bg-black/25'}`}>
                        <DeltaIcon className="h-3 w-3" aria-hidden />
                        {stripArrow(delta)}
                    </span>
                ) : null}
                {hasDelta && deltaContext ? <span className="hidden text-white/80 md:inline">{deltaContext}</span> : null}
                {!hasDelta && note ? <span className="rounded-full bg-white/20 px-2 py-0.5 font-medium">{note}</span> : null}
            </p>
            {points.length >= 2 ? (
                <div className="mt-auto pt-2">
                    <Sparkline points={points} positive={deltaPositive} inverse />
                </div>
            ) : null}
        </div>
    );
}
