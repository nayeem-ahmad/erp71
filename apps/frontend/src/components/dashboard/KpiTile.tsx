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
        <div className={`rounded-lg border p-3 shadow-sm transition-all hover:shadow-md ${surfaceClasses[tone]}`}>
            <p className="text-xs font-medium text-gray-500 mb-0.5">{title}</p>
            <h3 className="text-xl font-bold tracking-tight text-gray-950 mb-1.5">{value}</h3>
            <div className={`flex items-center gap-1 text-[11px] font-semibold ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>{trend}</span>
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
        <div className={`rounded-lg border p-3 shadow-sm ${surfaceClasses[surface as KpiTone]}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500">{title}</p>
                    <h3 className="mt-1 text-xl font-bold tracking-tight text-gray-950">{value}</h3>
                </div>
                <div className={`shrink-0 rounded-lg border border-white/60 p-1.5 ${iconClasses[surface as KpiTone]}`}>
                    <Icon className="h-4 w-4" />
                </div>
            </div>
            <p className="mt-2 text-xs text-gray-600 leading-snug">{helper}</p>
        </div>
    );
}