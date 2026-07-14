'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
    /** Marks the control as invalid — applies the danger border tint. */
    error?: boolean;
};

const BASE_CLASS =
    'w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white disabled:opacity-60 max-md:min-h-touch';

/** Canonical compact select — see docs/ui-design-guidelines.md §2.6. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { error, className = '', children, ...rest },
    ref,
) {
    return (
        <select
            ref={ref}
            className={`${BASE_CLASS}${error ? ' border-danger' : ''}${className ? ` ${className}` : ''}`}
            {...rest}
        >
            {children}
        </select>
    );
});
