'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const baseClass =
    'inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed max-md:min-h-touch';

const sizeClass: Record<Size, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
};

const variantClass: Record<Variant, string> = {
    primary: 'bg-primary hover:bg-primary-hover text-white',
    secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-danger hover:bg-red-700 text-white',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    /** @deprecated use `icon` instead — kept for backward compatibility. */
    leftIcon?: ReactNode;
    icon?: ReactNode;
    loading?: boolean;
};

/** Canonical compact action button — primary/secondary/ghost/danger variants, sm/md sizes. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'primary',
        size = 'sm',
        leftIcon,
        icon,
        loading = false,
        className = '',
        type = 'button',
        disabled,
        children,
        ...rest
    },
    ref,
) {
    const leadingIcon = loading ? (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
    ) : (
        icon ?? leftIcon
    );

    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            className={`${baseClass} ${sizeClass[size]} ${variantClass[variant]} ${className}`}
            {...rest}
        >
            {leadingIcon}
            {children}
        </button>
    );
});

export default Button;
