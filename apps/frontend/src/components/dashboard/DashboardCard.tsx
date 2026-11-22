'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useUiStyle } from '@/lib/ui-theme';

export type CardTone = 'blue' | 'violet' | 'emerald' | 'orange' | 'pink' | 'sky' | 'teal';

const CHIP: Record<CardTone, string> = {
    blue: 'bg-blue-100 text-blue-600',
    violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    orange: 'bg-orange-100 text-orange-600',
    pink: 'bg-pink-100 text-pink-600',
    sky: 'bg-sky-100 text-sky-600',
    teal: 'bg-teal-100 text-teal-600',
};

const CLASSIC_CARD = 'rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';
const POLISHED_CARD = 'rounded-lg border border-gray-200/70 bg-white p-4';

/** The surface every dashboard panel sits on, in the workspace's style. */
export function useDashboardCardClass(): string {
    return useUiStyle().polished ? POLISHED_CARD : CLASSIC_CARD;
}

/**
 * A dashboard panel's heading. COLORFUL puts a tinted icon chip before the
 * title; the other styles show the title alone.
 */
export function CardTitle({
    icon: Icon,
    tone,
    children,
    spaced = true,
}: {
    icon?: LucideIcon;
    tone: CardTone;
    children: ReactNode;
    /** Bottom margin. Off when the title shares a row with something else. */
    spaced?: boolean;
}) {
    const { polished, colorful } = useUiStyle();
    const margin = spaced ? 'mb-2' : '';
    if (colorful && Icon) {
        return (
            <h3 className={`flex items-center gap-2 text-sm font-semibold text-gray-900 ${margin}`}>
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CHIP[tone]}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                </span>
                {children}
            </h3>
        );
    }
    return (
        <h3 className={`${polished ? 'text-sm font-semibold' : 'text-xs font-bold'} text-gray-900 ${margin}`}>{children}</h3>
    );
}
