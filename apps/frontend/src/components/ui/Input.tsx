'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
    /** Marks the control as invalid — applies the danger border tint. */
    error?: boolean;
};

const BASE_CLASS =
    'w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white disabled:opacity-60 max-md:min-h-touch';

/** Canonical compact text input — see docs/ui-design-guidelines.md §2.6. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { error, className = '', ...rest },
    ref,
) {
    return (
        <input
            ref={ref}
            className={`${BASE_CLASS}${error ? ' border-danger' : ''}${className ? ` ${className}` : ''}`}
            {...rest}
        />
    );
});
