'use client';

import {
    optionValues,
    selectValue,
    valueState,
    type PickerVariant,
    type VariantSelection,
} from '@/lib/storefront/variant-picker';

type VariantPickerProps = {
    optionNames: string[];
    variants: PickerVariant[];
    selection: VariantSelection;
    onChange: (next: VariantSelection) => void;
    soldOutLabel: string;
};

/**
 * One row of chips per option (Size, Color). A chip that leads only to
 * sold-out variants stays visible but struck through, so a shopper can see the
 * size exists; one that leads to no variant at all — a size never made in the
 * chosen colour — is dimmed. Both can still be pressed: picking one moves the
 * other options to a combination that exists.
 *
 * Painted with the shop's brand colour (`--sf-accent`, set by the storefront
 * theme), so it only belongs inside a storefront page.
 */
export default function VariantPicker({ optionNames, variants, selection, onChange, soldOutLabel }: VariantPickerProps) {
    const values = optionValues(optionNames, variants);

    return (
        <div className="space-y-3">
            {optionNames.map((name) => (
                <fieldset key={name}>
                    <legend className="mb-1.5 text-xs font-semibold text-gray-700">
                        {name}
                        {selection[name] ? <span className="font-normal text-gray-500">: {selection[name]}</span> : null}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                        {values[name].map((value) => {
                            const state = valueState(variants, selection, name, value);
                            const selected = selection[name] === value;
                            const tone = selected
                                ? 'border-[color:var(--sf-accent)] bg-white text-gray-900 ring-1 ring-[color:var(--sf-accent)]'
                                : state === 'available'
                                  ? 'border-gray-300 bg-white text-gray-900 hover:border-gray-500'
                                  : 'border-gray-200 bg-gray-50 text-gray-400';
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={selected}
                                    title={state === 'soldOut' ? soldOutLabel : undefined}
                                    onClick={() => onChange(selectValue(optionNames, variants, selection, name, value))}
                                    className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors ${tone} ${
                                        state === 'soldOut' ? 'line-through' : ''
                                    } ${state === 'unavailable' && !selected ? 'opacity-60' : ''}`}
                                >
                                    {value}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}
