'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';

type MaxWidth = 'full' | 'wide' | 'narrow';

const innerClass: Record<MaxWidth, string> = {
    full: `w-full ${compactDensity.pageInner}`,
    wide: compactDensity.pageInnerWide,
    narrow: compactDensity.pageInnerNarrow,
};

type AccountingPageShellProps = {
    children: ReactNode;
    maxWidth?: MaxWidth;
    className?: string;
};

/** Compact page wrapper for accounting module screens. */
export default function AccountingPageShell({
    children,
    maxWidth = 'full',
    className = '',
}: AccountingPageShellProps) {
    return (
        <div className={`${compactDensity.page} ${className}`}>
            <div className={innerClass[maxWidth]}>{children}</div>
        </div>
    );
}