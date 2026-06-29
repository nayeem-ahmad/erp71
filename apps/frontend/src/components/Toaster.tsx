'use client';

import { useEffect } from 'react';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type ToastItem } from '@/lib/toast';

const STYLES: Record<ToastItem['type'], { container: string; icon: string }> = {
    success: {
        container: 'bg-green-50 border-green-200 text-green-800',
        icon: 'text-green-500',
    },
    error: {
        container: 'bg-red-50 border-red-200 text-red-800',
        icon: 'text-red-500',
    },
    info: {
        container: 'bg-blue-50 border-blue-200 text-blue-800',
        icon: 'text-blue-500',
    },
};

function ToastIcon({ type }: { type: ToastItem['type'] }) {
    const className = `w-4 h-4 flex-shrink-0 ${STYLES[type].icon}`;
    if (type === 'success') return <CheckCircle className={className} aria-hidden />;
    if (type === 'error') return <XCircle className={className} aria-hidden />;
    return <Info className={className} aria-hidden />;
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onDismiss, item.duration);
        return () => clearTimeout(timer);
    }, [item.duration, onDismiss]);

    return (
        <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm font-medium max-w-sm animate-in fade-in slide-in-from-top-2 ${STYLES[item.type].container}`}
        >
            <ToastIcon type={item.type} />
            <p className="flex-1 min-w-0 whitespace-pre-line leading-snug">{item.message}</p>
            <button
                type="button"
                onClick={onDismiss}
                className="flex-shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Dismiss notification"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

export default function Toaster() {
    const toasts = useToastStore((state) => state.toasts);
    const dismiss = useToastStore((state) => state.dismiss);

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-16 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
            aria-label="Notifications"
        >
            {toasts.map((item) => (
                <div key={item.id} className="pointer-events-auto">
                    <ToastCard item={item} onDismiss={() => dismiss(item.id)} />
                </div>
            ))}
        </div>
    );
}