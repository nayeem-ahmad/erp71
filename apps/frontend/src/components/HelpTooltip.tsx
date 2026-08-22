'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTooltipProps {
    text: string | string[];
    title?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    wide?: boolean;
}

const sideClasses: Record<NonNullable<HelpTooltipProps['side']>, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'end-full top-1/2 -translate-y-1/2 me-2',
    right: 'start-full top-1/2 -translate-y-1/2 ms-2',
};

export function HelpTooltip({ text, title, side = 'top', wide = false }: HelpTooltipProps) {
    const [visible, setVisible] = useState(false);
    const lines = Array.isArray(text) ? text : [text];

    return (
        <span className="relative inline-flex items-center">
            <button
                type="button"
                aria-label={title ? `Help: ${title}` : 'Show help'}
                className="inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-full"
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
                onFocus={() => setVisible(true)}
                onBlur={() => setVisible(false)}
            >
                <HelpCircle
                    size={14}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                />
            </button>
            {visible && (
                <span
                    role="tooltip"
                    className={`absolute ${sideClasses[side]} z-50 ${wide ? 'max-w-sm' : 'max-w-xs'} w-max rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg pointer-events-none`}
                >
                    {title ? <span className="block font-bold mb-1">{title}</span> : null}
                    {lines.map((line) => (
                        <span key={line} className="block leading-relaxed">{line}</span>
                    ))}
                </span>
            )}
        </span>
    );
}

export function LabelWithHelp({
    label,
    help,
    children,
    className = 'block text-xs font-bold uppercase tracking-widest text-gray-400',
}: {
    label: string;
    help?: string | string[];
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <label className={className}>
            <span className="inline-flex items-center gap-1.5">
                {label}
                {help ? <HelpTooltip text={help} side="right" /> : null}
            </span>
            {children}
        </label>
    );
}