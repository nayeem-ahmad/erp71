'use client';

import { useEffect, useId, useState } from 'react';
import {
    INVOICE_FOOTER_MAX_LENGTH,
    INVOICE_SIGNATURE_SPACE_MM,
    type InvoiceBalanceMode,
    type InvoiceLayout,
    type InvoicePadding,
    type InvoicePrintPrefs,
    type InvoiceTableBorders,
    type InvoiceTableStyle,
    type InvoiceWarrantyColumn,
} from '@erp71/shared-types';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { formatMessage, useI18n } from '@/lib/i18n';

type FooterMode = 'default' | 'custom' | 'none';

/** `null` is the built-in thank-you and `''` is no footer — two different answers. */
function footerMode(text: string | null): FooterMode {
    if (text === null) return 'default';
    return text === '' ? 'none' : 'custom';
}

/** Typed mm as a gap the printer takes, `null` for blank, or `undefined` when it is neither. */
function parseSignatureSpace(text: string): number | null | undefined {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) return undefined;
    const mm = Number(trimmed);
    const { min, max } = INVOICE_SIGNATURE_SPACE_MM;
    return mm >= min && mm <= max ? mm : undefined;
}

export interface InvoiceLayoutFieldsProps {
    value: InvoicePrintPrefs;
    onChange: (next: InvoicePrintPrefs) => void;
    /** Told whenever the fields start or stop holding something that can be saved. */
    onValidityChange?: (valid: boolean) => void;
}

/**
 * The member's own invoice layout, as form controls. Controlled, so the modal
 * holding it decides when anything is saved.
 */
export default function InvoiceLayoutFields({ value, onChange, onValidityChange }: InvoiceLayoutFieldsProps) {
    const { t } = useI18n();
    const copy = t.sales.printSettings.invoiceLayout;
    const id = useId();

    const set = <K extends keyof InvoicePrintPrefs>(key: K, next: InvoicePrintPrefs[K]) =>
        onChange({ ...value, [key]: next });

    // Held apart from `footer_text`: a custom footer the member has not typed
    // yet is empty, and read back it would look like "no footer" and close the
    // box they are about to type in. Saved empty, it does mean no footer.
    const [mode, setMode] = useState<FooterMode>(() => footerMode(value.footer_text));
    const [customText, setCustomText] = useState(mode === 'custom' ? (value.footer_text ?? '') : '');

    // Held as typed, so a half-typed or out-of-range gap stays on screen with
    // its error instead of snapping back; only a usable one reaches the layout.
    const [spaceText, setSpaceText] = useState(value.signature_space_mm == null ? '' : String(value.signature_space_mm));
    const spaceInvalid = parseSignatureSpace(spaceText) === undefined;
    // A bad gap only blocks saving while its field is on screen to fix.
    const valid = !(value.signature_lines && spaceInvalid);
    useEffect(() => {
        onValidityChange?.(valid);
    }, [valid, onValidityChange]);

    const toggles: { key: 'amount_in_words' | 'serial_column' | 'signature_lines' | 'hide_empty_discount'; label: string }[] = [
        { key: 'amount_in_words', label: copy.amountInWords },
        { key: 'serial_column', label: copy.serialColumn },
        { key: 'signature_lines', label: copy.signatureLines },
        { key: 'hide_empty_discount', label: copy.hideEmptyDiscount },
    ];

    return (
        <div className="space-y-4">
            <Field label={copy.layoutLabel} htmlFor={`${id}-layout`} hint={copy.layoutHint}>
                <Select
                    id={`${id}-layout`}
                    value={value.layout}
                    onChange={(e) => set('layout', e.target.value as InvoiceLayout)}
                >
                    <option value="standard">{copy.layoutStandard}</option>
                    <option value="detailed">{copy.layoutDetailed}</option>
                </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={copy.paddingLabel} htmlFor={`${id}-padding`}>
                    <Select
                        id={`${id}-padding`}
                        value={value.padding}
                        onChange={(e) => set('padding', e.target.value as InvoicePadding)}
                    >
                        <option value="narrow">{copy.paddingNarrow}</option>
                        <option value="normal">{copy.paddingNormal}</option>
                        <option value="wide">{copy.paddingWide}</option>
                    </Select>
                </Field>

                <Field label={copy.tableStyleLabel} htmlFor={`${id}-table`} hint={copy.tableStyleHint}>
                    <Select
                        id={`${id}-table`}
                        value={value.table_style}
                        onChange={(e) => set('table_style', e.target.value as InvoiceTableStyle)}
                    >
                        <option value="minimal">{copy.tableMinimal}</option>
                        <option value="striped">{copy.tableStriped}</option>
                        <option value="grid">{copy.tableGrid}</option>
                        <option value="shaded-header">{copy.tableShadedHeader}</option>
                    </Select>
                </Field>
            </div>

            <Field label={copy.balanceLabel} htmlFor={`${id}-balance`} hint={copy.balanceHint}>
                <Select
                    id={`${id}-balance`}
                    value={value.balance}
                    onChange={(e) => set('balance', e.target.value as InvoiceBalanceMode)}
                >
                    <option value="when-owed">{copy.balanceWhenOwed}</option>
                    <option value="always">{copy.balanceAlways}</option>
                    <option value="never">{copy.balanceNever}</option>
                </Select>
            </Field>

            <Field label={copy.warrantyColumnLabel} htmlFor={`${id}-warranty`}>
                <Select
                    id={`${id}-warranty`}
                    value={value.warranty_column}
                    onChange={(e) => set('warranty_column', e.target.value as InvoiceWarrantyColumn)}
                >
                    <option value="always">{copy.warrantyAlways}</option>
                    <option value="when-used">{copy.warrantyWhenUsed}</option>
                    <option value="never">{copy.warrantyNever}</option>
                </Select>
            </Field>

            <Field label={copy.tableBordersLabel} htmlFor={`${id}-borders`}>
                <Select
                    id={`${id}-borders`}
                    value={value.table_borders}
                    onChange={(e) => set('table_borders', e.target.value as InvoiceTableBorders)}
                >
                    <option value="none">{copy.tableBordersNone}</option>
                    <option value="columns">{copy.tableBordersColumns}</option>
                </Select>
            </Field>

            <div className="space-y-2">
                {toggles.map(({ key, label }) => (
                    <label key={key} className="flex min-h-touch cursor-pointer items-center gap-3 sm:min-h-0">
                        <Checkbox checked={value[key]} onChange={(e) => set(key, e.target.checked)} />
                        <span className="text-sm text-gray-700">{label}</span>
                    </label>
                ))}
            </div>

            {value.signature_lines && (
                <Field
                    label={copy.signatureSpaceLabel}
                    htmlFor={`${id}-signature-space`}
                    hint={copy.signatureSpaceHint}
                    error={spaceInvalid ? formatMessage(copy.signatureSpaceError, INVOICE_SIGNATURE_SPACE_MM) : undefined}
                >
                    <Input
                        id={`${id}-signature-space`}
                        type="number"
                        inputMode="numeric"
                        min={INVOICE_SIGNATURE_SPACE_MM.min}
                        max={INVOICE_SIGNATURE_SPACE_MM.max}
                        step={1}
                        className="w-32"
                        placeholder={copy.signatureSpaceDefault}
                        value={spaceText}
                        error={spaceInvalid}
                        onChange={(e) => {
                            setSpaceText(e.target.value);
                            const mm = parseSignatureSpace(e.target.value);
                            if (mm !== undefined) set('signature_space_mm', mm);
                        }}
                    />
                </Field>
            )}

            <Field label={copy.footerLabel} htmlFor={`${id}-footer`}>
                <Select
                    id={`${id}-footer`}
                    value={mode}
                    onChange={(e) => {
                        const next = e.target.value as FooterMode;
                        setMode(next);
                        set('footer_text', next === 'default' ? null : next === 'none' ? '' : customText);
                    }}
                >
                    <option value="default">{copy.footerDefault}</option>
                    <option value="custom">{copy.footerCustom}</option>
                    <option value="none">{copy.footerNone}</option>
                </Select>
            </Field>

            {mode === 'custom' && (
                <Textarea
                    aria-label={copy.footerCustom}
                    rows={3}
                    maxLength={INVOICE_FOOTER_MAX_LENGTH}
                    placeholder={copy.footerPlaceholder}
                    value={customText}
                    onChange={(e) => {
                        setCustomText(e.target.value);
                        set('footer_text', e.target.value);
                    }}
                />
            )}
        </div>
    );
}
