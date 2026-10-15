'use client';

import { useId } from 'react';
import { Button, Field, Input } from '@/components/ui';
import {
    clearPaperOverrides,
    PAPER_SIZE_FIELDS,
    PAPER_SIZE_LIMITS,
    paperOverride,
    paperSizeLabel,
    paperSizeValue,
    setPaperOverride,
} from '@/lib/print';
import type { PaperSize, PrintHeaderConfig } from '@/lib/print';
import { useI18n } from '@/lib/i18n';

interface PaperSizeOverridesProps {
    config: PrintHeaderConfig;
    /** One of `OVERRIDE_PAPERS` — A4 is the main design and has nothing to override. */
    paperSize: PaperSize;
    onConfigChange: (config: PrintHeaderConfig) => void;
}

/**
 * The sizes one paper prints at, where they differ from the main design.
 *
 * Every box starts empty, with the main design's value as its placeholder:
 * empty means "same as A4", so a later change to the main design still reaches
 * this paper. Only what is typed here is stored for it.
 */
export default function PaperSizeOverrides({ config, paperSize, onConfigChange }: PaperSizeOverridesProps) {
    const { t, fmt } = useI18n();
    const copy = t.settingsExtras.printTemplates.paperSizes;
    const titleId = useId();
    const paper = paperSizeLabel(paperSize);
    const overridden = PAPER_SIZE_FIELDS.some((field) => paperOverride(config, paperSize, field) !== undefined);

    return (
        <div role="group" aria-labelledby={titleId} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={titleId} className="text-xs font-semibold text-gray-700">
                    {fmt(copy.title, { paper })}
                </h3>
                {overridden ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onConfigChange(clearPaperOverrides(config, paperSize))}
                    >
                        {copy.reset}
                    </Button>
                ) : null}
            </div>
            <p className="text-xs text-gray-500">{fmt(copy.hint, { paper })}</p>
            {/* Bottom-aligned, so a label that wraps on a phone does not
                push its box out of line with the one beside it. */}
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
                {PAPER_SIZE_FIELDS.map((field) => (
                    <OverrideField
                        key={field}
                        label={copy.fields[field]}
                        value={paperOverride(config, paperSize, field)}
                        placeholder={paperSizeValue(config, field)}
                        {...PAPER_SIZE_LIMITS[field]}
                        // As on the main design: a full-width logo's height comes from its shape.
                        disabled={field === 'logoHeightMm' && !!config.logo.fullWidth}
                        onChange={(value) => onConfigChange(setPaperOverride(config, paperSize, field, value))}
                    />
                ))}
            </div>
        </div>
    );
}

function OverrideField({
    label,
    value,
    placeholder,
    min,
    max,
    disabled,
    onChange,
}: {
    label: string;
    value: number | undefined;
    placeholder: number;
    min: number;
    max: number;
    disabled?: boolean;
    onChange: (value: number | undefined) => void;
}) {
    const id = useId();
    return (
        <Field label={label} htmlFor={id}>
            <Input
                id={id}
                type="number"
                min={min}
                max={max}
                disabled={disabled}
                value={value ?? ''}
                placeholder={String(placeholder)}
                onChange={(e) => {
                    // An emptied box hands the size back to the main design.
                    if (e.target.value === '') {
                        onChange(undefined);
                        return;
                    }
                    // As in the main design's fields: only the maximum applies
                    // while typing, or the "2" of "25" would jump to the minimum.
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) onChange(Math.min(max, next));
                }}
                onBlur={() => {
                    if (value !== undefined && value < min) onChange(min);
                }}
            />
        </Field>
    );
}
