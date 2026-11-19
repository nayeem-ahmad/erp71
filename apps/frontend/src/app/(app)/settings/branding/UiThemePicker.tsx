'use client';

import { UI_THEMES, type UiTheme } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';
import ChoiceCard from './ChoiceCard';

const COPY_KEY: Record<UiTheme, 'classic' | 'polished' | 'colorful'> = {
    CLASSIC: 'classic',
    POLISHED: 'polished',
    COLORFUL: 'colorful',
};

/**
 * Three cards, one per style, each with a thumbnail of a dashboard in that
 * style. A radio group underneath, so the arrow keys and screen readers treat
 * it as one choice.
 */
export default function UiThemePicker({
    value,
    saved,
    onChange,
}: {
    value: UiTheme;
    /** The style currently in force, marked "Current" until a new one is saved. */
    saved: UiTheme;
    onChange: (theme: UiTheme) => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.settingsExtras.branding.uiTheme;

    return (
        <fieldset>
            <legend className="text-sm font-medium text-gray-900">{m.label}</legend>
            <p className="mt-0.5 text-xs text-gray-500">{m.hint}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {UI_THEMES.map((theme) => {
                    const copy = m[COPY_KEY[theme]];
                    return (
                        <ChoiceCard
                            key={theme}
                            group="ui_theme"
                            value={theme}
                            name={copy.name}
                            description={copy.description}
                            preview={<ThemeThumbnail theme={theme} label={fmt(m.previewAlt, { name: copy.name })} />}
                            selected={value === theme}
                            current={saved === theme}
                            currentLabel={m.current}
                            onSelect={() => onChange(theme)}
                        />
                    );
                })}
            </div>
        </fieldset>
    );
}

/** A dashboard in miniature: sidebar, a row of four figure cards, a chart. Drawn, not a screenshot, so it never goes stale. */
function ThemeThumbnail({ theme, label }: { theme: UiTheme; label: string }) {
    const colorful = theme === 'COLORFUL';
    const polished = theme !== 'CLASSIC';
    const cards = colorful
        ? ['from-violet-500 to-indigo-700', 'from-emerald-500 to-emerald-700', 'from-orange-500 to-red-600', 'from-sky-500 to-blue-700']
        : [];
    const navDots = colorful ? ['bg-emerald-500', 'bg-orange-500', 'bg-violet-500', 'bg-pink-500'] : ['bg-gray-300', 'bg-gray-300', 'bg-gray-300', 'bg-gray-300'];

    return (
        <div role="img" aria-label={label} className="flex h-24 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
            <div className="flex w-1/5 flex-col gap-1.5 border-e border-gray-200 bg-white p-1.5">
                <span className="h-1.5 w-full rounded-sm bg-blue-600" />
                {navDots.map((dot, i) => (
                    <span key={i} className="flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                        <span className="h-1 flex-1 rounded-sm bg-gray-200" />
                    </span>
                ))}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                {/* Section label: tiny caps in CLASSIC, a heading otherwise. */}
                <span className={polished ? 'h-1.5 w-1/3 rounded-sm bg-gray-700' : 'h-1 w-1/4 rounded-sm bg-gray-300'} />
                <div className="grid grid-cols-4 gap-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <span
                            key={i}
                            className={`flex h-7 flex-col justify-end gap-0.5 p-1 ${
                                colorful
                                    ? `rounded bg-gradient-to-br ${cards[i]}`
                                    : polished
                                        ? 'rounded border border-gray-200 bg-white'
                                        : 'rounded-md border border-gray-100 bg-white shadow-sm'
                            }`}
                        >
                            <span className={`h-1 w-3/4 rounded-sm ${colorful ? 'bg-white/90' : polished ? 'bg-gray-800' : 'bg-gray-500'}`} />
                            <span className={`h-0.5 w-1/2 rounded-sm ${colorful ? 'bg-white/50' : 'bg-gray-300'}`} />
                        </span>
                    ))}
                </div>
                <span className={`flex-1 rounded ${polished ? 'border border-gray-200' : 'border border-gray-100 shadow-sm'} bg-white`}>
                    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
                        <path
                            d="M0 24 C 15 18, 25 26, 40 16 S 70 8, 100 12"
                            fill="none"
                            className={colorful ? 'stroke-violet-500' : 'stroke-blue-500'}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                </span>
            </div>
        </div>
    );
}
