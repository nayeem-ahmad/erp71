'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export type FormGridProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;
};

function FormGridBase({ className = '', children, ...rest }: FormGridProps) {
    return (
        <div className={`grid gap-3 sm:grid-cols-2${className ? ` ${className}` : ''}`} {...rest}>
            {children}
        </div>
    );
}

function FormGridFull({ className = '', children, ...rest }: FormGridProps) {
    return (
        <div className={`sm:col-span-2${className ? ` ${className}` : ''}`} {...rest}>
            {children}
        </div>
    );
}

/** Two-column responsive form layout — see docs/ui-design-guidelines.md §2.6. */
export const FormGrid = Object.assign(FormGridBase, { Full: FormGridFull });
