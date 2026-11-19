'use client';

import Link from 'next/link';
import { useUiStyle } from '@/lib/ui-theme';

export type AttentionTone = 'red' | 'amber' | 'blue' | 'violet';

export type AttentionItem = {
    id: string;
    tone: AttentionTone;
    value: string;
    label: string;
    href: string;
    cta: string;
};

const BORDER: Record<AttentionTone, string> = {
    red: 'border-l-[#ef4444]',
    amber: 'border-l-[#f59e0b]',
    blue: 'border-l-[#3b82f6]',
    violet: 'border-l-[#8b5cf6]',
};

// COLORFUL: a tinted card per tone, so how urgent it is shows before the words do.
const TINT: Record<AttentionTone, string> = {
    red: 'border-red-200 bg-gradient-to-br from-red-50 to-white',
    amber: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white',
    blue: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white',
    violet: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white',
};
const DOT: Record<AttentionTone, string> = {
    red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-600', violet: 'bg-violet-500',
};
const FIGURE: Record<AttentionTone, string> = {
    red: 'text-red-700', amber: 'text-amber-700', blue: 'text-blue-700', violet: 'text-violet-700',
};

export function AttentionStrip({ items, allClearLabel }: { items: AttentionItem[]; allClearLabel: string }) {
    const { polished, colorful } = useUiStyle();
    if (!items.length) {
        return (
            <div className="rounded-xl border border-gray-100 bg-white p-4 text-center text-xs font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {allClearLabel}
            </div>
        );
    }

    if (polished) {
        return (
            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                {items.map((item) => (
                    <Link
                        key={item.id}
                        href={item.href}
                        className={`rounded-lg border p-3 transition-shadow hover:shadow-md ${colorful ? TINT[item.tone] : `border-gray-200/70 border-l-[3px] bg-white ${BORDER[item.tone]}`}`}
                    >
                        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                            {colorful ? <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.tone]}`} /> : null}
                            {item.label}
                        </p>
                        <p className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-nums ${colorful ? FIGURE[item.tone] : 'text-gray-950'}`}>{item.value}</p>
                        <span className="mt-1 inline-block text-xs font-medium text-blue-600">{item.cta} →</span>
                    </Link>
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {items.map((item) => (
                <Link
                    key={item.id}
                    href={item.href}
                    className={`rounded-xl border border-gray-100 border-l-[3px] ${BORDER[item.tone]} bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md`}
                >
                    <p className="text-lg font-extrabold text-gray-900">{item.value}</p>
                    <p className="mt-0.5 text-[10px] text-gray-600">{item.label}</p>
                    <span className="mt-1 inline-block text-[10px] font-bold text-primary">{item.cta} →</span>
                </Link>
            ))}
        </div>
    );
}
