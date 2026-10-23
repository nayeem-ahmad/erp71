'use client';

import { useId, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { useDismissable } from '@/hooks/useDismissable';
import { useI18n } from '@/lib/i18n';
import { useTableViewSettings } from './useTableViewSettings';
import { TABLE_DENSITIES, TABLE_FONT_SIZES, type TableDensity, type TableFontSize } from './view-settings';

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
 * The toolbar button that opens a list's view settings: row spacing, text
 * size, striping and fit-to-width. Changes apply to every list unless the
 * person sets this one apart with "This list only".
 */
export function TableViewOptions({
    tableId,
    buttonClassName,
    iconOnly = true,
}: {
    tableId: string;
    buttonClassName: string;
    iconOnly?: boolean;
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
                    <Segmented label={copy.density} options={densityOptions} value={settings.density} onChange={(density) => update({ density })} />
                    <Segmented label={copy.fontSize} options={fontOptions} value={settings.fontSize} onChange={(fontSize) => update({ fontSize })} />
                    <div className="space-y-2.5 border-t border-gray-100 pt-3">
                        <ToggleRow label={copy.striped} checked={settings.striped} onChange={(striped) => update({ striped })} />
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
                </div>
            ) : null}
        </div>
    );
}
