'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export type FormFooterProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;
};

/** Right-aligned form action row — see docs/ui-design-guidelines.md §2.6. */
export function FormFooter({ className = '', children, ...rest }: FormFooterProps) {
    return (
        <div className={`flex justify-end gap-2 border-t border-gray-100 pt-3${className ? ` ${className}` : ''}`} {...rest}>
            {children}
        </div>
    );
}
