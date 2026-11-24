'use client';

import { useMemo, useState } from 'react';
import { Field, Input } from '@/components/ui';
import type { ProductFamily } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import {
    choiceOptionNames,
    joinDefaults,
    newGroupDefaults,
    takenLabels,
    type VariantChoice,
} from '@/lib/variant-choice';
import { suggestedValuesFor, useVariantOptionValues } from './useVariantOptionValues';

type VariantAssignmentFieldsProps = {
    /** For guessing the group name and this product's size from its name. */
    productName: string;
    /** The product being edited, so its own row in a group is not a clash. */
    productId?: string;
    families: ProductFamily[];
    value: VariantChoice;
    onChange: (next: VariantChoice) => void;
    /** Set once the form has tried to save: shows the error below. */
    error?: { field: 'group' | 'name' | 'values'; message: string } | null;
};

const MAX_LISTED_GROUPS = 8;

/**
 * "Not a variant / Add to an existing group / Create a new group", and the
 * product's own size or colour in whichever group it is. The products list's
 * "Set variant group" dialog and the product form both use it.
 */
export default function VariantAssignmentFields({
    productName,
    productId,
    families,
    value,
    onChange,
    error,
}: VariantAssignmentFieldsProps) {
    const { t } = useI18n();
    const m = t.productVariants.admin;
    const suggestions = useVariantOptionValues();
    const [search, setSearch] = useState('');

    const family = value.mode === 'existing' ? families.find((row) => row.id === value.familyId) ?? null : null;
    const optionNames = choiceOptionNames(value, families);

    const listed = useMemo(() => {
        const term = search.trim().toLowerCase();
        return families
            .filter((row) => !term || row.name.toLowerCase().includes(term))
            .slice(0, MAX_LISTED_GROUPS);
    }, [families, search]);

    const setMode = (mode: VariantChoice['mode']) => {
        if (mode === value.mode) return;
        if (mode === 'new') onChange({ ...value, mode, ...newGroupDefaults(productName) });
        else onChange({ ...value, mode, values: {} });
    };

    const pickFamily = (row: ProductFamily) =>
        onChange({ ...value, familyId: row.id, values: joinDefaults(productName, row) });

    const valueList = (option: string) => {
        if (family) {
            const own = family.members.map((member) => member.option_values[option]).filter(Boolean);
            return [...new Set([...own, ...suggestedValuesFor(suggestions, option)])];
        }
        return suggestedValuesFor(suggestions, option);
    };

    const modes: Array<{ id: VariantChoice['mode']; label: string }> = [
        { id: 'none', label: m.notAVariant },
        { id: 'existing', label: m.joinExisting },
        { id: 'new', label: m.createNew },
    ];

    return (
        <div className="space-y-3">
            <div role="radiogroup" className="flex flex-wrap gap-2">
                {modes.map((mode) => (
                    <label
                        key={mode.id}
                        className={`inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${
                            value.mode === mode.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                        }`}
                    >
                        <input
                            type="radio"
                            name={`variant-mode-${productId ?? 'new'}`}
                            checked={value.mode === mode.id}
                            onChange={() => setMode(mode.id)}
                            className="h-4 w-4"
                        />
                        {mode.label}
                    </label>
                ))}
            </div>

            {value.mode === 'existing' && (
                <div className="space-y-2">
                    {families.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.noGroups}</p>
                    ) : (
                        <>
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder={m.searchGroups}
                                aria-label={m.searchGroups}
                                className="w-full min-h-touch"
                            />
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {listed.map((row) => (
                                    <button
                                        key={row.id}
                                        type="button"
                                        aria-pressed={row.id === value.familyId}
                                        onClick={() => pickFamily(row)}
                                        className={`min-h-touch rounded-md border px-3 py-1.5 text-start ${
                                            row.id === value.familyId
                                                ? 'border-blue-600 bg-blue-50'
                                                : 'border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span className="block truncate text-sm font-medium text-gray-900">{row.name}</span>
                                        <span className="block truncate text-xs text-gray-500">
                                            {row.option_names.join(', ')} ·{' '}
                                            {formatMessage(m.productsCount, { count: row.members.length })}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {error?.field === 'group' && (
                        <p role="alert" className="text-xs text-danger">
                            {m.pickGroup}
                        </p>
                    )}
                </div>
            )}

            {value.mode === 'new' && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field
                        label={m.name}
                        required
                        htmlFor="variant-choice-name"
                        error={error?.field === 'name' ? m.required : undefined}
                    >
                        <Input
                            id="variant-choice-name"
                            value={value.newName}
                            onChange={(event) => onChange({ ...value, newName: event.target.value })}
                            className="w-full min-h-touch"
                        />
                    </Field>
                    <Field label={m.options} required hint={m.optionsHelper} htmlFor="variant-choice-options">
                        <Input
                            id="variant-choice-options"
                            value={value.optionsText}
                            onChange={(event) => onChange({ ...value, optionsText: event.target.value })}
                            list="variant-choice-option-names"
                            className="w-full min-h-touch"
                        />
                    </Field>
                    <datalist id="variant-choice-option-names">
                        {Object.keys(suggestions).map((name) => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                </div>
            )}

            {optionNames.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-600">{m.thisProductsOptions}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {optionNames.map((option, index) => (
                            <div key={option}>
                                <label htmlFor={`variant-choice-value-${index}`} className="mb-1 block text-xs text-gray-500">
                                    {option}
                                </label>
                                <Input
                                    id={`variant-choice-value-${index}`}
                                    placeholder={option}
                                    value={value.values[option] ?? ''}
                                    onChange={(event) =>
                                        onChange({ ...value, values: { ...value.values, [option]: event.target.value } })
                                    }
                                    list={`variant-choice-values-${index}`}
                                    className="w-full min-h-touch"
                                />
                                <datalist id={`variant-choice-values-${index}`}>
                                    {valueList(option).map((suggested) => (
                                        <option key={suggested} value={suggested} />
                                    ))}
                                </datalist>
                            </div>
                        ))}
                    </div>
                    {family && takenLabels(family, productId).length > 0 && (
                        <p className="text-xs text-gray-500">
                            {formatMessage(m.takenValues, { values: takenLabels(family, productId).join(', ') })}
                        </p>
                    )}
                    {error?.field === 'values' && (
                        <p role="alert" className="text-xs text-danger">
                            {error.message}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
