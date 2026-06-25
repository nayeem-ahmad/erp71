'use client';

import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

export type KpiTone = 'positive' | 'negative' | 'neutral' | 'blue' | 'green' | 'purple' | 'peach';

const surfaceClasses: Record<KpiTone, string> = {
    positive: 'bg-[#E1F4EB] border-[#b8e6d0]',
    negative: 'bg-[#FBE4D9] border-[#f5cdb8]',
    neutral: 'bg-white border-gray-100',
    blue: 'bg-[#E4F4FC] border-[#b9e0f5]',
    green: 'bg-[#E1F4EB] border-[#b8e6d0]',
    purple: 'bg-[#E6E6FD] border-[#c9c9f5]',
    peach: 'bg-[#FBE4D9] border-[#f5cdb8]',
};

const iconClasses: Record<KpiTone, string> = {
    positive: 'bg-white/80 text-emerald-700',
    negative: 'bg-white/80 text-rose-700',
    neutral: 'bg-slate-50 text-slate-700',
    blue: 'bg-white/80 text-[#1e5a8a]',
    green: 'bg-white/80 text-emerald-700',
    purple: 'bg-white/80 text-[#4a3d8f]',
    peach: 'bg-white/80 text-[#9a4a2e]',
};

export function StatKpiTile({
    title,
    value,
    trend,
    isPositive,
    tone = 'blue',
}: {
    title: string;
    value: string;
    trend: string;
    isPositive: boolean;
    tone?: KpiTone;
}) {
    return (
        <div className={`rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${surfaceClasses[tone]}`}>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">{title}</p>
            <h3 className="text-3xl font-black tracking-tight text-gray-950 mb-3">{value}</h3>
            <div className={`flex items-center gap-1 text-xs font-bold ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                <span className="uppercase tracking-tight">{trend}</span>
            </div>
        </div>
    );
}

export function FinancialKpiTile({
    title,
    value,
    helper,
    tone,
    Icon,
}: {
    title: string;
    value: string;
    helper: string;
    tone: 'positive' | 'negative' | 'neutral';
    Icon: LucideIcon;
}) {
    const surface = tone === 'positive' ? 'green' : tone === 'negative' ? 'peach' : 'neutral';
    return (
        <div className={`rounded-2xl border p-5 shadow-sm ${surfaceClasses[surface as KpiTone]}`}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-500">{title}</p>
                    <h3 className="mt-3 text-3xl font-black tracking-tight text-gray-950">{value}</h3>
                </div>
                <div className={`rounded-2xl border border-white/60 px-3 py-3 ${iconClasses[surface as KpiTone]}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <p className="mt-4 text-sm font-medium text-gray-600">{helper}</p>
        </div>
    );
}