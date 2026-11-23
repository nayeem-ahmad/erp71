'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    MAX_VARIANT_COMBINATIONS,
    normaliseOptionNames,
    normaliseOptionValues,
    splitVariantName,
    variantCombinations,
    variantKey,
    variantLabel,
    variantProductName,
    variantSku,
    type VariantOptionValues,
} from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Checkbox, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { suggestedValuesFor, useVariantOptionValues } from './useVariantOptionValues';

/** The product the new variants are made from. */
export type VariantBase = {
    id: string;
    name: string;
    sku?: string | null;
    price?: number | string | null;
    family?: { id: string; name: string; option_names: string[] } | null;
    option_values?: Record<string, string> | null;
};

type RowEdit = { sku?: string; price?: string; stock?: string; include?: boolean };

type CreateVariantsModalProps = {
    base: VariantBase;
    onClose: () => void;
    onSaved: () => void;
};

function splitValues(text: string): string[] {
    return normaliseOptionNames(text.split(','));
}

/**
 * "Create variants": type the sizes and colours, see every product that will
 * be made — name, SKU, price, opening stock — and make them in one go. Each is
 * an ordinary product copied from the base; the family only decides how the
 * storefront shows them.
 */
export default function CreateVariantsModal({ base, onClose, onSaved }: CreateVariantsModalProps) {
    const { t, fmt } = useI18n();
    const m = t.productVariants.admin;
    const suggestions = useVariantOptionValues();
    const family = base.family ?? null;

    const guess = useMemo(() => splitVariantName(base.name), [base.name]);
    const [familyName, setFamilyName] = useState(family?.name ?? guess?.base ?? base.name);
    const [optionsText, setOptionsText] = useState(family ? family.option_names.join(', ') : (guess?.axis ?? 'Size'));
    const [baseValues, setBaseValues] = useState<VariantOptionValues>(() =>
        family ? { ...(base.option_values ?? {}) } : guess ? { [guess.axis]: guess.value } : {},
    );
    const [valuesText, setValuesText] = useState<Record<string, string>>({});
    const [edits, setEdits] = useState<Record<string, RowEdit>>({});
    const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);

    const optionNames = useMemo(
        () => (family ? family.option_names : normaliseOptionNames(optionsText.split(','))),
        [family, optionsText],
    );

    // A family's members already cover some combinations; making them again
    // would only be refused, so they are left out of the list up front.
    useEffect(() => {
        if (!family) return;
        let cancelled = false;
        api.getProductFamily(family.id)
            .then((loaded) => {
                if (cancelled) return;
                setExistingKeys(
                    new Set(loaded.members.map((member) => variantKey(loaded.option_names, normaliseOptionValues(loaded.option_names, member.option_values)))),
                );
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [family]);

    const baseCombo = useMemo(() => {
        if (family) return null;
        const values = normaliseOptionValues(optionNames, baseValues);
        return optionNames.every((name) => values[name]) ? values : null;
    }, [family, optionNames, baseValues]);

    const combos = useMemo(() => {
        const taken = new Set(existingKeys);
        if (baseCombo) taken.add(variantKey(optionNames, baseCombo));
        const valuesByOption = Object.fromEntries(optionNames.map((name) => [name, splitValues(valuesText[name] ?? '')]));
        return variantCombinations(optionNames, valuesByOption).filter(
            (combo) => !taken.has(variantKey(optionNames, combo)),
        );
    }, [optionNames, valuesText, existingKeys, baseCombo]);

    const nameForProducts = family ? family.name : familyName.trim() || base.name;
    const basePrice = base.price === null || base.price === undefined ? '' : String(Number(base.price));

    const rows = combos.map((combo) => {
        const key = variantKey(optionNames, combo);
        const edit = edits[key] ?? {};
        return {
            key,
            combo,
            name: variantProductName(nameForProducts, optionNames, combo),
            sku: edit.sku ?? variantSku(base.sku, optionNames, combo) ?? '',
            price: edit.price ?? basePrice,
            stock: edit.stock ?? '0',
            include: edit.include ?? true,
        };
    });
    const included = rows.filter((row) => row.include);

    const edit = (key: string, patch: RowEdit) => setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    const priceError = (price: string) => {
        const n = Number(price);
        return price.trim() === '' || !Number.isFinite(n) || n < 0;
    };
    const stockError = (stock: string) => {
        const n = Number(stock || '0');
        return !Number.isInteger(n) || n < 0;
    };

    const save = async () => {
        setSubmitted(true);
        setError('');
        if (!family && !familyName.trim()) return;
        if (included.length === 0) {
            setError(m.noCombinations);
            return;
        }
        if (included.length > MAX_VARIANT_COMBINATIONS) {
            setError(fmt(m.tooMany, { max: MAX_VARIANT_COMBINATIONS }));
            return;
        }
        if (included.some((row) => priceError(row.price) || stockError(row.stock))) return;

        setSaving(true);
        try {
            const result = await api.generateProductVariants({
                baseProductId: base.id,
                ...(family
                    ? {}
                    : {
                          name: familyName.trim(),
                          optionNames,
                          ...(baseCombo ? { baseOptionValues: baseCombo } : {}),
                      }),
                variants: included.map((row) => ({
                    optionValues: row.combo,
                    sku: row.sku.trim() || undefined,
                    price: Number(row.price),
                    initialStock: Number(row.stock || '0'),
                })),
            });
            toast.success(fmt(m.generated, { count: included.length, name: result.name }));
            onSaved();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSaving(false);
        }
    };

    const close = saving ? undefined : onClose;

    return (
        <ModalShell size="xl" onBackdropClick={close} dismissOnBackdrop={false}>
            <ModalHeader
                title={fmt(m.createVariantsTitle, { name: base.name })}
                subtitle={m.createVariantsHelper}
                onClose={close}
                closeLabel={m.cancel}
            />
            <div className="space-y-4 overflow-y-auto p-4">
                {error && <Alert tone="danger">{error}</Alert>}

                {!family && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field
                            label={m.name}
                            required
                            htmlFor="create-variants-name"
                            error={submitted && !familyName.trim() ? m.required : undefined}
                        >
                            <Input
                                id="create-variants-name"
                                value={familyName}
                                onChange={(event) => setFamilyName(event.target.value)}
                                className="w-full min-h-touch"
                            />
                        </Field>
                        <Field label={m.options} required hint={m.optionsHelper} htmlFor="create-variants-options">
                            <Input
                                id="create-variants-options"
                                value={optionsText}
                                onChange={(event) => setOptionsText(event.target.value)}
                                list="create-variants-option-names"
                                className="w-full min-h-touch"
                            />
                        </Field>
                        <datalist id="create-variants-option-names">
                            {Object.keys(suggestions).map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {optionNames.map((name, index) => {
                        const listId = `create-variants-values-${index}`;
                        const suggested = suggestedValuesFor(suggestions, name);
                        return (
                            <div key={name} className="space-y-2">
                                <Field label={`${name} — ${m.values}`} hint={m.valuesHelper} htmlFor={`${listId}-input`}>
                                    <Input
                                        id={`${listId}-input`}
                                        value={valuesText[name] ?? ''}
                                        onChange={(event) => setValuesText((prev) => ({ ...prev, [name]: event.target.value }))}
                                        placeholder={suggested.slice(0, 6).join(', ')}
                                        className="w-full min-h-touch"
                                    />
                                </Field>
                                {suggested.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggested
                                            .filter(
                                                (value) =>
                                                    !splitValues(valuesText[name] ?? '').some(
                                                        (typed) => typed.toLowerCase() === value.toLowerCase(),
                                                    ),
                                            )
                                            .map((value) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() =>
                                                        setValuesText((prev) => ({
                                                            ...prev,
                                                            [name]: [...splitValues(prev[name] ?? ''), value].join(', '),
                                                        }))
                                                    }
                                                    className="inline-flex min-h-touch items-center rounded-md border border-gray-200 px-2.5 text-xs text-gray-700 hover:bg-gray-50"
                                                >
                                                    + {value}
                                                </button>
                                            ))}
                                    </div>
                                )}
                                {!family && (
                                    <Field label={`${m.thisProduct} — ${name}`} hint={index === 0 ? m.thisProductHelper : undefined} htmlFor={`${listId}-base`}>
                                        <Input
                                            id={`${listId}-base`}
                                            value={baseValues[name] ?? ''}
                                            onChange={(event) => setBaseValues((prev) => ({ ...prev, [name]: event.target.value }))}
                                            list={listId}
                                            className="w-full min-h-touch"
                                        />
                                    </Field>
                                )}
                                <datalist id={listId}>
                                    {suggested.map((value) => (
                                        <option key={value} value={value} />
                                    ))}
                                </datalist>
                            </div>
                        );
                    })}
                </div>

                <div>
                    <p className="mb-1.5 text-xs font-semibold text-gray-700">
                        {m.newProducts} ({included.length})
                    </p>
                    {rows.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.noCombinations}</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="w-10 px-2 py-2" aria-label={m.remove} />
                                        <th className="px-3 py-2 text-start font-medium">{m.product}</th>
                                        <th className="px-3 py-2 text-start font-medium">{m.sku}</th>
                                        <th className="px-3 py-2 text-end font-medium">{m.price}</th>
                                        <th className="px-3 py-2 text-end font-medium">{m.openingStock}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rows.map((row) => {
                                        const label = variantLabel(optionNames, row.combo);
                                        const badPrice = submitted && row.include && priceError(row.price);
                                        const badStock = submitted && row.include && stockError(row.stock);
                                        return (
                                            <tr key={row.key} className={row.include ? '' : 'opacity-50'}>
                                                <td className="px-2 py-2 align-top">
                                                    <label className="inline-flex min-h-touch min-w-touch items-center justify-center">
                                                        <Checkbox
                                                            aria-label={label}
                                                            checked={row.include}
                                                            onChange={(event) => edit(row.key, { include: event.target.checked })}
                                                        />
                                                    </label>
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    <span className="block font-medium text-gray-900">{row.name}</span>
                                                    <span className="block text-xs text-gray-500">{label}</span>
                                                </td>
                                                <td className="min-w-[8rem] px-3 py-2 align-top">
                                                    <Input
                                                        aria-label={`${label} — ${m.sku}`}
                                                        value={row.sku}
                                                        onChange={(event) => edit(row.key, { sku: event.target.value })}
                                                        className="w-full min-h-touch"
                                                    />
                                                </td>
                                                <td className="min-w-[6rem] px-3 py-2 align-top">
                                                    <Input
                                                        aria-label={`${label} — ${m.price}`}
                                                        inputMode="decimal"
                                                        value={row.price}
                                                        onChange={(event) => edit(row.key, { price: event.target.value })}
                                                        className="w-full min-h-touch text-end"
                                                    />
                                                    {badPrice && (
                                                        <p role="alert" className="mt-1 text-xs text-danger">
                                                            {m.required}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="min-w-[5rem] px-3 py-2 align-top">
                                                    <Input
                                                        aria-label={`${label} — ${m.openingStock}`}
                                                        inputMode="numeric"
                                                        value={row.stock}
                                                        onChange={(event) => edit(row.key, { stock: event.target.value })}
                                                        className="w-full min-h-touch text-end"
                                                    />
                                                    {badStock && (
                                                        <p role="alert" className="mt-1 text-xs text-danger">
                                                            {m.required}
                                                        </p>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="mt-1.5 text-xs text-gray-500">{m.costHint}</p>
                </div>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={saving} className="min-h-touch">
                    {m.cancel}
                </Button>
                <Button size="md" onClick={() => void save()} disabled={saving} loading={saving} className="min-h-touch">
                    {fmt(m.createCount, { count: included.length })}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
