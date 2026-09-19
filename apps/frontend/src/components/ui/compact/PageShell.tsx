'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';

type MaxWidth = 'full' | 'wide' | 'narrow';

const innerClass: Record<MaxWidth, string> = {
    full: `w-full ${compactDensity.pageInner}`,
    wide: compactDensity.pageInnerWide,
    narrow: compactDensity.pageInnerNarrow,
};

type PageShellProps = {
    children: ReactNode;
    maxWidth?: MaxWidth;
    className?: string;
    /**
     * Extra classes for the inner column the children sit in.
     *
     * Only a page that has to fit the window rather than grow past it needs
     * this. The shell is the app's vertical scroller, so a child cannot give
     * itself a height unless the box between them has one — the board passes
     * `md:flex md:h-full md:flex-col` through here so its columns can scroll
     * inside their own frames instead of stretching the page.
     */
    contentClassName?: string;
};

/** Compact page wrapper for module screens. */
export default function PageShell({
    children,
    maxWidth = 'full',
    className = '',
    contentClassName = '',
}: PageShellProps) {
    return (
        <div className={`${compactDensity.page} ${className}`}>
            <div className={`${innerClass[maxWidth]} ${contentClassName}`.trim()}>{children}</div>
        </div>
    );
}