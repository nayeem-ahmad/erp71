'use client';

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api';

/**
 * The shop's VAT rate and how its prices are entered, for the sales entry
 * screens.
 *
 * Read from `/tenants/tax-settings`, where Settings › Tax saves them. The entry
 * screen used to look for the rate on the sales settings, which never carried
 * it, so the VAT row always read zero.
 */
export interface TaxPricing {
    /** Percentage applied to a product that has no rate of its own. */
    defaultVatRate: number;
    /** False when prices are entered before VAT and the screens add it. */
    pricesIncludeVat: boolean;
    loaded: boolean;
}

const INITIAL: TaxPricing = { defaultVatRate: 0, pricesIncludeVat: true, loaded: false };

export function taxPricingFrom(raw: any): TaxPricing {
    const rate = Number(raw?.default_vat_rate);
    return {
        defaultVatRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
        // Anything but an explicit false keeps the long-standing behaviour.
        pricesIncludeVat: raw?.prices_include_vat !== false,
        loaded: true,
    };
}

export function useTaxPricing(): TaxPricing {
    const [pricing, setPricing] = useState<TaxPricing>(INITIAL);

    useEffect(() => {
        let cancelled = false;
        // Inside the chain, so a failure of any kind lands in the fallback
        // below rather than breaking the screen that asked.
        Promise.resolve()
            .then(() => fetchWithAuth('/tenants/tax-settings'))
            .then((raw) => {
                if (!cancelled) setPricing(taxPricingFrom(raw));
            })
            // A sale must still be enterable when the settings cannot be read:
            // fall back to prices that include VAT at no stated rate, which is
            // exactly how the screen behaved before it read them at all.
            .catch(() => {
                if (!cancelled) setPricing({ ...INITIAL, loaded: true });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return pricing;
}
