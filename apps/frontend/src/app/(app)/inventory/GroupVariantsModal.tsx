'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
    normaliseOptionNames,
    splitVariantName,
    validateVariantFamily,
    variantKey,
    type VariantOptionValues,
} from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Checkbox, ConfirmDialog, Field, Input, Textarea } from '@/components/ui';
import { api, type ProductFamily } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { VariantBase } from './CreateVariantsModal';
import { suggestedValuesFor, useVariantOptionValues } from './useVariantOptionValues';

/** A product as the dialog lists it. */
export type VariantCandidate = { id: string; name: string; sku?: string | null; price?: number | string | null };

type Row = { productId: string; name: string; sku: string | null; price: number | null; values: VariantOptionValues };

type GroupVariantsModalProps =
    | {
          mode: 'create';
          products: VariantCandidate[];
          /** From a suggestion: the shared name, its one option, and each product's value on it. */
          prefill?: { name: string; optionName: string; values: Record<string, string> };
          onClose: () => void;
          onSaved: () => void;
      }
    | {
          mode: 'edit';
          familyId: string;
          onClose: () => void;
          onSaved: () => void;
          /** Opens "Create variants" on this family, from one of its products. */
          onAddVariants?: (base: VariantBase) => void;
      };

/** The words every name starts with: "Belt OAC S" and "Belt OAC M" share "Belt OAC". */
function commonWordPrefix(names: string[]): string {
    if (names.length === 0) return '';
    const split = names.map((name) => name.trim().split(/\s+/));
    const prefix: string[] = [];
    for (let i = 0; i < split[0].length; i++) {
        const word = split[0][i];
        if (split.every((words) => words[i]?.toLowerCase() === word.toLowerCase())) prefix.push(word);
        else break;
    }
    return prefix.join(' ');
}

/**
 * A first guess for products picked by hand: the shared start of their names
 * as the family name, and what is left of each name as its value. When every
 * name ends in a recognisable size or colour, that names the option too.
 */
export function guessFromNames(products: VariantCandidate[]) {
    const splits = products.map((product) => splitVariantName(product.name));
    const axis = splits.every((split) => split && split.axis === splits[0]?.axis) ? splits[0]?.axis : undefined;
    const prefix = commonWordPrefix(products.map((product) => product.name));
    const name = axis && splits[0] ? commonWordPrefix(splits.map((split) => split!.base)) || splits[0].base : prefix;
    const values: Record<string, string> = {};
    products.forEach((product, index) => {
        const split = splits[index];
        values[product.id] = axis && split ? split.value : product.name.trim().slice(prefix.length).trim();
    });
    return { name: name || products[0]?.name || '', optionName: axis ?? 'Size', values };
}

function rowsFromCandidates(products: VariantCandidate[], optionName: string, values: Record<string, string>): Row[] {
    return products.map((product) => ({
        productId: product.id,
        name: product.name,
        sku: product.sku ?? null,
        price: product.price === null || product.price === undefined ? null : Number(product.price),
        values: { [optionName]: values[product.id] ?? '' },
    }));
}

function rowsFromFamily(family: ProductFamily): Row[] {
    return family.members.map((member) => ({
        productId: member.id,
        name: member.name,
        sku: member.sku,
        price: member.price,
        values: { ...member.option_values },
    }));
}

/**
 * "Group as variants": shows several products on the storefront as one
 * product a shopper picks a size or colour of. Also edits a family and
 * ungroups it. Nothing here touches the products themselves — their stock,
 * prices and history stay exactly as they are.
 */
export default function GroupVariantsModal(props: GroupVariantsModalProps) {
    const { t, fmt, locale } = useI18n();
    const m = t.productVariants.admin;
    const editing = props.mode === 'edit';

    const [loading, setLoading] = useState(editing);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [loadedFamily, setLoadedFamily] = useState<ProductFamily | null>(null);
    const suggestions = useVariantOptionValues();
    const [featured, setFeatured] = useState(false);
    const [optionsText, setOptionsText] = useState('Size');
    const [rows, setRows] = useState<Row[]>([]);
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmUngroup, setConfirmUngroup] = useState(false);

    const createProducts = props.mode === 'create' ? props.products : null;
    const createPrefill = props.mode === 'create' ? props.prefill : undefined;
    const familyId = props.mode === 'edit' ? props.familyId : null;

    useEffect(() => {
        if (createProducts) {
            const guess = createPrefill ?? guessFromNames(createProducts);
            setName(guess.name);
            setOptionsText(guess.optionName);
            setRows(rowsFromCandidates(createProducts, guess.optionName, guess.values));
            return;
        }
        if (!familyId) return;
        let cancelled = false;
        setLoading(true);
        api.getProductFamily(familyId)
            .then((family) => {
                if (cancelled) return;
                setLoadedFamily(family);
                setName(family.name);
                setDescription(family.description ?? '');
                setImageUrl(family.image_url ?? '');
                setFeatured(family.is_featured);
                setOptionsText(family.option_names.join(', '));
                setRows(rowsFromFamily(family));
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : m.failed);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [createProducts, createPrefill, familyId, m.failed]);

    const optionNames = useMemo(() => normaliseOptionNames(optionsText.split(',')), [optionsText]);

    // Which cells repeat another row's combination, for an inline error on each.
    const duplicateRows = useMemo(() => {
        const seen = new Map<string, number>();
        const dupes = new Set<number>();
        rows.forEach((row, index) => {
            if (optionNames.some((option) => !row.values[option]?.trim())) return;
            const key = variantKey(optionNames, Object.fromEntries(optionNames.map((o) => [o, row.values[o].trim()])));
            const first = seen.get(key);
            if (first !== undefined) {
                dupes.add(first);
                dupes.add(index);
            } else seen.set(key, index);
        });
        return dupes;
    }, [rows, optionNames]);

    const setValue = (index: number, option: string, value: string) => {
        setRows((prev) => prev.map((row, i) => (i === index ? { ...row, values: { ...row.values, [option]: value } } : row)));
    };

    const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

    const save = async () => {
        setSubmitted(true);
        setError('');
        if (!name.trim()) return;
        if (!editing && rows.length < 2) {
            setError(m.needTwo);
            return;
        }
        const members = rows.map((row) => ({ productId: row.productId, optionValues: row.values }));
        const check = validateVariantFamily(optionNames, members);
        if ('error' in check) {
            setError(check.error);
            return;
        }

        setSaving(true);
        try {
            const body = {
                name: name.trim(),
                description: description.trim(),
                imageUrl: imageUrl.trim(),
                isFeatured: featured,
                optionNames: check.optionNames,
                members: check.members,
            };
            if (familyId) {
                await api.updateProductFamily(familyId, body);
                toast.success(m.saved);
            } else {
                const created = await api.createProductFamily(body);
                toast.success(fmt(m.created, { count: rows.length, name: created.name }));
            }
            props.onSaved();
            props.onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSaving(false);
        }
    };

    const ungroup = async () => {
        if (!familyId) return;
        setSaving(true);
        try {
            await api.deleteProductFamily(familyId);
            toast.success(fmt(m.ungrouped, { name }));
            setConfirmUngroup(false);
            props.onSaved();
            props.onClose();
        } catch (err: unknown) {
            setConfirmUngroup(false);
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSaving(false);
        }
    };

    const close = saving ? undefined : props.onClose;

    return (
        <ModalShell size="lg" onBackdropClick={close} dismissOnBackdrop={false}>
            <ModalHeader title={editing ? m.editTitle : m.createTitle} subtitle={m.helper} onClose={close} closeLabel={m.cancel} />

            <div className="space-y-4 overflow-y-auto p-4">
                {error && <Alert tone="danger">{error}</Alert>}
                {loading ? (
                    <p className="text-sm text-gray-500">{m.loading}</p>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <Field
                                label={m.name}
                                required
                                htmlFor="variant-family-name"
                                error={submitted && !name.trim() ? m.required : undefined}
                            >
                                <Input
                                    id="variant-family-name"
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    className="w-full min-h-touch"
                                    autoFocus
                                />
                            </Field>
                            <Field label={m.options} required hint={m.optionsHelper} htmlFor="variant-family-options">
                                <Input
                                    id="variant-family-options"
                                    value={optionsText}
                                    onChange={(event) => setOptionsText(event.target.value)}
                                    list="variant-family-option-names"
                                    className="w-full min-h-touch"
                                />
                            </Field>
                            <datalist id="variant-family-option-names">
                                {Object.keys(suggestions).map((option) => (
                                    <option key={option} value={option} />
                                ))}
                            </datalist>
                            {optionNames.map((option, index) => (
                                <datalist key={option} id={`variant-family-values-${index}`}>
                                    {suggestedValuesFor(suggestions, option).map((value) => (
                                        <option key={value} value={value} />
                                    ))}
                                </datalist>
                            ))}
                        </div>
                        <Field label={m.imageUrl} hint={m.imageHint} htmlFor="variant-family-image">
                            <Input
                                id="variant-family-image"
                                type="url"
                                value={imageUrl}
                                onChange={(event) => setImageUrl(event.target.value)}
                                placeholder="https://"
                                className="w-full min-h-touch"
                            />
                        </Field>
                        <Field label={m.description} htmlFor="variant-family-description">
                            <Textarea
                                id="variant-family-description"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                rows={2}
                                className="w-full"
                            />
                        </Field>
                        <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                            <Checkbox checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
                            {m.featured}
                        </label>

                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">{m.product}</th>
                                        {optionNames.map((option) => (
                                            <th key={option} className="px-3 py-2 text-start font-medium">
                                                {option}
                                            </th>
                                        ))}
                                        <th className="w-10 px-2 py-2" aria-label={m.remove} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rows.map((row, index) => (
                                        <tr key={row.productId}>
                                            <td className="px-3 py-2 align-top">
                                                <span className="block font-medium text-gray-900">{row.name}</span>
                                                <span className="block text-xs text-gray-500">
                                                    {[row.sku, row.price !== null ? formatBDT(row.price, { locale }) : null]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </span>
                                            </td>
                                            {optionNames.map((option, optionIndex) => {
                                                const value = row.values[option] ?? '';
                                                const cellError = !submitted
                                                    ? undefined
                                                    : !value.trim()
                                                      ? m.required
                                                      : duplicateRows.has(index)
                                                        ? m.duplicate
                                                        : undefined;
                                                return (
                                                    <td key={option} className="min-w-[7rem] px-3 py-2 align-top">
                                                        <Input
                                                            aria-label={`${row.name} — ${option}`}
                                                            list={`variant-family-values-${optionIndex}`}
                                                            value={value}
                                                            onChange={(event) => setValue(index, option, event.target.value)}
                                                            className="w-full min-h-touch"
                                                        />
                                                        {cellError && (
                                                            <p role="alert" className="mt-1 text-xs text-danger">
                                                                {cellError}
                                                            </p>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-2 py-2 align-top">
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(index)}
                                                    disabled={rows.length <= 1}
                                                    aria-label={`${m.remove} ${row.name}`}
                                                    className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-40"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            <ModalFooter className="flex-wrap">
                {editing && (
                    <Button
                        variant="danger"
                        size="md"
                        onClick={() => setConfirmUngroup(true)}
                        disabled={saving || loading}
                        className="me-auto min-h-touch"
                    >
                        {m.ungroup}
                    </Button>
                )}
                {props.mode === 'edit' && props.onAddVariants && loadedFamily && loadedFamily.members.length > 0 && (
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={() => {
                            const first = loadedFamily.members[0];
                            props.onAddVariants?.({
                                id: first.id,
                                name: first.name,
                                sku: first.sku,
                                price: first.price,
                                family: { id: loadedFamily.id, name: loadedFamily.name, option_names: loadedFamily.option_names },
                                option_values: first.option_values,
                            });
                        }}
                        disabled={saving}
                        className="min-h-touch"
                    >
                        {m.addVariants}
                    </Button>
                )}
                <Button variant="secondary" size="md" onClick={props.onClose} disabled={saving} className="min-h-touch">
                    {m.cancel}
                </Button>
                <Button
                    size="md"
                    onClick={() => void save()}
                    disabled={loading || saving}
                    loading={saving}
                    className="min-h-touch"
                >
                    {editing ? m.save : m.groupAsVariants}
                </Button>
            </ModalFooter>

            <ConfirmDialog
                open={confirmUngroup}
                title={m.ungroupTitle}
                prompt={fmt(m.ungroupConfirm, { name })}
                confirmLabel={m.ungroup}
                cancelLabel={m.cancel}
                loading={saving}
                danger
                onConfirm={() => void ungroup()}
                onCancel={() => {
                    if (!saving) setConfirmUngroup(false);
                }}
            />
        </ModalShell>
    );
}
