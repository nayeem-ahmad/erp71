'use client';

import { compactDensity } from '@/lib/ui/compact-density';

type CompactStatProps = {
    label: string;
    value: React.ReactNode;
    tone?: 'default' | 'positive' | 'negative' | 'warning' | 'info';
    className?: string;
};

const toneClasses: Record<NonNullable<CompactStatProps['tone']>, string> = {
    default: 'text-gray-900',
    positive: 'text-emerald-700',
    negative: 'text-rose-600',
    warning: 'text-amber-600',
    info: 'text-indigo-600',
};

export default function CompactStat({
    label,
    value,
    tone = 'default',
    className = '',
}: CompactStatProps) {
    return (
        <div className={`${compactDensity.cardFlat} ${className}`}>
            <p className={compactDensity.statLabel}>{label}</p>
            <p className={`${compactDensity.statValue} mt-0.5 ${toneClasses[tone]}`}>{value}</p>
        </div>
    );
}