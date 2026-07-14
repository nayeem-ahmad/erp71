'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

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
            className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/50 p-0 backdrop-blur-sm sm:p-4"
            onClick={onBackdropClick}
            role="presentation"
        >
            <div
                className={`flex w-full max-h-[95vh] flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl ${SIZE_CLASS[size]} ${className}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {children}
            </div>
        </div>
    );
}

type ModalHeaderProps = {
    title: ReactNode;
    subtitle?: ReactNode;
    onClose?: () => void;
    closeLabel?: string;
    className?: string;
    children?: ReactNode;
};

export function ModalHeader({
    title,
    subtitle,
    onClose,
    closeLabel = 'Close',
    className = '',
    children,
}: ModalHeaderProps) {
    return (
        <div
            className={`px-4 py-3 border-b border-gray-100 flex items-center justify-between ${className}`}
        >
            <div>
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {subtitle ? <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
                {children}
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={closeLabel}
                        className="p-2 rounded-md text-gray-400 hover:bg-gray-100"
                    >
                        <X className="w-5 h-5" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

type ModalFooterProps = {
    children: ReactNode;
    className?: string;
};

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
    return (
        <div
            className={`px-4 py-3 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white ${className}`}
        >
            {children}
        </div>
    );
}
