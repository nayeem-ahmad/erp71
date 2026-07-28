'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type LeadTaxonomyKind = 'sources' | 'categories';

export type LeadTaxonomyOption = {
    id: string;
    code: string;
    name: string;
    /** Sources only. */
    score_weight?: number;
    sort_order: number;
    is_system: boolean;
    is_active: boolean;
};

/**
 * Tenant-managed lead sources / categories.
 *
 * These used to be hardcoded enums with translated labels. They are now rows a
 * tenant owns, so `name` is displayed verbatim — a tenant that renames a source
 * to "Meta Ads" sees exactly that in every locale. Only the seeded defaults ship
 * with English names.
 *
 * `includeInactive` is for the settings screen; the lead form and filters must
 * leave it off so retired values stop being offered on new leads.
 */
export function useLeadTaxonomy(kind: LeadTaxonomyKind, includeInactive = false) {
    const [options, setOptions] = useState<LeadTaxonomyOption[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(() => {
        setLoading(true);
        return api
            .getLeadTaxonomy(kind, includeInactive)
            .then((rows: LeadTaxonomyOption[]) => {
                setOptions(Array.isArray(rows) ? rows : []);
                return rows;
            })
            .catch(() => {
                // A tenant provisioned before the taxonomy tables exist has no
                // rows yet; an empty list is the correct degraded state, not an
                // error banner over the whole lead form.
                setOptions([]);
                return [] as LeadTaxonomyOption[];
            })
            .finally(() => setLoading(false));
    }, [kind, includeInactive]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { options, loading, reload, setOptions };
}

/**
 * The option a new lead should start on: the tenant's fallback row if present,
 * otherwise the first active one. Returns '' when the tenant has no rows at all,
 * which the backend treats as "use the fallback".
 */
export function defaultTaxonomyId(options: LeadTaxonomyOption[]): string {
    if (options.length === 0) return '';
    return options.find((o) => o.code === 'OTHER')?.id ?? options[0].id;
}
