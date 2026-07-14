import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<AlertTone, string> = {
    info: 'bg-primary-light border-primary-border text-blue-700',
    success: 'bg-success-light border-success/20 text-success-text',
    warning: 'bg-warning-light border-warning/20 text-warning-text',
    danger: 'bg-danger-light border-danger/20 text-danger-text',
};

const TONE_ICONS: Record<AlertTone, ReactNode> = {
    info: <Info className="h-4 w-4 shrink-0" />,
    success: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 shrink-0" />,
    danger: <XCircle className="h-4 w-4 shrink-0" />,
};

interface AlertProps {
    tone: AlertTone;
    title?: string;
    children: ReactNode;
    className?: string;
}

export function Alert({ tone, title, children, className = '' }: AlertProps) {
    const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';

    return (
        <div
            role={role}
            className={`flex gap-2 rounded-md border p-3 text-sm ${TONE_CLASSES[tone]} ${className}`.trim()}
        >
            {TONE_ICONS[tone]}
            <div className="min-w-0">
                {title && <div className="font-semibold">{title}</div>}
                <div>{children}</div>
            </div>
        </div>
    );
}
