'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

/**
 * What an action does, which decides its colour — never the page's taste.
 *
 * Every icon rests in the same gray so a column of them reads as one quiet
 * gutter; the intent shows on hover and keyboard focus. The icon's shape tells
 * actions apart, and a destructive one still goes through a confirm dialog.
 */
export type RowActionIntent = 'neutral' | 'success' | 'warning' | 'danger';

const INTENT_CLASS: Record<RowActionIntent, string> = {
    neutral: 'hover:bg-blue-50 hover:text-blue-600 focus-visible:bg-blue-50 focus-visible:text-blue-600',
    success: 'hover:bg-emerald-50 hover:text-emerald-600 focus-visible:bg-emerald-50 focus-visible:text-emerald-600',
    warning: 'hover:bg-amber-50 hover:text-amber-600 focus-visible:bg-amber-50 focus-visible:text-amber-600',
    danger: 'hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600',
};

/**
 * 28px square around a 16px glyph on a desktop; the 44px a finger needs on a
 * phone. `inline-flex` keeps it on the row's text line, so the actions sit in
 * the vertical middle of the row like the text beside them.
 */
const BASE_CLASS =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 '
    + 'max-md:min-h-touch max-md:min-w-touch [&_svg]:h-4 [&_svg]:w-4';

const DISABLED_CLASS =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-300 cursor-not-allowed '
    + 'max-md:min-h-touch max-md:min-w-touch [&_svg]:h-4 [&_svg]:w-4';

export interface RowActionButtonProps {
    /** The glyph, e.g. `<Eye />`. Sized here — no classes needed. */
    icon: ReactNode;
    /** Names the button for a screen reader and shows as its tooltip. */
    label: string;
    intent?: RowActionIntent;
    /** Navigates instead of acting. */
    href?: string;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
}

export function RowActionButton({ icon, label, intent = 'neutral', href, onClick, disabled = false }: RowActionButtonProps) {
    if (disabled) {
        return (
            <span role="button" aria-disabled="true" aria-label={label} title={label} className={DISABLED_CLASS}>
                {icon}
            </span>
        );
    }
    const className = `${BASE_CLASS} ${INTENT_CLASS[intent]}`;
    if (href) {
        return (
            <Link href={href} aria-label={label} title={label} className={className}>
                {icon}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
            {icon}
        </button>
    );
}

/**
 * The row's action gutter. Centred in its column, so the icons sit under the
 * header whatever the column's width.
 */
export function RowActions({ children }: { children: ReactNode }) {
    return <div className="flex items-center justify-center gap-0.5">{children}</div>;
}
