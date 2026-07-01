'use client';

import type { ReactNode } from 'react';

type ModalShellSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZE_CLASS: Record<ModalShellSize, string> = {
    sm: 'sm:max-w-lg',
    md: 'sm:max-w-2xl',
    lg: 'sm:max-w-3xl',
    xl: 'sm:max-w-4xl',
    '2xl': 'sm:max-w-5xl',
};

type ModalShellProps = {
    children: ReactNode;
    size?: ModalShellSize;
    className?: string;
    onBackdropClick?: () => void;
};

export default function ModalShell({
    children,
    size = 'sm',
    className = '',
    onBackdropClick,
}: ModalShellProps) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 backdrop-blur-sm sm:p-4"
            onClick={onBackdropClick}
            role="presentation"
        >
            <div
                className={`flex w-full max-h-[95vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl ${SIZE_CLASS[size]} ${className}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {children}
            </div>
        </div>
    );
}