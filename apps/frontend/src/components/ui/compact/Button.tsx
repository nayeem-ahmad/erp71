'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';

type Variant = 'primary' | 'secondary';

const variantClass: Record<Variant, string> = {
    primary: `${compactDensity.btnPrimary} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`,
    secondary: `${compactDensity.btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`,
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    leftIcon?: ReactNode;
};

/** Canonical compact action button — primary (blue) and secondary (outline) variants. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', leftIcon, className = '', type = 'button', children, ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={`${variantClass[variant]} ${className}`}
            {...rest}
        >
            {leftIcon}
            {children}
        </button>
    );
});

export default Button;
