'use client';

import Link from 'next/link';

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

export function AttentionStrip({ items, allClearLabel }: { items: AttentionItem[]; allClearLabel: string }) {
    if (!items.length) {
        return (
            <div className="rounded-xl border border-gray-100 bg-white p-4 text-center text-xs font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {allClearLabel}
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
                    <p className="text-lg font-extrabold text-slate-900">{item.value}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">{item.label}</p>
                    <span className="mt-1 inline-block text-[10px] font-bold text-[#6366f1]">{item.cta} →</span>
                </Link>
            ))}
        </div>
    );
}
