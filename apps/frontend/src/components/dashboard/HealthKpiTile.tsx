'use client';

import { Sparkline } from './Sparkline';

export function HealthKpiTile({
    title,
    value,
    delta,
    deltaPositive,
    points,
}: {
    title: string;
    value: string;
    delta: string;
    deltaPositive: boolean;
    points: number[];
}) {
    return (
        <div className="rounded-xl border border-[#eef2f7] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">{value}</p>
            <p className={`mt-0.5 text-[10px] font-bold ${deltaPositive ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{delta}</p>
            <div className="mt-2">
                <Sparkline points={points} />
            </div>
        </div>
    );
}
