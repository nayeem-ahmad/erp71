'use client';

import type { ReactNode } from 'react';

export type FieldProps = {
    label: ReactNode;
    required?: boolean;
    error?: string;
    hint?: string;
    htmlFor?: string;
    className?: string;
    children: ReactNode;
};

/** Label + control + inline error/hint wrapper — see docs/ui-design-guidelines.md §2.6. */
export function Field({ label, required, error, hint, htmlFor, className = '', children }: FieldProps) {
    return (
        <div className={className}>
            <label htmlFor={htmlFor} className="text-xs font-medium text-gray-600">
                {label}
                {required && <span className="text-danger"> *</span>}
            </label>
            <div className="mt-1">{children}</div>
            {error && (
                <p role="alert" className="text-xs text-danger mt-1">
                    {error}
                </p>
            )}
            {!error && hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        </div>
    );
}
