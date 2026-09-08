'use client';

import { User } from 'lucide-react';

/**
 * `md` is a list page's filter row, sized like the controls beside it.
 * `sm` is the dashboard toolbar, where it sits next to `RangeTabs` and matches
 * their metrics — a 44px control next to a 22px one reads as a mistake, and the
 * touch-target floor is met there by the tabs' own spacing rather than by height.
 */
type ToggleSize = 'sm' | 'md';

const SIZES: Record<ToggleSize, { button: string; icon: string }> = {
    sm: { button: 'gap-1.5 px-2.5 py-1 text-[10px] font-bold', icon: 'h-3 w-3' },
    md: { button: 'min-h-touch gap-2 px-3 py-2 text-sm font-semibold', icon: 'h-4 w-4' },
};

/**
 * The "Only mine" switch, identical on every CRM surface that offers it.
 *
 * A pressed-state button rather than a checkbox or another entry in the owner
 * dropdown: it is a scope, not one filter among the others, and it has to read
 * as switched *on* from across the room — a narrowed list must always say why it
 * is short. Shares its shape with the leads list's "No activity in N days"
 * toggle, which is the same kind of control.
 *
 * The state itself lives in `useCrmMineOnly`; this only draws it.
 */
export default function MineOnlyToggle({
    value,
    onChange,
    label,
    title,
    size = 'md',
    className = '',
}: Readonly<{
    value: boolean;
    onChange: (value: boolean) => void;
    label: string;
    /** The longer sentence, for the tooltip and for screen readers. */
    title?: string;
    size?: ToggleSize;
    className?: string;
}>) {
    const metrics = SIZES[size];

    return (
        <button
            type="button"
            onClick={() => onChange(!value)}
            aria-pressed={value}
            title={title ?? label}
            className={`inline-flex items-center rounded-lg border transition-colors ${metrics.button} ${
                value
                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            } ${className}`}
        >
            <User className={metrics.icon} />
            {label}
        </button>
    );
}
