'use client';

import { controlWidthClass } from './control-width';
import { forwardRef, type SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
    /** Marks the control as invalid — applies the danger border tint. */
    error?: boolean;
};

const BASE_CLASS =
    'rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white disabled:opacity-60 max-md:min-h-touch';

/**
 * Canonical compact select — see docs/ui-design-guidelines.md §2.6.
 *
 * The recipe below is only the box. Taking the browser's own control apart —
 * `appearance: none` plus the chevron that replaces the arrow it removes — is a
 * base rule on `select` in `globals.css`, because the hand-rolled selects that
 * predate this component are the same control and drifted the same way. That
 * rule also owns the inline-end padding, so the `px-2.5` here sets the start
 * inset only and the option text never runs under the chevron.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { error, className = '', children, ...rest },
    ref,
) {
    return (
        <select
            ref={ref}
            className={`${controlWidthClass(className)} ${BASE_CLASS}${error ? ' border-danger' : ''}${className ? ` ${className}` : ''}`.trim()}
            {...rest}
        >
            {children}
        </select>
    );
});
