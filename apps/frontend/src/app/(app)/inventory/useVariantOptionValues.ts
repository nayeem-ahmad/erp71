'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * The options and values this shop already uses across its variant families
 * (`{ Size: ['S', 'M'], Color: ['Red'] }`), for the grouping and generating
 * dialogs to suggest. Empty until it arrives, and empty for good if the read
 * fails — the suggestions are a convenience, never a reason to block the form.
 */
export function useVariantOptionValues(): Record<string, string[]> {
    const [values, setValues] = useState<Record<string, string[]>>({});
    useEffect(() => {
        let cancelled = false;
        api.getProductFamilyOptionValues()
            .then((result) => {
                if (!cancelled && result && typeof result === 'object') setValues(result);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);
    return values;
}

/** The suggested values for one option, matched case-insensitively by name. */
export function suggestedValuesFor(values: Record<string, string[]>, option: string): string[] {
    const key = Object.keys(values).find((name) => name.toLowerCase() === option.trim().toLowerCase());
    return key ? values[key] : [];
}
