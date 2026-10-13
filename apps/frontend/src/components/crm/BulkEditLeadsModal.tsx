'use client';

import { useId, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '../ModalShell';
import { Button, Field, Input, Select } from '@/components/ui';
import type { BulkLeadChanges } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LEAD_PRIORITIES } from './lead-form-fields';

/** The "Unassigned" / "None" choice; `''` means nothing is chosen yet. */
const NONE = '__none__';
/** Custom fields are picked as `cf:<key>`, the fixed fields by name. */
const CUSTOM_PREFIX = 'cf:';

type FixedField = 'status' | 'owner' | 'category' | 'source' | 'priority';

/**
 * The leads list's "Edit field": one field, one value, set on every selected
 * lead.
 *
 * One field at a time rather than a form of them: what people reach for is
 * "give these to Rifat" or "these are all from the trade fair", and a single
 * picker keeps the bulk bar to one button however many custom fields a tenant
 * has. The page sends the change and reports what the server applied.
 */
export default function BulkEditLeadsModal({
    count,
    stages,
    members,
    categories,
    sources,
    customFields,
    busy,
    onSubmit,
    onClose,
}: {
    count: number;
    /** Open stages only — a bulk edit cannot supply a lost reason or a customer. */
    stages: { value: string; label: string }[];
    members: { id: string; label: string }[];
    categories: { id: string; name: string }[];
    sources: { id: string; name: string }[];
    customFields: { key: string; label: string }[];
    busy: boolean;
    onSubmit: (changes: BulkLeadChanges) => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const b = m.bulk;
    const id = useId();

    const [field, setField] = useState('');
    const [value, setValue] = useState('');

    const customKey = field.startsWith(CUSTOM_PREFIX) ? field.slice(CUSTOM_PREFIX.length) : null;
    // An empty custom field is a choice — it clears the value — so only the
    // pickers need something chosen.
    const ready = Boolean(field) && (customKey !== null || Boolean(value));

    const changes = (): BulkLeadChanges => {
        if (customKey !== null) return { custom_fields: { [customKey]: value.trim() } };
        switch (field as FixedField) {
            case 'status':
                return { status_id: value };
            case 'owner':
                return { assigned_to: value === NONE ? null : value };
            case 'category':
                return { category: value === NONE ? '' : value };
            case 'source':
                return { source: value };
            case 'priority':
                return { priority: value };
        }
    };

    const pickField = (next: string) => {
        setField(next);
        setValue('');
    };

    const choices = (): { options: { value: string; label: string }[]; hint?: string } => {
        switch (field as FixedField) {
            case 'status':
                return { options: stages, hint: b.statusHint };
            case 'owner':
                return {
                    options: [
                        { value: NONE, label: m.fields.unassigned },
                        ...members.map((mem) => ({ value: mem.id, label: mem.label })),
                    ],
                };
            case 'category':
                return {
                    options: [
                        { value: NONE, label: m.noCategory },
                        ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                    ],
                };
            case 'source':
                return { options: sources.map((s) => ({ value: s.id, label: s.name })) };
            case 'priority':
                return {
                    options: LEAD_PRIORITIES.map((p) => ({
                        value: p,
                        label: (m.priorities as Record<string, string>)[p] ?? p,
                    })),
                };
            default:
                return { options: [] };
        }
    };

    const valueId = `${id}-value`;
    const picker = field && customKey === null ? choices() : null;

    return (
        <ModalShell size="sm" onBackdropClick={busy ? undefined : onClose} dismissOnBackdrop={!field}>
            <ModalHeader
                title={b.title.replace('{count}', String(count))}
                subtitle={b.hint}
                onClose={busy ? undefined : onClose}
            />
            <div className="space-y-3 overflow-y-auto p-4">
                <Field label={b.field} htmlFor={`${id}-field`}>
                    <Select
                        id={`${id}-field`}
                        value={field}
                        disabled={busy}
                        onChange={(e) => pickField(e.target.value)}
                    >
                        <option value="">{b.chooseField}</option>
                        <option value="status">{m.columns.status}</option>
                        <option value="owner">{m.fields.owner}</option>
                        <option value="category">{m.fields.category}</option>
                        <option value="source">{m.columns.source}</option>
                        <option value="priority">{m.fields.priority}</option>
                        {customFields.length > 0 && (
                            <optgroup label={b.customFields}>
                                {customFields.map((def) => (
                                    <option key={def.key} value={`${CUSTOM_PREFIX}${def.key}`}>
                                        {def.label}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                    </Select>
                </Field>

                {picker && (
                    <Field label={b.value} htmlFor={valueId} hint={picker.hint}>
                        <Select
                            id={valueId}
                            value={value}
                            disabled={busy}
                            onChange={(e) => setValue(e.target.value)}
                        >
                            <option value="">{b.chooseValue}</option>
                            {picker.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                )}

                {customKey !== null && (
                    <Field label={b.value} htmlFor={valueId} hint={b.customFieldHint}>
                        <Input
                            id={valueId}
                            value={value}
                            disabled={busy}
                            onChange={(e) => setValue(e.target.value)}
                        />
                    </Field>
                )}
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button onClick={() => onSubmit(changes())} loading={busy} disabled={busy || !ready}>
                    {b.apply.replace('{count}', String(count))}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
