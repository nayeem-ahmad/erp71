'use client';

import { useRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { HEADER_TOKENS, type HeaderLayout, type HeaderLine, type PrintDocType, type PrintFontFamily, type PrintHeaderConfig } from '@/lib/print';
import { useI18n } from '@/lib/i18n';

const LAYOUTS: HeaderLayout[] = ['logo-left', 'logo-right', 'logo-center', 'logo-above', 'text-only'];
const FONTS: PrintFontFamily[] = ['sans', 'serif', 'mono', 'bengali'];
const ALIGNS: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
const DOC_TYPES: PrintDocType[] = [
    'SALES_INVOICE',
    'POS_RECEIPT',
    'QUOTE',
    'VOUCHER',
    'MONEY_RECEIPT',
    'SALES_ORDER',
    'SALES_RETURN',
    'PURCHASE_ORDER',
    'PURCHASE_RETURN',
    'LIST_REPORT',
    'PAYSLIP',
];

interface HeaderEditorProps {
    name: string;
    onNameChange: (name: string) => void;
    isDefault: boolean;
    onIsDefaultChange: (isDefault: boolean) => void;
    docTypes: PrintDocType[];
    onDocTypesChange: (docTypes: PrintDocType[]) => void;
    config: PrintHeaderConfig;
    onConfigChange: (config: PrintHeaderConfig) => void;
    onUploadLogo: (file: File) => void;
    uploading: boolean;
}

export default function HeaderEditor({
    name,
    onNameChange,
    isDefault,
    onIsDefaultChange,
    docTypes,
    onDocTypesChange,
    config,
    onConfigChange,
    onUploadLogo,
    uploading,
}: HeaderEditorProps) {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const fields = copy.fields;
    const fileRef = useRef<HTMLInputElement>(null);

    const patch = (changes: Partial<PrintHeaderConfig>) => onConfigChange({ ...config, ...changes });
    const patchLine = (index: number, changes: Partial<HeaderLine>) =>
        patch({ lines: config.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)) });

    const moveLine = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= config.lines.length) return;
        const lines = [...config.lines];
        [lines[index], lines[target]] = [lines[target], lines[index]];
        patch({ lines });
    };

    const toggleDocType = (docType: PrintDocType) =>
        onDocTypesChange(
            docTypes.includes(docType)
                ? docTypes.filter((value) => value !== docType)
                : [...docTypes, docType],
        );

    return (
        <div className="space-y-4">
            <Section title={copy.sections.template}>
                <Field label={fields.name}>
                    <Input
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder={fields.namePlaceholder}
                    />
                </Field>

                <CheckboxRow
                    label={fields.isDefault}
                    checked={isDefault}
                    onChange={onIsDefaultChange}
                />

                <Field label={fields.docTypes} hint={fields.docTypesHint}>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {DOC_TYPES.map((docType) => (
                            <CheckboxRow
                                key={docType}
                                label={copy.docTypes[docType]}
                                checked={docTypes.includes(docType)}
                                onChange={() => toggleDocType(docType)}
                            />
                        ))}
                    </div>
                </Field>
            </Section>

            <Section title={copy.sections.logo}>
                <Field label={fields.logoUrl}>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            value={config.logo.url ?? ''}
                            onChange={(e) => patch({ logo: { ...config.logo, url: e.target.value } })}
                            placeholder={fields.logoPlaceholder}
                        />
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onUploadLogo(file);
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
                    </div>
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                        label={fields.logoHeight}
                        value={config.logo.heightMm}
                        min={3}
                        max={60}
                        onChange={(heightMm) => patch({ logo: { ...config.logo, heightMm } })}
                    />
                    <Field label={fields.layout}>
                        <Select
                            value={config.layout}
                            onChange={(e) => patch({ layout: e.target.value as HeaderLayout })}
                        >
                            {LAYOUTS.map((layout) => (
                                <option key={layout} value={layout}>{copy.layouts[layout]}</option>
                            ))}
                        </Select>
                    </Field>
                </div>

                <CheckboxRow
                    label={fields.showOnThermal}
                    checked={config.logo.showOnThermal}
                    onChange={(showOnThermal) => patch({ logo: { ...config.logo, showOnThermal } })}
                />
            </Section>

            <Section title={copy.sections.company}>
                <CheckboxRow
                    label={fields.showCompany}
                    checked={config.company.show}
                    onChange={(show) => patch({ company: { ...config.company, show } })}
                />
                <Field label={fields.nameOverride}>
                    <Input
                        value={config.company.nameOverride ?? ''}
                        onChange={(e) => patch({ company: { ...config.company, nameOverride: e.target.value } })}
                        placeholder={fields.nameOverridePlaceholder}
                    />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <NumberField
                        label={fields.fontSize}
                        value={config.company.fontSizePt}
                        min={6}
                        max={48}
                        onChange={(fontSizePt) => patch({ company: { ...config.company, fontSizePt } })}
                    />
                    <ColorField
                        label={fields.color}
                        value={config.company.color}
                        onChange={(color) => patch({ company: { ...config.company, color } })}
                    />
                    <CheckboxRow
                        className="self-end pb-1.5"
                        label={fields.bold}
                        checked={config.company.bold}
                        onChange={(bold) => patch({ company: { ...config.company, bold } })}
                    />
                </div>
            </Section>

            <Section title={copy.sections.docTitle}>
                <CheckboxRow
                    label={fields.showTitle}
                    checked={config.title.show}
                    onChange={(show) => patch({ title: { ...config.title, show } })}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <NumberField
                        label={fields.fontSize}
                        value={config.title.fontSizePt}
                        min={6}
                        max={48}
                        onChange={(fontSizePt) => patch({ title: { ...config.title, fontSizePt } })}
                    />
                    <NumberField
                        label={fields.letterSpacing}
                        value={config.title.letterSpacingPx}
                        min={0}
                        max={10}
                        onChange={(letterSpacingPx) => patch({ title: { ...config.title, letterSpacingPx } })}
                    />
                    <ColorField
                        label={fields.color}
                        value={config.title.color}
                        onChange={(color) => patch({ title: { ...config.title, color } })}
                    />
                </div>
                <CheckboxRow
                    label={fields.uppercase}
                    checked={config.title.uppercase}
                    onChange={(uppercase) => patch({ title: { ...config.title, uppercase } })}
                />
            </Section>

            <Section title={copy.sections.lines}>
                <p className="text-xs text-gray-400">{fields.tokensHint}</p>
                <p className="text-xs text-gray-400">
                    {HEADER_TOKENS.map((token) => `{{${token}}}`).join('  ')}
                </p>

                {config.lines.map((line, index) => (
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
                                disabled={index === config.lines.length - 1}
                            >
                                <ArrowDown className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                                label={fields.removeLine}
                                onClick={() => patch({ lines: config.lines.filter((_, i) => i !== index) })}
                            >
                                <Trash2 className="h-4 w-4 text-red-600" />
                            </IconButton>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <NumberField
                                label={fields.fontSize}
                                value={line.fontSizePt ?? config.baseFontSizePt}
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
                            <div className="flex items-end gap-3 pb-1.5">
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
                            </div>
                        </div>
                    </div>
                ))}

                <Button
                    type="button"
                    variant="secondary"
                    onClick={() => patch({ lines: [...config.lines, { text: '', fontSizePt: config.baseFontSizePt }] })}
                >
                    {fields.addLine}
                </Button>
            </Section>

            <Section title={copy.sections.rule}>
                <CheckboxRow
                    label={fields.showRule}
                    checked={config.rule.show}
                    onChange={(show) => patch({ rule: { ...config.rule, show } })}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                        label={fields.thickness}
                        value={config.rule.thicknessPx}
                        min={0}
                        max={8}
                        onChange={(thicknessPx) => patch({ rule: { ...config.rule, thicknessPx } })}
                    />
                    <ColorField
                        label={fields.color}
                        value={config.rule.color}
                        onChange={(color) => patch({ rule: { ...config.rule, color } })}
                    />
                </div>
            </Section>

            <Section title={copy.sections.typography}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={fields.fontFamily}>
                        <Select
                            value={config.fontFamily}
                            onChange={(e) => patch({ fontFamily: e.target.value as PrintFontFamily })}
                        >
                            {FONTS.map((font) => (
                                <option key={font} value={font}>{copy.fonts[font]}</option>
                            ))}
                        </Select>
                    </Field>
                    <NumberField
                        label={fields.baseFontSize}
                        value={config.baseFontSizePt}
                        min={5}
                        max={24}
                        onChange={(baseFontSizePt) => patch({ baseFontSizePt })}
                    />
                    <NumberField
                        label={fields.spacing}
                        value={config.spacingMm}
                        min={0}
                        max={30}
                        onChange={(spacingMm) => patch({ spacingMm })}
                    />
                </div>
            </Section>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
            <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
            {children}
        </section>
    );
}

function CheckboxRow({
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

function NumberField({
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

function ColorField({
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

function IconButton({
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
