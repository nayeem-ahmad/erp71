'use client';

import { useI18n } from '@/lib/i18n';

/** The slice of `GET /storefront/:slug/customer/me` that checkout prefills from. */
export type DeliveryProfile = {
    address?: string | null;
    last_delivery?: { address: string | null; area: string | null } | null;
};

/**
 * Where a signed-in shopper's next order most likely goes: wherever the last
 * one went, else the address the shop keeps on their record. The record's
 * address is one string, so it lands in the street field and the area is left
 * for the shopper to fill in.
 */
export function deliveryPrefill(profile: DeliveryProfile | null | undefined): { address: string; area: string } {
    const last = profile?.last_delivery;
    if (last?.address) return { address: last.address, area: last.area ?? '' };
    return { address: profile?.address ?? '', area: '' };
}

const inputCls =
    'w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all';

type DeliveryAddressFieldsProps = {
    address: string;
    area: string;
    onAddressChange: (value: string) => void;
    onAreaChange: (value: string) => void;
};

/** The two delivery fields every storefront checkout asks for. */
export default function DeliveryAddressFields({
    address,
    area,
    onAddressChange,
    onAreaChange,
}: DeliveryAddressFieldsProps) {
    const { t } = useI18n();
    const m = t.storefront.public;

    return (
        <>
            <div>
                <label htmlFor="delivery-address" className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {m.deliveryAddress} <span className="text-red-500">*</span>
                </label>
                <textarea
                    id="delivery-address"
                    required
                    maxLength={500}
                    autoComplete="street-address"
                    value={address}
                    onChange={(event) => onAddressChange(event.target.value)}
                    placeholder={m.placeholders.deliveryAddress}
                    rows={2}
                    className={`${inputCls} resize-none`}
                />
            </div>
            <div>
                <label htmlFor="delivery-area" className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {m.deliveryArea} <span className="text-red-500">*</span>
                </label>
                <input
                    id="delivery-area"
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="address-level2"
                    value={area}
                    onChange={(event) => onAreaChange(event.target.value)}
                    placeholder={m.placeholders.deliveryArea}
                    className={inputCls}
                />
            </div>
        </>
    );
}
