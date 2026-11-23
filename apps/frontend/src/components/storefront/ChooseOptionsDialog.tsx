'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import VariantPicker from '@/components/storefront/VariantPicker';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { findVariant, initialSelection, type VariantSelection } from '@/lib/storefront/variant-picker';

/** A variant as the shop page's payload carries it. */
export type StorefrontVariant = {
    id: string;
    name: string;
    label: string;
    option_values: Record<string, string>;
    selling_price: number;
    compare_at_price: number | null;
    image_url: string | null;
    stock_quantity: number;
};

/** A family card: one product on the shop, several products in the cart's eyes. */
export type StorefrontFamilyCard = {
    id: string;
    name: string;
    selling_price: string | number;
    image_url: string | null;
    group_name?: string;
    option_names?: string[];
    variants?: StorefrontVariant[];
};

type ChooseOptionsDialogProps = {
    card: StorefrontFamilyCard;
    onClose: () => void;
    /** Called with the chosen variant; the dialog closes itself afterwards. */
    onAdd: (variant: StorefrontVariant) => void;
};

/**
 * The size/colour picker a family card opens. Adding is disabled until every
 * option is chosen and the combination is in stock, so a shopper cannot add
 * "a belt" without saying which one.
 */
export default function ChooseOptionsDialog({ card, onClose, onAdd }: ChooseOptionsDialogProps) {
    const { t } = useI18n();
    const m = t.storefront.public;
    const v = t.productVariants.storefront;
    const optionNames = card.option_names ?? [];
    const variants = card.variants ?? [];
    const pickerVariants = variants.map((variant) => ({ ...variant, in_stock: variant.stock_quantity > 0 }));
    const [selection, setSelection] = useState<VariantSelection>(() => initialSelection(optionNames, pickerVariants));

    const chosen = findVariant(optionNames, pickerVariants, selection);
    const missing = optionNames.find((name) => !selection[name]);
    const image = chosen?.image_url ?? card.image_url;
    const onSale = chosen?.compare_at_price != null && chosen.compare_at_price > chosen.selling_price;

    let buttonLabel: string = m.addToCart;
    if (missing) buttonLabel = formatMessage(v.select, { name: missing });
    else if (!chosen) buttonLabel = v.unavailable;
    else if (chosen.stock_quantity <= 0) buttonLabel = v.soldOut;

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={card.name} subtitle={card.group_name} onClose={onClose} closeLabel={v.close} />
            <div className="space-y-4 overflow-y-auto p-4">
                <div className="flex gap-3">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                        {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={image} alt={card.name} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <Package className="h-8 w-8 text-gray-300" />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0 space-y-1">
                        <p className="text-base font-semibold text-gray-900">
                            {chosen
                                ? formatBDT(chosen.selling_price)
                                : formatMessage(v.fromPrice, { price: formatBDT(Number(card.selling_price)) })}
                        </p>
                        {onSale && chosen?.compare_at_price != null ? (
                            <p className="text-xs text-gray-400 line-through">{formatBDT(chosen.compare_at_price)}</p>
                        ) : null}
                        {chosen ? <p className="text-xs text-gray-500">{chosen.label}</p> : null}
                    </div>
                </div>
                <VariantPicker
                    optionNames={optionNames}
                    variants={pickerVariants}
                    selection={selection}
                    onChange={setSelection}
                    soldOutLabel={v.soldOut}
                />
            </div>
            <ModalFooter>
                <button
                    type="button"
                    disabled={!chosen || chosen.stock_quantity <= 0}
                    onClick={() => {
                        if (!chosen) return;
                        onAdd(chosen);
                        onClose();
                    }}
                    className="inline-flex min-h-touch w-full items-center justify-center rounded-lg bg-[color:var(--sf-accent)] px-4 py-2 text-sm font-semibold text-[color:var(--sf-accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                    {buttonLabel}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}

/**
 * The cart line for a chosen variant: the family's name with the options
 * ("Belt OAC · S"), so the cart says which size without repeating the SKU's
 * whole name. The id is the variant's own product id — what the order is for.
 */
export function cartProductForVariant(card: StorefrontFamilyCard, variant: StorefrontVariant) {
    return {
        id: variant.id,
        name: variant.label ? `${card.name} · ${variant.label}` : variant.name,
        selling_price: variant.selling_price,
        compare_at_price: variant.compare_at_price,
        image_url: variant.image_url ?? card.image_url,
        stock_quantity: variant.stock_quantity,
        group_name: card.group_name,
    };
}
