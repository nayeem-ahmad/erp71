import type { ReactNode } from 'react';

export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusBadgeTone, string> = {
    success: 'bg-success-light text-success-text',
    warning: 'bg-warning-light text-warning-text',
    danger: 'bg-danger-light text-danger-text',
    info: 'bg-primary-light text-blue-700',
    neutral: 'bg-gray-100 text-gray-600',
};

interface StatusBadgeProps {
    tone: StatusBadgeTone;
    children: ReactNode;
    className?: string;
}

export function StatusBadge({ tone, children, className = '' }: StatusBadgeProps) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`.trim()}
        >
            {children}
        </span>
    );
}

const SUCCESS_STATUSES = new Set(['active', 'paid', 'completed', 'approved', 'posted']);
const WARNING_STATUSES = new Set(['pending', 'draft', 'processing']);
const DANGER_STATUSES = new Set(['overdue', 'failed', 'cancelled', 'rejected', 'lost']);
const INFO_STATUSES = new Set(['new', 'info']);

export function statusToneFor(status: string): StatusBadgeTone {
    const normalized = (status || '').toLowerCase();
    if (SUCCESS_STATUSES.has(normalized)) return 'success';
    if (WARNING_STATUSES.has(normalized)) return 'warning';
    if (DANGER_STATUSES.has(normalized)) return 'danger';
    if (INFO_STATUSES.has(normalized)) return 'info';
    return 'neutral';
}
