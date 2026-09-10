'use client';

import { useRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { HEADER_TOKENS, type HeaderLine, type PrintFontFamily, type TemplateImage } from '@/lib/print';
import { useI18n } from '@/lib/i18n';

/**
 * The editing blocks the header band and the footer band share.
 *
 * Both bands are built from the same two lists — formatted text lines and
 * images — so the editors live here once rather than being duplicated per band.
 */

const ALIGNS: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
const FONTS: PrintFontFamily[] = ['sans', 'serif', 'mono', 'bengali'];

/* ------------------------------------------------------------------ */
/*  Text lines                                                         */
/* ------------------------------------------------------------------ */

interface LineListEditorProps {
    lines: HeaderLine[];
    /** Shown as the placeholder size when a line has no size of its own. */
    baseFontSizePt: number;
    onChange: (lines: HeaderLine[]) => void;
}

export function LineListEditor({ lines, baseFontSizePt, onChange }: LineListEditorProps) {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const fields = copy.fields;

    const patchLine = (index: number, changes: Partial<HeaderLine>) =>
        onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));

    const moveLine = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= lines.length) return;
        const next = [...lines];
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    return (
        <>
            <p className="text-xs text-gray-400">{fields.tokensHint}</p>
            <p className="text-xs text-gray-400">
                {HEADER_TOKENS.map((token) => `{{${token}}}`).join('  ')}
            </p>

            {lines.map((line, index) => (
                <div key={index} className="space-y-2 rounded-md border border-gray-200 p-2.5">
                    <div className="flex items-start gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            aria-label={fields.lineText}
                            value={line.text}
                            onChange={(e) => patchLine(index, { text: e.target.value })}
                        />
                        <IconButton
                            label={fields.moveUp}
                            onClick={() => moveLine(index, -1)}
                            disabled={index === 0}
                        >
                            <ArrowUp className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                            label={fields.moveDown}
                            onClick={() => moveLine(index, 1)}
                            disabled={index === lines.length - 1}
                        >
                            <ArrowDown className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                            label={fields.removeLine}
                            onClick={() => onChange(lines.filter((_, i) => i !== index))}
                        >
                            <Trash2 className="h-4 w-4 text-red-600" />
                        </IconButton>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <NumberField
                            label={fields.fontSize}
                            value={line.fontSizePt ?? baseFontSizePt}
                            min={5}
                            max={48}
                            onChange={(fontSizePt) => patchLine(index, { fontSizePt })}
                        />
                        <Field label={fields.align}>
                            <Select
                                value={line.align ?? 'left'}
                                onChange={(e) => patchLine(index, { align: e.target.value as HeaderLine['align'] })}
                            >
                                {ALIGNS.map((align) => (
                                    <option key={align} value={align}>{copy.aligns[align]}</option>
                                ))}
                            </Select>
                        </Field>
                        <ColorField
                            label={fields.color}
                            value={line.color ?? '#555555'}
                            onChange={(color) => patchLine(index, { color })}
                        />
                        <Field label={fields.lineFont}>
                            <Select
                                value={line.fontFamily ?? ''}
                                onChange={(e) =>
                                    patchLine(index, {
                                        // Empty means "inherit the template font" rather than a font of its own.
                                        fontFamily: (e.target.value || undefined) as PrintFontFamily | undefined,
                                    })
                                }
                            >
                                <option value="">{fields.lineFontDefault}</option>
                                {FONTS.map((font) => (
                                    <option key={font} value={font}>{copy.fonts[font]}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <NumberField
                            label={fields.letterSpacing}
                            value={line.letterSpacingPx ?? 0}
                            min={0}
                            max={10}
                            onChange={(letterSpacingPx) => patchLine(index, { letterSpacingPx })}
                        />
                        <div className="col-span-1 flex items-end gap-3 pb-1.5 sm:col-span-3">
                            <CheckboxRow
                                label={fields.bold}
                                checked={!!line.bold}
                                onChange={(bold) => patchLine(index, { bold })}
                            />
                            <CheckboxRow
                                label={fields.italic}
                                checked={!!line.italic}
                                onChange={(italic) => patchLine(index, { italic })}
                            />
                            <CheckboxRow
                                label={fields.underline}
                                checked={!!line.underline}
                                onChange={(underline) => patchLine(index, { underline })}
                            />
                        </div>
                    </div>
                </div>
            ))}

            <Button
                type="button"
                variant="secondary"
                onClick={() => onChange([...lines, { text: '', fontSizePt: baseFontSizePt }])}
            >
                {fields.addLine}
            </Button>
        </>
    );
}

/* ------------------------------------------------------------------ */
/*  Images                                                             */
/* ------------------------------------------------------------------ */

interface ImageListEditorProps {
    images: TemplateImage[];
    onChange: (images: TemplateImage[]) => void;
    /** Resolves to the uploaded URL, or null when the upload failed. */
    onUpload: (file: File) => Promise<string | null>;
    uploading: boolean;
}

export function ImageListEditor({ images, onChange, onUpload, uploading }: ImageListEditorProps) {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const fields = copy.fields;

    const patchImage = (index: number, changes: Partial<TemplateImage>) =>
        onChange(images.map((image, i) => (i === index ? { ...image, ...changes } : image)));

    return (
        <>
            <p className="text-xs text-gray-400">{fields.imagesHint}</p>

            {images.map((image, index) => (
                <div key={index} className="space-y-2 rounded-md border border-gray-200 p-2.5">
                    <div className="flex items-start gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            aria-label={fields.imageUrl}
                            value={image.url ?? ''}
                            placeholder={fields.logoPlaceholder}
                            onChange={(e) => patchImage(index, { url: e.target.value })}
                        />
                        <UploadButton
                            uploading={uploading}
                            onFile={async (file) => {
                                const url = await onUpload(file);
                                if (url) patchImage(index, { url });
                            }}
                        />
                        <IconButton
                            label={fields.removeImage}
                            onClick={() => onChange(images.filter((_, i) => i !== index))}
                        >
                            <Trash2 className="h-4 w-4 text-red-600" />
                        </IconButton>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <NumberField
                            label={fields.imageHeight}
                            value={image.heightMm}
                            min={3}
                            max={60}
                            onChange={(heightMm) => patchImage(index, { heightMm })}
                        />
                        <Field label={fields.align}>
                            <Select
                                value={image.align ?? 'left'}
                                onChange={(e) => patchImage(index, { align: e.target.value as TemplateImage['align'] })}
                            >
                                {ALIGNS.map((align) => (
                                    <option key={align} value={align}>{copy.aligns[align]}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={fields.imageCaption}>
                            <Input
                                value={image.caption ?? ''}
                                placeholder={fields.imageCaptionPlaceholder}
                                onChange={(e) => patchImage(index, { caption: e.target.value })}
                            />
                        </Field>
                    </div>

                    <CheckboxRow
                        label={fields.imageShowOnThermal}
                        checked={!!image.showOnThermal}
                        onChange={(showOnThermal) => patchImage(index, { showOnThermal })}
                    />
                </div>
            ))}

            <Button
                type="button"
                variant="secondary"
                onClick={() => onChange([...images, { heightMm: 14, align: 'left' }])}
            >
                {fields.addImage}
            </Button>
        </>
    );
}

/** File picker styled as a button — the hidden input is an implementation detail. */
export function UploadButton({
    uploading,
    onFile,
}: {
    uploading: boolean;
    onFile: (file: File) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const { t } = useI18n();
    const fields = t.settingsExtras.printTemplates.fields;

    return (
        <>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFile(file);
                    // Cleared so picking the same file twice still fires a change.
                    e.target.value = '';
                }}
            />
            <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
            >
                <Upload className="h-4 w-4" />
                {uploading ? fields.uploading : fields.upload}
            </Button>
        </>
    );
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
            <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
            {children}
        </section>
    );
}

export function CheckboxRow({
    label,
    checked,
    onChange,
    className = '',
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
}) {
    return (
        <label className={`flex cursor-pointer items-center gap-2 ${className}`}>
            <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span className="text-xs text-gray-700">{label}</span>
        </label>
    );
}

export function NumberField({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}) {
    return (
        <Field label={label}>
            <Input
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={(e) => {
                    const next = Number(e.target.value);
                    // Ignore a cleared input rather than writing NaN into the config.
                    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
                }}
            />
        </Field>
    );
}

export function ColorField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <Field label={label}>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    aria-label={label}
                    value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                />
                <Input
                    className="min-w-0 flex-1 font-mono"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>
        </Field>
    );
}

export function IconButton({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40 max-md:min-h-touch max-md:min-w-touch"
        >
            {children}
        </button>
    );
}
