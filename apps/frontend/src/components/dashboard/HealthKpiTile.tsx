'use client';

import { Sparkline } from './Sparkline';

export function HealthKpiTile({
    title,
    value,
    delta,
    deltaPositive,
    deltaContext,
    points,
    note,
}: {
    title: string;
    value: string;
    delta: string;
    deltaPositive: boolean;
    deltaContext?: string;
    points: number[];
    note?: string;
}) {
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
