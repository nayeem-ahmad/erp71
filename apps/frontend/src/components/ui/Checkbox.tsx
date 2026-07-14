'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const BASE_CLASS =
    'h-4 w-4 rounded border-gray-300 text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 max-md:min-h-touch max-md:min-w-touch';

/** Canonical compact checkbox — see docs/ui-design-guidelines.md §2.6. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
    { className = '', ...rest },
    ref,
) {
    return (
        <input
            ref={ref}
            type="checkbox"
            className={`${BASE_CLASS}${className ? ` ${className}` : ''}`}
            {...rest}
        />
    );
});
