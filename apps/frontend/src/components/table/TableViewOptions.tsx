'use client';

import { useId, useRef, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { useDismissable } from '@/hooks/useDismissable';
import { useI18n } from '@/lib/i18n';
import { useTableViewSettings } from './useTableViewSettings';
import {
    TABLE_DENSITIES,
    TABLE_FONT_SIZES,
    TABLE_STRIPE_FILLS,
    TABLE_STRIPE_PRESETS,
    type TableDensity,
    type TableFontSize,
    type TableStripeColor,
    type TableStripePreset,
} from './view-settings';

/**
 * A row of mutually exclusive choices, each a pressed/unpressed button. Also
 * drawn by the preference profile editor, so a profile's list look is set with
 * the same control a member uses.
 */
export function Segmented<K extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: readonly { key: K; label: string; title?: string }[];
    value: K;
    onChange: (next: K) => void;
}) {
    return (
        <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col rounded-md border border-gray-200 p-0.5">
                {options.map((option) => (
                    <button
                        key={option.key}
                        type="button"
                        aria-pressed={value === option.key}
                        title={option.title}
                        onClick={() => onChange(option.key)}
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors max-md:min-h-touch ${
                            value === option.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** What the custom swatch's colour picker opens on before one is chosen: a pale violet, so it reads as "pick your own". */
const CUSTOM_STRIPE_START = '#f3f0ff';

/**
 * The stripe colour: five tints and a custom colour. Also drawn by the
 * preference profile editor, so a profile's list look is set with the same
 * control a member uses.
 */
export function StripeColorPicker({
    value,
    onChange,
    disabled = false,
}: {
    value: TableStripeColor;
    onChange: (next: TableStripeColor) => void;
    /** Striping is off: the colour is kept, but there is nothing to colour. */
    disabled?: boolean;
}) {
    const { t } = useI18n();
    const copy = t.common.dataTable.view;
    const labelId = useId();
    const isCustom = !(TABLE_STRIPE_PRESETS as readonly string[]).includes(value);
    const ring = (selected: boolean) =>
        `relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors max-md:min-h-touch max-md:min-w-touch ${
            selected ? 'border-blue-600' : 'border-transparent hover:border-gray-300'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`;
    return (
        <div className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
            <p id={labelId} className="text-xs font-medium text-gray-500">{copy.stripeColor}</p>
            <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1">
                {TABLE_STRIPE_PRESETS.map((preset: TableStripePreset) => (
                    <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={value === preset}
                        aria-label={copy.stripeColors[preset]}
                        title={copy.stripeColors[preset]}
                        disabled={disabled}
                        onClick={() => onChange(preset)}
                        className={ring(value === preset)}
                    >
                        <span aria-hidden className="h-5 w-5 rounded-full border border-gray-300" style={{ backgroundColor: TABLE_STRIPE_FILLS[preset] }} />
                    </button>
                ))}
                <label title={copy.stripeColors.custom} className={ring(isCustom)}>
                    <span
                        aria-hidden
                        className={`flex h-5 w-5 items-center justify-center rounded-full border text-gray-400 ${isCustom ? 'border-gray-300' : 'border-dashed border-gray-300'}`}
                        style={isCustom ? { backgroundColor: value } : undefined}
                    >
                        {isCustom ? null : <Plus className="h-3 w-3" />}
                    </span>
                    <input
                        type="color"
                        aria-label={copy.stripeColors.custom}
                        value={isCustom ? value : CUSTOM_STRIPE_START}
                        disabled={disabled}
                        onChange={(e) => onChange(e.target.value.toLowerCase() as TableStripeColor)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    />
                </label>
            </div>
        </div>
    );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void }) {
    const id = useId();
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p id={id} className="text-sm text-gray-700">{label}</p>
                {hint ? <p className="text-xs text-gray-400">{hint}</p> : null}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={id} />
        </div>
    );
}

/**
 * A list that can also be read in another shape — a day ledger, an agenda —
 * offers the choice at the top of its View options rather than as a switch of
 * its own above the list.
 */
export interface TableViewLayout {
    label: string;
    options: readonly { key: string; label: string }[];
    value: string;
    onChange: (next: string) => void;
}

/**
 * The toolbar button that opens a list's view settings: row spacing, text
 * size, striping and its colour, and fit-to-width. Changes apply to every list unless the
 * person sets this one apart with "This list only".
 */
export function TableViewOptions({
    tableId,
    buttonClassName,
    iconOnly = true,
    layout,
    showTableSettings = true,
}: {
    tableId: string;
    buttonClassName: string;
    iconOnly?: boolean;
    layout?: TableViewLayout;
    /** False under a layout that is not a table, where row spacing and text size draw nothing. */
    showTableSettings?: boolean;
}) {
    const { t } = useI18n();
    const copy = t.common.dataTable.view;
    const { settings, isOverridden, update, setOverride, reset } = useTableViewSettings(tableId);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    useDismissable(rootRef, () => setOpen(false), open);

    const densityOptions = TABLE_DENSITIES.map((key: TableDensity) => ({ key, label: copy.densities[key] }));
    const fontOptions = TABLE_FONT_SIZES.map((key: TableFontSize) => ({
        key,
        label: copy.fontSizes[key],
        title: copy.fontSizeTitles[key],
    }));

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={buttonClassName}
                title={copy.title}
                aria-label={copy.title}
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                <Settings2 className="w-3.5 h-3.5" />
                <span className={iconOnly ? 'sr-only' : undefined}>{copy.title}</span>
            </button>
            {open ? (
                <div
                    role="dialog"
                    aria-label={copy.title}
                    className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                >
                    {layout ? (
                        <Segmented label={layout.label} options={layout.options} value={layout.value} onChange={layout.onChange} />
                    ) : null}
                    {showTableSettings ? (
                        <>
                            <Segmented label={copy.density} options={densityOptions} value={settings.density} onChange={(density) => update({ density })} />
                            <Segmented label={copy.fontSize} options={fontOptions} value={settings.fontSize} onChange={(fontSize) => update({ fontSize })} />
                            <div className="space-y-2.5 border-t border-gray-100 pt-3">
                                <ToggleRow label={copy.striped} checked={settings.striped} onChange={(striped) => update({ striped })} />
                                <StripeColorPicker
                                    value={settings.stripeColor}
                                    onChange={(stripeColor) => update({ stripeColor })}
                                    disabled={!settings.striped}
                                />
                                <ToggleRow
                                    label={copy.fitWidth}
                                    hint={copy.fitWidthHint}
                                    checked={settings.fitWidth}
                                    onChange={(fitWidth) => update({ fitWidth })}
                                />
                            </div>
                            <div className="space-y-2.5 border-t border-gray-100 pt-3">
                                <ToggleRow
                                    label={copy.thisListOnly}
                                    hint={isOverridden ? copy.thisListOnlyOn : copy.thisListOnlyOff}
                                    checked={isOverridden}
                                    onChange={setOverride}
                                />
                                <button type="button" onClick={reset} className="text-xs font-medium text-blue-600 hover:underline">
                                    {copy.reset}
                                </button>
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
