'use client';

import { Field, Input, Select } from '@/components/ui';
import type {
    HeaderLayout,
    PrintDocType,
    PrintFontFamily,
    PrintFooterConfig,
    PrintHeaderConfig,
} from '@/lib/print';
import { useI18n } from '@/lib/i18n';
import {
    CheckboxRow,
    ColorField,
    ImageListEditor,
    LineListEditor,
    NumberField,
    Section,
    UploadButton,
} from './TemplateBlocks';

const LAYOUTS: HeaderLayout[] = ['logo-left', 'logo-right', 'logo-center', 'logo-above', 'text-only'];
const FONTS: PrintFontFamily[] = ['sans', 'serif', 'mono', 'bengali'];
const DOC_TYPES: PrintDocType[] = [
    'SALES_INVOICE',
    'POS_RECEIPT',
    'QUOTE',
    'PROFORMA_INVOICE',
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
    /** Resolves to the uploaded URL, or null when the upload failed. */
    onUpload: (file: File) => Promise<string | null>;
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
    onUpload,
    uploading,
}: HeaderEditorProps) {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const fields = copy.fields;

    const patch = (changes: Partial<PrintHeaderConfig>) => onConfigChange({ ...config, ...changes });
    const patchFooter = (changes: Partial<PrintFooterConfig>) =>
        patch({ footer: { ...config.footer, ...changes } });

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
                        <UploadButton
                            uploading={uploading}
                            onFile={async (file) => {
                                const url = await onUpload(file);
                                if (url) patch({ logo: { ...config.logo, url } });
                            }}
                        />
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
                <LineListEditor
                    lines={config.lines}
                    baseFontSizePt={config.baseFontSizePt}
                    onChange={(lines) => patch({ lines })}
                />
            </Section>

            <Section title={copy.sections.images}>
                <ImageListEditor
                    images={config.images ?? []}
                    onChange={(images) => patch({ images })}
                    onUpload={onUpload}
                    uploading={uploading}
                />
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

            <Section title={copy.sections.footer}>
                <p className="text-xs text-gray-400">{fields.footerHint}</p>
                <CheckboxRow
                    label={fields.showFooter}
                    checked={config.footer.show}
                    onChange={(show) => patchFooter({ show })}
                />

                {config.footer.show ? (
                    <div className="space-y-3 border-t border-gray-200 pt-3">
                        <h3 className="text-xs font-semibold text-gray-600">{copy.sections.footerLines}</h3>
                        <LineListEditor
                            lines={config.footer.lines}
                            baseFontSizePt={config.baseFontSizePt}
                            onChange={(lines) => patchFooter({ lines })}
                        />

                        <h3 className="border-t border-gray-200 pt-3 text-xs font-semibold text-gray-600">
                            {copy.sections.footerImages}
                        </h3>
                        <ImageListEditor
                            images={config.footer.images ?? []}
                            onChange={(images) => patchFooter({ images })}
                            onUpload={onUpload}
                            uploading={uploading}
                        />

                        <div className="space-y-3 border-t border-gray-200 pt-3">
                            <CheckboxRow
                                label={fields.showFooterRule}
                                checked={config.footer.rule.show}
                                onChange={(show) => patchFooter({ rule: { ...config.footer.rule, show } })}
                            />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <NumberField
                                    label={fields.thickness}
                                    value={config.footer.rule.thicknessPx}
                                    min={0}
                                    max={8}
                                    onChange={(thicknessPx) =>
                                        patchFooter({ rule: { ...config.footer.rule, thicknessPx } })
                                    }
                                />
                                <ColorField
                                    label={fields.color}
                                    value={config.footer.rule.color}
                                    onChange={(color) => patchFooter({ rule: { ...config.footer.rule, color } })}
                                />
                                <NumberField
                                    label={fields.spacing}
                                    value={config.footer.spacingMm}
                                    min={0}
                                    max={30}
                                    onChange={(spacingMm) => patchFooter({ spacingMm })}
                                />
                            </div>
                            <CheckboxRow
                                label={fields.repeatFooter}
                                checked={config.footer.repeatOnEveryPage}
                                onChange={(repeatOnEveryPage) => patchFooter({ repeatOnEveryPage })}
                            />
                        </div>
                    </div>
                ) : null}
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
